#!/usr/bin/env bash
# AgenticOS paperclip-db-catchup — restart-immune safety net for the Paperclip
# DB dump (GOL-2858).
#
# WHY THIS EXISTS
# The Paperclip server schedules its own dump as an in-process interval armed at
# PROCESS START (PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES, 240 here) and re-armed
# from zero on every restart, with no catch-up for the run it missed. When the
# restart cadence is shorter than the interval, the interval never matures and
# the backup does not run AT ALL — not degraded, starved. Measured on
# 2026-09-30: seven restarts in 11.3h (mean 1.6h apart) → 11h39m with no dump,
# while /api/health still reported databaseBackup status "ok" (its own staleness
# threshold is maxAgeHours 26, decoupled from the 240m cadence).
#
# The in-process scheduler lives in /opt/paperclip (the Paperclip platform),
# outside this repo's write boundary, so the correct fix — dump on boot when the
# newest dump is older than the interval — cannot be made here. This script is
# that same catch-up, implemented OUT of process:
#
#   • a systemd timer (agenticos-paperclip-db-catchup.timer, hourly, and
#     Persistent=true so a missed run fires on the next boot) is anchored to the
#     WALL CLOCK and cannot be reset by a paperclip-server restart;
#   • it is a NO-OP whenever the newest dump is younger than the threshold, so
#     the server's own scheduler stays the primary path and a healthy box pays
#     one `stat` per hour;
#   • when the newest dump IS older than the threshold it takes the dump itself,
#     straight from the DB container with pg_dump.
#
# Worst-case staleness therefore becomes (interval + slack + timer period) ≈ 5h
# regardless of restart churn, instead of unbounded.
#
# WHERE THE DUMPS GO — deliberately the SAME directory and the SAME
# `paperclip-YYYYMMDD-HHMMSS.sql.gz` naming the server uses, so all three
# existing controls pick them up with no change:
#   • paperclip-volume-guard.sh freshness check stops paging (backups ARE
#     happening again);
#   • paperclip-backup-offsite.py ships them to the agenticos-backups Space
#     within 30m (its completeness gate already accepts the plain-pg_dump shape
#     as well as the server's);
#   • the server's own `backupRetention` GFS prune bounds them on disk.
# This script therefore NEVER prunes. Adding a second pruner to a directory that
# already has two is how you delete the last restore point.
#
# FORMAT NOTE — these dumps are plain `pg_dump` output (ends at COMMIT;), not the
# server's hand-rolled schema+data SQL with its `-- paperclip statement
# breakpoint` markers. Both restore with psql; the pg_dump one wants an empty
# target database, the server's is written to apply over an existing one. See
# docs/runbooks/backup-and-recovery.md.
#
# Runs as root because resolving the docker volume mountpoint and exec'ing into
# the DB container both need docker access — exactly like the volume guard and
# the off-box shipper.
#
# FAILURE IS ALREADY ALERTED: if this script cannot produce a dump, the newest
# dump stays stale and paperclip-volume-guard.sh pages `backup-stale` to Discord
# within the hour. It intentionally posts no webhook of its own — one voice per
# condition.
set -euo pipefail

VOLUME="${PAPERCLIP_VOLUME:-paperclip-data}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/agenticos/docker-compose.yml}"
DB_CONTAINER="${DB_CONTAINER:-agenticos-db}"
DB_NAME="${DB_NAME:-paperclip}"
DB_USER="${DB_USER:-agenticos}"
SERVER_CONTAINER="${SERVER_CONTAINER:-paperclip-server}"
LOCK_FILE="${LOCK_FILE:-/run/agenticos/paperclip-db-catchup.lock}"

# Staleness threshold, same shape as the volume guard's: the server's configured
# interval + slack. SLACK_MIN covers the dump's own runtime (~4-5m at 300M) plus
# timer jitter, so a healthy 240m cadence never trips this. If the interval is
# unreadable the container is down or being recreated — no in-process backup can
# be happening at all — so fall back to the compose default rather than to an
# aggressive small number that would dump on every fire.
BACKUP_INTERVAL_MIN="$(docker inspect "${SERVER_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
  | sed -n 's/^PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES=//p' | head -1 || true)"
BACKUP_INTERVAL_SRC="${SERVER_CONTAINER} env"
case "${BACKUP_INTERVAL_MIN}" in
  ''|*[!0-9]*)
    BACKUP_INTERVAL_MIN=240
    BACKUP_INTERVAL_SRC="fallback, container down or env unset"
    ;;
esac
SLACK_MIN="${SLACK_MIN:-35}"
STALE_MIN="${STALE_MIN:-$((BACKUP_INTERVAL_MIN + SLACK_MIN))}"

# Never be the thing that fills the volume (the GOL-1631 lesson). Two gates: a
# hard usage ceiling, and free space for at least HEADROOM_FACTOR x the newest
# dump's size. Above either, skip and let the volume guard page on headroom —
# a stale backup is bad, a 100%-full volume is a P0 that also deadlocks the
# server's own dump.
MAX_USE_PCT="${MAX_USE_PCT:-92}"
HEADROOM_FACTOR="${HEADROOM_FACTOR:-2}"
# A gzipped dump smaller than this is a silent pg_dump failure, not a backup.
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-1048576}"
DRY_RUN="${DRY_RUN:-0}"

LOG_TS() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(LOG_TS)] paperclip-db-catchup: $*"; }

# --- Single-flight: a dump takes minutes; an hourly timer plus a Persistent=true
# catch-up on boot can otherwise overlap and race on the same directory. -----
# Held on fd 9 for the life of the process (released by the kernel on exit), so
# there is no re-exec and no stale lockfile to clean up. A contended run is a
# normal outcome, not a failure: exit 0 so the unit does not go `failed`.
mkdir -p "$(dirname "${LOCK_FILE}")" 2>/dev/null || true
# NB the brace group around `exec`: a bare `exec 9>f 2>/dev/null` applies BOTH
# redirections to the shell permanently, silencing every later error message —
# the group scopes the stderr suppression to the exec itself.
if command -v flock >/dev/null 2>&1 && { exec 9>"${LOCK_FILE}"; } 2>/dev/null; then
  if ! flock -n 9; then
    log "another catch-up run holds ${LOCK_FILE} — exiting"
    exit 0
  fi
else
  log "WARN could not take ${LOCK_FILE} (flock missing or /run unwritable) — proceeding unlocked" >&2
fi

# --- Resolve the volume mountpoint on the host (same idiom as the guard) ---
MOUNT="${PAPERCLIP_DATA_DIR:-}"
if [ -z "${MOUNT}" ]; then
  MOUNT="$(docker volume inspect -f '{{ .Mountpoint }}' "${VOLUME}" 2>/dev/null || true)"
  if [ -z "${MOUNT}" ]; then
    real="$(docker volume ls -q 2>/dev/null | grep -E "_${VOLUME}$" | head -1 || true)"
    [ -n "${real}" ] && MOUNT="$(docker volume inspect -f '{{ .Mountpoint }}' "${real}" 2>/dev/null || true)"
  fi
fi
if [ -z "${MOUNT}" ] || [ ! -d "${MOUNT}" ]; then
  log "cannot resolve ${VOLUME} mountpoint (PAPERCLIP_DATA_DIR=${PAPERCLIP_DATA_DIR:-unset}) — nothing to do"
  exit 0
fi

# --- Locate the backups directory and the newest completed dump --------------
# Mirrors the guard's glob. More than one instance directory is not a shape this
# deployment has; if it ever appears, the newest dump across all of them decides
# freshness and the dump is written next to it.
newest_gz=""; newest_epoch=0; backups_dir=""
for d in "${MOUNT}"/instances/*/data/backups; do
  [ -d "${d}" ] || continue
  [ -z "${backups_dir}" ] && backups_dir="${d}"
  for f in "${d}"/paperclip-*.sql.gz; do
    [ -f "${f}" ] || continue
    e="$(stat -c %Y "${f}" 2>/dev/null || echo 0)"
    if [ "${e}" -gt "${newest_epoch}" ]; then
      newest_epoch="${e}"; newest_gz="${f}"; backups_dir="${d}"
    fi
  done
done
if [ -z "${backups_dir}" ]; then
  log "no ${MOUNT}/instances/*/data/backups directory — Paperclip not initialised here, nothing to do"
  exit 0
fi

now="$(date +%s)"
if [ -n "${newest_gz}" ]; then
  age_min=$(( (now - newest_epoch) / 60 ))
  log "newest dump ${newest_gz##*/} is ${age_min}m old (threshold ${STALE_MIN}m = ${BACKUP_INTERVAL_MIN}m interval + ${SLACK_MIN}m slack, ${BACKUP_INTERVAL_SRC})"
  if [ "${age_min}" -le "${STALE_MIN}" ]; then
    log "fresh — the server's own scheduler is keeping up; nothing to do"
    exit 0
  fi
  log "STALE by $(( age_min - STALE_MIN ))m — taking a catch-up dump"
else
  # A never-backed-up instance directory. Could be a genuinely fresh box, but
  # this repo only ever provisions one where the server has already run, and an
  # empty backups dir with a live database is precisely the starved state.
  age_min=-1
  log "no completed dump in ${backups_dir} — taking the first dump"
fi

# --- Headroom gates ---------------------------------------------------------
USE_PCT="$(df --output=pcent "${backups_dir}" | tail -1 | tr -dc '0-9')"
AVAIL_B=$(( $(df --output=avail -k "${backups_dir}" | tail -1 | tr -dc '0-9') * 1024 ))
if [ "${USE_PCT:-0}" -ge "${MAX_USE_PCT}" ]; then
  log "ERROR volume at ${USE_PCT}% (ceiling ${MAX_USE_PCT}%) — refusing to add a dump; volume guard pages on headroom" >&2
  exit 1
fi
if [ -n "${newest_gz}" ]; then
  need=$(( $(stat -c %s "${newest_gz}" 2>/dev/null || echo 0) * HEADROOM_FACTOR ))
  if [ "${need}" -gt 0 ] && [ "${AVAIL_B}" -lt "${need}" ]; then
    log "ERROR only ${AVAIL_B} bytes free, want ${need} (${HEADROOM_FACTOR}x newest dump) — refusing" >&2
    exit 1
  fi
fi

# --- Dump -------------------------------------------------------------------
# Local-time stamp, because that is what the server uses for these filenames and
# what paperclip-backup-offsite.py parses out of them.
STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT="${backups_dir}/paperclip-${STAMP}.sql.gz"
TMP="${OUT}.tmp"
if [ -e "${OUT}" ]; then
  log "ERROR ${OUT} already exists — refusing to overwrite" >&2
  exit 1
fi

if [ "${DRY_RUN}" = "1" ]; then
  log "DRY_RUN would dump ${DB_NAME} from ${DB_CONTAINER} → ${OUT}"
  exit 0
fi

cleanup() { rm -f "${TMP}"; }
trap cleanup EXIT

log "dumping ${DB_NAME} from ${DB_CONTAINER} → ${OUT}"
# -T: no TTY under systemd. pipefail makes a pg_dump failure abort before the
# truncated file is ever published. Niced: the box is 4 vCPU and the server runs
# every agent subprocess on it.
if ! nice -n 10 docker compose -f "${COMPOSE_FILE}" exec -T "${DB_CONTAINER}" \
    pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip >"${TMP}"; then
  log "ERROR pg_dump failed — no dump published (volume guard will page on staleness)" >&2
  exit 1
fi

SIZE="$(stat -c %s "${TMP}" 2>/dev/null || echo 0)"
if [ "${SIZE}" -lt "${MIN_DUMP_BYTES}" ]; then
  log "ERROR dump suspiciously small (${SIZE} bytes < ${MIN_DUMP_BYTES}) — discarding" >&2
  exit 1
fi
# Completeness gate, same test the off-box shipper applies: a real pg_dump ends
# at COMMIT; (plus a trailing comment line or two). A truncated pipe does not.
if ! gzip -dc "${TMP}" 2>/dev/null | tail -c 4096 | grep -q 'COMMIT;\|^-- PostgreSQL database dump complete'; then
  log "ERROR dump does not end in a completion marker — discarding" >&2
  exit 1
fi

# Atomic publish, then hand ownership to whoever owns the directory: the server
# (running as its own uid inside the container) has to be able to prune this
# file under its retention policy, and the off-box shipper reads it as root.
mv "${TMP}" "${OUT}"
chmod 644 "${OUT}" 2>/dev/null || true
owner="$(stat -c '%u:%g' "${backups_dir}" 2>/dev/null || true)"
[ -n "${owner}" ] && chown "${owner}" "${OUT}" 2>/dev/null || true

MB=$(( (SIZE + 1048575) / 1048576 ))
log "wrote ${OUT##*/} (${MB}M) — catch-up dump complete after ${age_min}m of staleness"
log "retention and off-box shipping are handled by the server's backupRetention and paperclip-backup-offsite.py; this script prunes nothing"
