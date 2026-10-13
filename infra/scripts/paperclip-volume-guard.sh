#!/usr/bin/env bash
# AgenticOS paperclip-volume-guard — headroom + backup-health watch for the
# `paperclip-data` docker volume (GOL-1632).
#
# WHY THIS EXISTS
# The Paperclip server writes an hourly DB dump to
#   <volume>/instances/*/data/backups/paperclip-*.sql.gz
# and appends origin logs to
#   <volume>/instances/*/logs/server.log
# All of this lives on the `paperclip-data` docker named volume — a SEPARATE
# filesystem from the droplet root. The existing agenticos-disk-guard checks `/`
# only, so a fill of THIS volume is invisible to it. That is exactly how the
# 2026-08-18 disk-full P0 reached 100% (77G/77G) with no early warning, and how
# five consecutive hourly backups then failed silently.
#
# This guard closes both gaps with independent, throttled checks that page the
# Discord ops webhook BEFORE either becomes an outage:
#
#   1. HEADROOM — df of the paperclip-data mountpoint and of the root FS.
#      Posts when the level changes across WARN_PCT (85) / CRIT_PCT (92),
#      with the biggest directories inside the volume (GOL-3255).
#
#   1b. BOUNDED RECLAIM — alerting alone was not enough. On 2026-09-30 the
#      volume hit 90% again carrying 8.4G of dumps, and 2.9G of that was two
#      ORPHANED PARTIAL dumps (2026-09-10, 2026-09-18) left behind by the
#      earlier ENOSPC deaths: the Paperclip server's own retention only ever
#      globs `*.sql.gz`, so a `.sql` that died mid-write is never pruned by
#      anything. The rest was the `backupRetention.dailyDays` window keeping
#      EVERY dump inside it (3 days x 6/day = 18 dumps ~ 5.4G). Check 1b
#      reclaims both, conservatively and loudly — see its header below.
#
#   2. BACKUP FRESHNESS — the newest completed *.sql.gz under the backups dir.
#      Older than STALE_MIN (default = the server's configured backup interval
#      + 35m slack, read from the paperclip-server container env; 60m assumed
#      if the container is down) → alert. This
#      is the compensating control for silent backup failure until the
#      server-side loud-failure fix ships (that fix is in /opt/paperclip, out of
#      this repo's write boundary; tracked on GOL-1632).
#      Since GOL-2858 there is a second control underneath it:
#      paperclip-db-catchup.sh takes the dump itself, hourly, when the server's
#      restart-reset interval has not. So a `backup-stale` page now means BOTH
#      paths failed — see the alert text. A dangling *.sql partial
#      (a dump that died mid-write) is folded in as context, not its own page, so
#      leftover cleanup debt (board-gated on GOL-1631) never spams the channel.
#
# Runs hourly via agenticos-paperclip-volume-guard.timer. Runs as root because
# `docker volume inspect` needs docker access. Degrades gracefully: missing
# webhook → log + skip; unresolvable volume / no backups yet → log + skip that
# check (a fresh box before its first backup must never false-page).
#
# Alerts are throttled per reason (REPAGE_MIN, default 360m) via stamp files in
# /run so a sustained condition re-pages every ~6h instead of every hour.
#
# The Discord webhook URL is read from /opt/agenticos/.env
# (DISCORD_OPS_WEBHOOK_URL), same as disk-guard.sh.
set -euo pipefail

WARN_PCT="${WARN_PCT:-85}"
# Staleness threshold tracks the server's actual backup cadence
# (PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES, read from the running container) plus
# 35m slack — the historical 95 default was 60m hourly + 35. If the container
# is down or the env var unreadable, fall back to the hourly assumption: no
# running server means no backups, and that SHOULD page. Explicit STALE_MIN in
# the environment still overrides everything.
# NOTE the trailing `|| true`: the script runs under `set -euo pipefail`, so a
# non-zero `docker inspect` (container ABSENT — the recreate window, or a dead
# daemon) would otherwise abort the guard on this bare assignment, before the
# fallback below and before any check runs. Same idiom as the mountpoint probe.
BACKUP_INTERVAL_MIN="$(docker inspect paperclip-server \
  --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
  | sed -n 's/^PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES=//p' | head -1 || true)"
BACKUP_INTERVAL_SRC="paperclip-server env"
case "${BACKUP_INTERVAL_MIN}" in
  ''|*[!0-9]*)
    BACKUP_INTERVAL_MIN=60
    BACKUP_INTERVAL_SRC="fallback, container down or env unset"
    ;;
esac
STALE_MIN="${STALE_MIN:-$((BACKUP_INTERVAL_MIN + 35))}"
REPAGE_MIN="${REPAGE_MIN:-360}"

# --- bounded-reclaim knobs (check 1b) ---
# RECLAIM=0 turns the whole reclaim off (alert-only, the pre-2026-09-30
# behaviour). DRY_RUN=1 logs what it would remove and posts nothing.
RECLAIM="${RECLAIM:-1}"
# Intra-day thinning only runs once we are ALREADY past the 80% page, so the
# steady state stays governed by the server's retention, not by this script.
RECLAIM_PCT="${RECLAIM_PCT:-85}"
# Always keep the newest N dumps whatever their timestamps say, and never let a
# backups dir drop below MIN_KEEP files. Cheap insurance: these dumps are
# SINGLE-COPY — nothing ships them off-box yet (docs/runbooks/backup-and-recovery.md
# section D).
KEEP_NEWEST="${KEEP_NEWEST:-2}"
MIN_KEEP="${MIN_KEEP:-3}"
# A `.sql` younger than this may be a dump in flight (a real one takes ~3m at
# 300M) — never touch it. Two full backup intervals, floor 180m.
_partial_default=$(( BACKUP_INTERVAL_MIN * 2 ))
[ "${_partial_default}" -lt 180 ] && _partial_default=180
PARTIAL_AGE_MIN="${PARTIAL_AGE_MIN:-${_partial_default}}"
DRY_RUN="${DRY_RUN:-0}"
ENV_FILE="${ENV_FILE:-/opt/agenticos/.env}"
VOLUME="${PAPERCLIP_VOLUME:-paperclip-data}"
STAMP_DIR="${STAMP_DIR:-/run/agenticos/volume-guard}"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo agenticos-droplet)"

LOG_TS() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(LOG_TS)] paperclip-volume-guard: $*"; }

mkdir -p "${STAMP_DIR}" 2>/dev/null || true

post_discord() { # $1 = message
  local url=""
  if [ -f "${ENV_FILE}" ]; then
    url="$(grep -E '^DISCORD_OPS_WEBHOOK_URL=' "${ENV_FILE}" | cut -d= -f2- || true)"
  fi
  if [ -z "${url}" ]; then
    log "DISCORD_OPS_WEBHOOK_URL unset — skipping webhook" >&2
    return 0
  fi
  POSTED=0
  curl -fsS -m 15 -H 'Content-Type: application/json' \
    -d "$(jq -n --arg c "$1" '{content:$c}')" \
    "${url}" >/dev/null 2>&1 \
    && { POSTED=1; log "posted to Discord ops webhook"; } \
    || log "WARN webhook post failed" >&2
}

alert() { # $1 = reason-key; $2 = message  (throttled per reason via stamp file)
  local key="$1" msg="$2" stamp="${STAMP_DIR}/$1" last now
  if [ -f "${stamp}" ]; then
    last="$(stat -c %Y "${stamp}" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    if [ $(( (now - last) / 60 )) -lt "${REPAGE_MIN}" ]; then
      log "alert '${key}' throttled (last <${REPAGE_MIN}m ago) — skipping webhook"
      return 0
    fi
  fi
  post_discord "${msg}"
  : > "${stamp}" 2>/dev/null || true
}

# --- Resolve the volume mountpoint on the host ---
# Prefer `docker volume inspect` (exact); PAPERCLIP_DATA_DIR overrides for
# non-docker layouts / smoke tests.
MOUNT="${PAPERCLIP_DATA_DIR:-}"
if [ -z "${MOUNT}" ]; then
  MOUNT="$(docker volume inspect -f '{{ .Mountpoint }}' "${VOLUME}" 2>/dev/null || true)"
  # compose namespaces volumes as <project>_<name>; try that if the bare name missed.
  if [ -z "${MOUNT}" ]; then
    real="$(docker volume ls -q 2>/dev/null | grep -E "_${VOLUME}$" | head -1 || true)"
    [ -n "${real}" ] && MOUNT="$(docker volume inspect -f '{{ .Mountpoint }}' "${real}" 2>/dev/null || true)"
  fi
fi
if [ -z "${MOUNT}" ] || [ ! -d "${MOUNT}" ]; then
  log "cannot resolve paperclip-data mountpoint (volume=${VOLUME}, PAPERCLIP_DATA_DIR=${PAPERCLIP_DATA_DIR:-unset}) — nothing to check"
  exit 0
fi
log "paperclip-data mountpoint: ${MOUNT}"

# --- Check 1: headroom, alerted on TRANSITIONS, with what is inside (GOL-3255) ---
# On this droplet the volume is a directory on the root FS, so "volume full" and
# "root FS full" are the same event. The 2026-10-08 fill reached 97% and killed
# a deploy, and the only signals were Docker-centric (disk-guard, disk-reclaim
# freed 0 B) — none said WHAT was growing. So this check:
#   * takes the worse of the root FS and the volume's FS,
#   * maps it to a level: ok < WARN_PCT <= warn < CRIT_PCT <= crit,
#   * posts ONLY when the level changes (up or down, like GOL-3226's vendor
#     guard), so a sustained 86% is one message, not one every REPAGE_MIN,
#   * and puts the biggest directories INSIDE paperclip-data in the message.
# The level is kept in STATE_DIR (persistent, unlike the /run stamps), so a
# reboot does not re-announce a level we already announced.
CRIT_PCT="${CRIT_PCT:-92}"
STATE_DIR="${STATE_DIR:-/var/lib/agenticos/volume-guard}"
TOP_N="${TOP_N:-8}"
mkdir -p "${STATE_DIR}" 2>/dev/null || true

USE_PCT="$(df --output=pcent "${MOUNT}" | tail -1 | tr -dc '0-9')"
AVAIL_H="$(df -h --output=avail "${MOUNT}" | tail -1 | tr -d ' ')"
ROOT_PCT="$(df --output=pcent "${ROOT_FS:-/}" | tail -1 | tr -dc '0-9')"
WORST_PCT=$(( ${USE_PCT:-0} > ${ROOT_PCT:-0} ? ${USE_PCT:-0} : ${ROOT_PCT:-0} ))
log "paperclip-data FS at ${USE_PCT}% (avail ${AVAIL_H}); root FS at ${ROOT_PCT}%; warn ${WARN_PCT}% crit ${CRIT_PCT}%"

level_of() { # $1 = pct
  if [ "$1" -ge "${CRIT_PCT}" ]; then echo crit
  elif [ "$1" -ge "${WARN_PCT}" ]; then echo warn
  else echo ok; fi
}

# Biggest directories inside the volume, at most 4 levels down, with a parent
# dropped when its children already explain it (so the list says
# `.../data/run-logs 3.3G`, not `instances 16G` + `instances/default 16G` + …).
top_consumers() {
  timeout 300 du -xm --max-depth=4 "${MOUNT}" 2>/dev/null | python3 -c '
import sys
root, n = sys.argv[1].rstrip("/"), int(sys.argv[2])
rows = []
for line in sys.stdin:
    mb, _, p = line.rstrip("\n").partition("\t")
    if p.rstrip("/") != root and mb.isdigit():
        rows.append((int(mb), p[len(root):] or "/"))
rows.sort(reverse=True)
# A parent is "explained" (dropped) when one direct child holds >=60% of it,
# or its children together hold >=90% and the biggest is >=25% -- which keeps
# a dir of many similar small children (e.g. /work) as ONE line.
explained = set()
for mb, p in rows:
    kids = [cmb for cmb, c in rows if c.startswith(p.rstrip("/") + "/")
            and "/" not in c[len(p.rstrip("/")) + 1:]]
    if kids and (max(kids) * 10 >= mb * 6
                 or (sum(kids) * 10 >= mb * 9 and max(kids) * 4 >= mb)):
        explained.add(p)
out = [(mb, p) for mb, p in rows if p not in explained][:n]
for mb, p in out:
    print(f"• `{p}` {mb/1024:.1f}G" if mb >= 1024 else f"• `{p}` {mb}M")
' "${MOUNT}" "${TOP_N}" || true
}

LEVEL="$(level_of "${WORST_PCT}")"
PREV="$(cat "${STATE_DIR}/level" 2>/dev/null || echo ok)"
log "headroom level ${PREV} -> ${LEVEL}"
if [ "${LEVEL}" != "${PREV}" ]; then
  case "${LEVEL}" in
    crit) icon=":rotating_light:"; what="is at **${WORST_PCT}%** (>=${CRIT_PCT}%). A paperclip-server deploy needs ~15G free and will fail" ;;
    warn) icon=":warning:"; what="is at **${WORST_PCT}%** (>=${WARN_PCT}%)" ;;
    ok)   icon=":white_check_mark:"; what="is back under ${WARN_PCT}% (**${WORST_PCT}%**)" ;;
  esac
  msg="${icon} **${HOSTNAME_SHORT}** disk ${what}, avail ${AVAIL_H} (was ${PREV})."
  if [ "${LEVEL}" != ok ]; then
    top="$(top_consumers)"
    msg="${msg}
Biggest inside paperclip-data:
${top:-• (du timed out)}
Nightly retention (worktree-reaper.sh) removes finished worktrees and ages run-logs; Docker objects are disk-reclaim.yml's job (GOL-3255)."
  fi
  if [ "${DRY_RUN}" = "1" ]; then
    log "DRY_RUN would post: ${msg}"
  else
    post_discord "${msg}"
    # Only remember the level once it was actually announced; a failed (or
    # unconfigured) webhook retries on the next hourly run.
    [ "${POSTED:-0}" = 1 ] && { echo "${LEVEL}" > "${STATE_DIR}/level" 2>/dev/null || true; }
  fi
fi

# --- Check 1b: bounded reclaim (engages AFTER the headroom warning) ---
# Two tiers, both bounded, both LOUD (any reclaim posts to Discord unthrottled):
#
#   Tier A — orphaned partial dumps. Runs at ANY usage, because a partial is
#     pure dead weight at every fill level. A `.sql` is removed only when it is
#     BOTH older than PARTIAL_AGE_MIN (a dump in flight is never touched) AND
#     provably dead: either its completed `.sql.gz` already exists, or the file
#     does not end in the dump's closing `COMMIT;`. A plain `.sql` that DOES end
#     in COMMIT; is left alone and logged — that would be a complete dump the
#     gzip step never got to, and a human should decide.
#
#   Tier B — intra-day thinning. Runs only at/above RECLAIM_PCT, i.e. strictly
#     after the WARN_PCT page, so the normal steady state is still governed by
#     the server's own retention. Keeps the newest KEEP_NEWEST dumps plus the
#     newest dump of each calendar day; drops the remaining same-day duplicates
#     oldest-last. Never drops below MIN_KEEP and never touches the newest.
#     This is the FALLBACK, not the fix — the fix is a tighter
#     `backupRetention` in the Paperclip instance settings.
reclaimed_bytes=0
reclaimed_list=""
reclaimed_n=0

rm_reclaim() { # $1 = path; $2 = why
  local sz mb
  sz="$(stat -c %s "$1" 2>/dev/null || echo 0)"
  mb=$(( (sz + 1048575) / 1048576 ))
  if [ "${DRY_RUN}" = "1" ]; then
    log "DRY_RUN would reclaim $(basename "$1") (${mb}M; $2)"
  else
    if ! rm -f -- "$1"; then
      log "WARN failed to remove $1" >&2
      return 0
    fi
    log "reclaimed $(basename "$1") (${mb}M; $2)"
  fi
  reclaimed_bytes=$(( reclaimed_bytes + sz ))
  reclaimed_n=$(( reclaimed_n + 1 ))
  if [ "${reclaimed_n}" -le 12 ]; then
    reclaimed_list="${reclaimed_list}
• $(basename "$1") (${mb}M — $2)"
  fi
}

if [ "${RECLAIM}" = "1" ]; then
  now_e="$(date +%s)"
  shopt -s nullglob
  # Tier A — orphaned partials, at any fill level.
  for d in "${MOUNT}"/instances/*/data/backups; do
    [ -d "$d" ] || continue
    for p in "$d"/*.sql; do
      p_e="$(stat -c %Y "$p" 2>/dev/null || echo "${now_e}")"
      age=$(( (now_e - p_e) / 60 ))
      if [ "${age}" -lt "${PARTIAL_AGE_MIN}" ]; then
        log "partial $(basename "$p") is ${age}m old (<${PARTIAL_AGE_MIN}m) — may be a dump in flight, leaving it"
        continue
      fi
      if [ -f "${p}.gz" ]; then
        rm_reclaim "$p" "orphan partial, completed .sql.gz exists"
      elif tail -c 400 "$p" 2>/dev/null | tr -d '\0' | grep -q 'COMMIT;'; then
        log "NOT reclaiming $(basename "$p"): plain .sql ending in COMMIT; (looks complete, gzip never ran) — leaving for a human"
      else
        rm_reclaim "$p" "truncated dump, no closing COMMIT;"
      fi
    done
  done

  # Tier B — intra-day thinning, only past RECLAIM_PCT.
  if [ "${USE_PCT:-0}" -ge "${RECLAIM_PCT}" ]; then
    log "usage ${USE_PCT}% >= RECLAIM_PCT ${RECLAIM_PCT}% — thinning intra-day dumps (keep newest ${KEEP_NEWEST} + newest per day, min ${MIN_KEEP})"
    for d in "${MOUNT}"/instances/*/data/backups; do
      [ -d "$d" ] || continue
      rows=()
      while IFS= read -r row; do rows+=("$row"); done < <(
        for f in "$d"/*.sql.gz; do echo "$(stat -c %Y "$f" 2>/dev/null || echo 0) $f"; done | sort -rn
      )
      remaining="${#rows[@]}"
      if [ "${remaining}" -le "${MIN_KEEP}" ]; then
        log "only ${remaining} dump(s) in ${d} (min_keep=${MIN_KEEP}) — nothing to thin"
        continue
      fi
      seen_days=" "
      idx=0
      for row in "${rows[@]}"; do
        idx=$(( idx + 1 ))
        e="${row%% *}"; f="${row#* }"
        # Bucket by the stamp the SERVER put in the filename, not by mtime:
        # the stamp is local time, mtime reads back as UTC, and on a UTC+4..5
        # box the two disagree about which calendar day an evening dump belongs
        # to — enough to make "newest per day" silently drop the wrong file.
        # mtime is only the fallback for a name we cannot parse.
        day="$(printf '%s' "${f##*/}" | sed -n 's/^paperclip-\([0-9]\{4\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)-[0-9]\{6\}\.sql\.gz$/\1-\2-\3/p')"
        [ -n "${day}" ] || day="$(date -u -d "@${e}" +%Y-%m-%d 2>/dev/null || echo unknown)"
        if [ "${idx}" -le "${KEEP_NEWEST}" ]; then
          case "${seen_days}" in *" ${day} "*) : ;; *) seen_days="${seen_days}${day} " ;; esac
          continue
        fi
        case "${seen_days}" in
          *" ${day} "*)
            if [ "${remaining}" -le "${MIN_KEEP}" ]; then
              log "min_keep=${MIN_KEEP} reached in ${d} — stopping"
              break
            fi
            rm_reclaim "$f" "intra-day duplicate for ${day}"
            remaining=$(( remaining - 1 ))
            ;;
          *) seen_days="${seen_days}${day} " ;;
        esac
      done
    done
  else
    log "usage ${USE_PCT}% < RECLAIM_PCT ${RECLAIM_PCT}% — intra-day thinning not needed"
  fi
  shopt -u nullglob

  if [ "${reclaimed_bytes}" -gt 0 ] && [ "${DRY_RUN}" != "1" ]; then
    RECLAIMED_MB=$(( reclaimed_bytes / 1048576 ))
    more=""
    [ "${reclaimed_n}" -gt 12 ] && more="
…and $(( reclaimed_n - 12 )) more"
    post_discord ":broom: **${HOSTNAME_SHORT}** paperclip-volume-guard reclaimed **${RECLAIMED_MB}M** from the Paperclip backup dir (volume was at ${USE_PCT}%, ${reclaimed_n} file(s)).${reclaimed_list}${more}
This is the GOL-1632 *fallback*, not the fix — if it keeps firing, tighten \`backupRetention\` in the Paperclip instance settings."
    USE_PCT="$(df --output=pcent "${MOUNT}" | tail -1 | tr -dc '0-9')"
    AVAIL_H="$(df -h --output=avail "${MOUNT}" | tail -1 | tr -d ' ')"
    log "post-reclaim: ${USE_PCT}% (avail ${AVAIL_H}); reclaimed ${RECLAIMED_MB}M across ${reclaimed_n} file(s)"
  elif [ "${reclaimed_bytes}" -gt 0 ]; then
    log "DRY_RUN: would have reclaimed $(( reclaimed_bytes / 1048576 ))M across ${reclaimed_n} file(s)"
  else
    log "nothing to reclaim"
  fi
else
  log "RECLAIM=0 — reclaim disabled, alert-only"
fi

# --- Check 2: backup freshness (partial dump folded in as context) ---
shopt -s nullglob
newest_gz=""; newest_epoch=0; partial=""
for d in "${MOUNT}"/instances/*/data/backups; do
  [ -d "$d" ] || continue
  for p in "$d"/*.sql;    do partial="$p"; done
  for f in "$d"/*.sql.gz; do
    e="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
    if [ "$e" -gt "$newest_epoch" ]; then newest_epoch="$e"; newest_gz="$f"; fi
  done
done

if [ -z "${newest_gz}" ] && [ -z "${partial}" ]; then
  log "no dumps found under ${MOUNT}/instances/*/data/backups — skipping freshness check (fresh box?)"
else
  now="$(date +%s)"
  if [ -n "${newest_gz}" ]; then
    age_min=$(( (now - newest_epoch) / 60 ))
    log "newest completed dump: ${newest_gz} (age ${age_min}m; stale threshold ${STALE_MIN}m = ${BACKUP_INTERVAL_MIN}m interval + 35m, ${BACKUP_INTERVAL_SRC})"
  else
    age_min=999999
    log "no completed *.sql.gz dump found; partial present: ${partial:-none}"
  fi
  if [ "${age_min}" -gt "${STALE_MIN}" ]; then
    ctx=""
    [ -n "${partial}" ] && ctx=" A partial dump ($(basename "${partial}")) exists — a dump died mid-write."
    alert backup-stale ":rotating_light: **${HOSTNAME_SHORT}** Paperclip DB backup is STALE — newest completed dump is ${age_min}m old (expected every ${BACKUP_INTERVAL_MIN}m; threshold ${STALE_MIN}m). BOTH paths have failed: the server's own interval AND the hourly catch-up timer (GOL-2858).${ctx} Check \`/var/log/agenticos/paperclip-db-catchup.log\` first — it says why it did not dump — then paperclip-server logs (GOL-1632)."
  fi
fi

log "check complete"
exit 0
