#!/usr/bin/env bash
# AgenticOS pid-pressure guard (GOL-3002) — read-only detection layer.
#
# WHY THIS EXISTS
# ---------------
# paperclip-server runs every agent as a subprocess and is capped at
# pids_limit: 2048 (docker-compose.yml). On 2026-10-05 that cap was exhausted:
# pids.current=2043/2048 with pids.events max=542, of which only 352 were live
# threads — the other 1,691 were ZOMBIES parented to container PID 1. The image
# entrypoint ends in `exec gosu node node … server/dist/index.js`, so PID 1 was
# the node server, and libuv reaps only pids it spawned (never `waitpid(-1)`):
# every orphaned grandchild of an agent run (the run's bash exits, its
# git/chrome/sleep children reparent to PID 1) leaked a pid forever. The oldest
# zombie was 4.8 days old — the container's entire uptime. Two run-failure storms
# followed; 60+ runs died with `spawn /usr/local/bin/claude EAGAIN`.
#
# The FIX is `init: true` on the service (docker's tini as PID 1, which does
# `waitpid(-1)` and reaps any orphan). THIS script is the DETECTION layer, so the
# same class of leak can never go silent for 4.8 days again:
#
#   • it alerts if the cap has ALREADY been hit since container start
#     (pids.events max > 0) — the single highest-signal line, and the one the
#     2026-10-05 audit found at 542;
#   • it alerts on pid-budget pressure (pids.current/pids.max >= 50%), which
#     catches pid exhaustion from ANY cause, not just zombies — including live
#     leftover processes such as headless Chrome that outlives its run (GOL-3003);
#   • it alerts on a standing zombie population, which is a direct regression
#     signal that `init: true` is no longer in effect (it should hold ~0).
#
# Strictly read-only: it inspects `docker inspect`, the container's pids cgroup,
# and /proc. It never kills, restarts, or recreates anything — remediation is a
# human/deploy decision (`docker compose up -d --force-recreate paperclip-server`
# re-arms the DB backup interval, GOL-1632 / GOL-2858, so it is not something a
# timer should do by itself).
#
# Runs as the `deploy` user, which is in the docker group (so `docker inspect`
# needs no sudo) — the same context the deploy workflows use. The Discord webhook
# URL is read from /opt/agenticos/.env (DISCORD_OPS_WEBHOOK_URL), same store as
# disk-guard.sh / host-clone-drift-guard.sh; if unset the guard still logs but
# skips the webhook, so a fresh box without the secret degrades gracefully.
#
# Silent (exit 0, no webhook) when healthy. Alerts are rate-limited by
# STAMP_FILE: at most one post per COOLDOWN_SECS unless the severity LEVEL
# changes (so an escalation is never swallowed by the cooldown).
set -euo pipefail

CONTAINER="${CONTAINER:-paperclip-server}"
ENV_FILE="${ENV_FILE:-/opt/agenticos/.env}"
STAMP_FILE="${STAMP_FILE:-/var/log/agenticos/pid-pressure-guard.stamp}"
# Alert when pids.current/pids.max reaches this percentage of the cap.
PIDS_WARN_PCT="${PIDS_WARN_PCT:-50}"
# Standing zombies above this are a regression signal (with `init: true` the
# steady state is ~0; transient orphans are reaped in milliseconds). Deliberately
# well under the pid budget so it fires LONG before capacity is at risk.
ZOMBIE_WARN="${ZOMBIE_WARN:-100}"
COOLDOWN_SECS="${COOLDOWN_SECS:-21600}" # 6h
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo agenticos-droplet)"
# Seams so scripts/ci/pid-pressure-guard.test.sh can drive every branch without a
# docker daemon, a real cgroup, or real zombies. Production defaults are the real
# paths; the test points them at fixtures.
DOCKER_BIN="${DOCKER_BIN:-docker}"
CGROUP_ROOT="${CGROUP_ROOT:-/sys/fs/cgroup}"
PROC_ROOT="${PROC_ROOT:-/proc}"
# Where the alert goes when there is no webhook: a file, so tests can assert on
# the exact message instead of on a network call.
ALERT_SINK="${ALERT_SINK:-}"

LOG_TS() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(LOG_TS)] pid-pressure-guard: $*"; }

post_discord() { # $1 = message
  local url=""
  if [ -n "${ALERT_SINK}" ]; then
    printf '%s\n' "$1" >> "${ALERT_SINK}"
    log "wrote alert to ALERT_SINK=${ALERT_SINK}"
    return 0
  fi
  if [ -r "${ENV_FILE}" ]; then
    url="$(grep -E '^DISCORD_OPS_WEBHOOK_URL=' "${ENV_FILE}" | cut -d= -f2- || true)"
  fi
  if [ -z "${url}" ]; then
    log "DISCORD_OPS_WEBHOOK_URL unset/unreadable — skipping webhook" >&2
    return 0
  fi
  curl -fsS -m 15 -H 'Content-Type: application/json' \
    -d "$(jq -n --arg c "$1" '{content:$c}')" \
    "${url}" >/dev/null 2>&1 \
    && log "posted to Discord ops webhook" \
    || log "WARN webhook post failed" >&2
}

# Rate-limit: post if the level changed, or the cooldown has elapsed.
should_post() { # $1 = level
  local level="$1" now prev_level prev_ts
  now="$(date +%s)"
  if [ -r "${STAMP_FILE}" ]; then
    read -r prev_level prev_ts < "${STAMP_FILE}" 2>/dev/null || { prev_level=""; prev_ts=0; }
  else
    prev_level=""; prev_ts=0
  fi
  case "${prev_ts}" in ''|*[!0-9]*) prev_ts=0 ;; esac
  if [ "${level}" = "${prev_level}" ] && [ "$(( now - prev_ts ))" -lt "${COOLDOWN_SECS}" ]; then
    log "suppressed by cooldown (level=${level} unchanged, $(( now - prev_ts ))s < ${COOLDOWN_SECS}s)"
    return 1
  fi
  mkdir -p "$(dirname "${STAMP_FILE}")" 2>/dev/null || true
  echo "${level} ${now}" > "${STAMP_FILE}" 2>/dev/null || \
    log "WARN could not write ${STAMP_FILE} — cooldown will not apply" >&2
  return 0
}

# --- Resolve the container -------------------------------------------------
if ! command -v "${DOCKER_BIN}" >/dev/null 2>&1; then
  log "docker CLI (${DOCKER_BIN}) not found — nothing to check" >&2
  exit 0
fi

CID="$("${DOCKER_BIN}" inspect -f '{{.Id}}' "${CONTAINER}" 2>/dev/null || true)"
HOST_PID1="$("${DOCKER_BIN}" inspect -f '{{.State.Pid}}' "${CONTAINER}" 2>/dev/null || echo 0)"
RUNNING="$("${DOCKER_BIN}" inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null || echo false)"
HAS_INIT="$("${DOCKER_BIN}" inspect -f '{{.HostConfig.Init}}' "${CONTAINER}" 2>/dev/null || echo '<unknown>')"

if [ -z "${CID}" ] || [ "${RUNNING}" != "true" ] || [ "${HOST_PID1}" = "0" ]; then
  # Not this guard's job to alert on a down container — the deploy health check
  # and the container's own restart policy own that. Stay quiet.
  log "container ${CONTAINER} not running (running=${RUNNING}) — nothing to check"
  exit 0
fi

# --- Read the pids cgroup -------------------------------------------------
# cgroup v2 + the systemd driver puts it here; fall back to reading it from
# inside the container (its own cgroup is mounted at /sys/fs/cgroup).
CG="${CGROUP_ROOT}/system.slice/docker-${CID}.scope"
read_cg() { # $1 = file basename
  if [ -r "${CG}/$1" ]; then
    cat "${CG}/$1"
  else
    "${DOCKER_BIN}" exec -T "${CONTAINER}" cat "/sys/fs/cgroup/$1" 2>/dev/null || true
  fi
}

PIDS_CURRENT="$(read_cg pids.current | tr -dc '0-9' || true)"
PIDS_MAX_RAW="$(read_cg pids.max | tr -d '[:space:]' || true)"
# pids.events is "max N\n" (cgroup v2); N = times the cap was hit since start.
PIDS_EVENTS_MAX="$(read_cg pids.events | awk '$1=="max"{print $2; exit}' || true)"

[ -n "${PIDS_CURRENT}" ] || { log "could not read pids.current for ${CONTAINER} — skipping" >&2; exit 0; }
case "${PIDS_EVENTS_MAX}" in ''|*[!0-9]*) PIDS_EVENTS_MAX=0 ;; esac

# "max" means no cap; treat as unlimited (no percentage alarm possible).
PIDS_PCT=""
if [ "${PIDS_MAX_RAW}" != "max" ] && [ -n "${PIDS_MAX_RAW}" ]; then
  case "${PIDS_MAX_RAW}" in
    *[!0-9]*) PIDS_MAX_RAW="" ;;
  esac
fi
if [ -n "${PIDS_MAX_RAW}" ] && [ "${PIDS_MAX_RAW}" != "max" ] && [ "${PIDS_MAX_RAW}" -gt 0 ]; then
  PIDS_PCT=$(( PIDS_CURRENT * 100 / PIDS_MAX_RAW ))
fi

# --- Count zombies parented to the container's PID 1 ----------------------
# Host /proc sees container processes. Field 3 of /proc/<pid>/stat is the state
# and field 4 the ppid, but comm (field 2) can contain spaces/parens — so split
# on the LAST ')' before awk'ing. Count only orphans adopted by this container's
# PID 1, so a co-tenant container's zombies are never blamed on this one.
ZOMBIES="$(
  for st in "${PROC_ROOT}"/[0-9]*/stat; do
    read -r line < "${st}" 2>/dev/null || continue
    rest="${line##*) }"
    set -- ${rest}
    [ "${1:-}" = "Z" ] || continue
    [ "${2:-}" = "${HOST_PID1}" ] || continue
    echo x
  done | wc -l | tr -dc '0-9'
)"
: "${ZOMBIES:=0}"

UPTIME_HR="$("${DOCKER_BIN}" inspect -f '{{.State.StartedAt}}' "${CONTAINER}" 2>/dev/null || echo '?')"

log "container=${CONTAINER} init=${HAS_INIT} pids=${PIDS_CURRENT}/${PIDS_MAX_RAW:-max}${PIDS_PCT:+ (${PIDS_PCT}%)} pids.events.max=${PIDS_EVENTS_MAX} zombies=${ZOMBIES} started=${UPTIME_HR}"

# --- Decide ---------------------------------------------------------------
reasons=()
level="ok"

if [ "${PIDS_EVENTS_MAX}" -gt 0 ]; then
  level="critical"
  reasons+=("the pid cap has ALREADY been hit **${PIDS_EVENTS_MAX}×** since container start (\`pids.events max\`) — spawns are failing with EAGAIN right now")
fi

if [ -n "${PIDS_PCT}" ] && [ "${PIDS_PCT}" -ge "${PIDS_WARN_PCT}" ]; then
  [ "${level}" = "critical" ] || level="warning"
  reasons+=("pid budget at **${PIDS_PCT}%** — \`pids.current=${PIDS_CURRENT} / pids.max=${PIDS_MAX_RAW}\` (threshold ${PIDS_WARN_PCT}%)")
fi

if [ "${ZOMBIES}" -ge "${ZOMBIE_WARN}" ]; then
  [ "${level}" = "critical" ] || level="warning"
  reasons+=("**${ZOMBIES}** zombie processes parented to container PID 1 (threshold ${ZOMBIE_WARN}) — with \`init: true\` this should sit near 0, so the reaper is likely NOT in effect (\`HostConfig.Init=${HAS_INIT}\`)")
fi

if [ "${#reasons[@]}" -eq 0 ]; then
  log "healthy — nothing to do"
  exit 0
fi

log "${level}: ${#reasons[@]} reason(s) — alerting"
icon=":warning:"; [ "${level}" = "critical" ] && icon=":rotating_light:"
msg="${icon} **${HOSTNAME_SHORT}** pid pressure on \`${CONTAINER}\` (GOL-3002):"
for r in "${reasons[@]}"; do
  log "  - ${r}"
  msg="${msg}
• ${r}"
done
msg="${msg}
Container started \`${UPTIME_HR}\`, \`init: ${HAS_INIT}\`.
Remediation: confirm \`init: true\` is live (\`docker inspect -f '{{.HostConfig.Init}}' ${CONTAINER}\`); if it is \`false\`, the box is running a stale \`/opt/agenticos/docker-compose.yml\` — re-run the deploy-droplet workflow. To clear the backlog now (interrupts in-flight runs and re-arms the DB backup interval, GOL-1632/GOL-2858 — pick a quiet moment): \`cd /opt/agenticos && docker compose up -d --force-recreate ${CONTAINER}\`."

if should_post "${level}"; then
  post_discord "${msg}"
fi
exit 0
