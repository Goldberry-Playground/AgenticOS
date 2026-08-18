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
# This guard closes both gaps with two independent, throttled checks that page
# the Discord ops webhook BEFORE either becomes an outage:
#
#   1. HEADROOM — df of the paperclip-data mountpoint. At/above WARN_PCT
#      (default 80) → alert. It does NOT auto-reclaim: the volume holds the live
#      DB dumps + agent state, so pruning is the Paperclip server's job
#      (retention) or a board-gated manual action, never an automatic rm here.
#
#   2. BACKUP FRESHNESS — the newest completed *.sql.gz under the backups dir.
#      Older than STALE_MIN (default 95 = one hourly cycle + slack) → alert. This
#      is the compensating control for silent backup failure until the
#      server-side loud-failure fix ships (that fix is in /opt/paperclip, out of
#      this repo's write boundary; tracked on GOL-1632). A dangling *.sql partial
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

WARN_PCT="${WARN_PCT:-80}"
STALE_MIN="${STALE_MIN:-95}"
REPAGE_MIN="${REPAGE_MIN:-360}"
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
  curl -fsS -m 15 -H 'Content-Type: application/json' \
    -d "$(jq -n --arg c "$1" '{content:$c}')" \
    "${url}" >/dev/null 2>&1 \
    && log "posted to Discord ops webhook" \
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

# --- Check 1: volume headroom ---
USE_PCT="$(df --output=pcent "${MOUNT}" | tail -1 | tr -dc '0-9')"
AVAIL_H="$(df -h --output=avail "${MOUNT}" | tail -1 | tr -d ' ')"
log "paperclip-data FS at ${USE_PCT}% (avail ${AVAIL_H}; warn ${WARN_PCT}%)"
if [ "${USE_PCT:-0}" -ge "${WARN_PCT}" ]; then
  alert headroom ":warning: **${HOSTNAME_SHORT}** paperclip-data volume at **${USE_PCT}%** (avail ${AVAIL_H}, warn >=${WARN_PCT}%). Hourly DB dumps + server.log live here and this volume is NOT auto-reclaimed. Check backup retention / server.log rotation (GOL-1632)."
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
    log "newest completed dump: ${newest_gz} (age ${age_min}m; stale threshold ${STALE_MIN}m)"
  else
    age_min=999999
    log "no completed *.sql.gz dump found; partial present: ${partial:-none}"
  fi
  if [ "${age_min}" -gt "${STALE_MIN}" ]; then
    ctx=""
    [ -n "${partial}" ] && ctx=" A partial dump ($(basename "${partial}")) exists — a dump died mid-write."
    alert backup-stale ":rotating_light: **${HOSTNAME_SHORT}** Paperclip DB backup is STALE — newest completed dump is ${age_min}m old (hourly expected; threshold ${STALE_MIN}m). Backups may be failing silently.${ctx} Check paperclip-server logs (GOL-1632)."
  fi
fi

log "check complete"
exit 0
