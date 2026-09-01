#!/usr/bin/env bash
# AgenticOS host-clone drift-guard (GOL-1976) — read-only detection layer.
#
# The host systemd timers (curator, pg-backup, viking-backup, disk-guard, …) all
# run scripts out of the on-box clone at /opt/agenticos/repo. GOL-1965 fixed the
# PUSH path: deploy-host-scripts.yml now `git reset --hard origin/main` on that
# clone whenever infra/scripts/** or scripts/** change on main (AgenticOS#650).
#
# THIS guard is the DETECTION layer (defense-in-depth). A deploy can silently
# no-op, an SSH/CI hop can fail before it reaches the box, or someone can leave
# the clone detached — any of which strands the timers on stale code with no
# signal. This guard runs a few times a day, OBSERVES the clone, and posts to the
# Grove ops Discord webhook if it has drifted. It is strictly read-only:
#
#   • `git fetch --quiet origin main` (no working-tree mutation)
#   • compares local HEAD to origin/main (behind / ahead / detached)
#   • asserts `git remote get-url origin` == the canonical Goldberry-Playground
#     URL (matches the assertion #650 added, so a pre-transfer EngineeringMoonBear
#     remote — which fetches only through the fragile GitHub transfer redirect —
#     is surfaced)
#
# It DOES NOT reset/pull/checkout — repairing drift is #650's job, not this
# guard's. Silent (exit 0, no webhook) when the clone is in sync. The reset lives
# in the deploy workflow so this guard can be safely required to run unprivileged.
#
# Runs as the `deploy` user (repo owner → no "dubious ownership", and the same
# fetch context that #650's reset uses). The Discord webhook URL is read from
# /opt/agenticos/.env (DISCORD_OPS_WEBHOOK_URL), same store as disk-guard.sh /
# paperclip-volume-guard.sh; if unset the guard still logs but skips the webhook
# so a fresh box without the secret degrades gracefully.
set -euo pipefail

REPO="${REPO:-/opt/agenticos/repo}"
ENV_FILE="${ENV_FILE:-/opt/agenticos/.env}"
CANONICAL_ORIGIN="${CANONICAL_ORIGIN:-https://github.com/Goldberry-Playground/AgenticOS.git}"
BRANCH="${BRANCH:-main}"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo agenticos-droplet)"

LOG_TS() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(LOG_TS)] host-clone-drift-guard: $*"; }

post_discord() { # $1 = message
  local url=""
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

# Humanize a positive second-count into "Xd Yh" / "Yh Zm" / "Zm".
humanize_secs() { # $1 = seconds (integer, >=0)
  local s="${1:-0}" d h m
  d=$(( s / 86400 )); s=$(( s % 86400 ))
  h=$(( s / 3600 ));  s=$(( s % 3600 ))
  m=$(( s / 60 ))
  if   [ "${d}" -gt 0 ]; then echo "${d}d ${h}h"
  elif [ "${h}" -gt 0 ]; then echo "${h}h ${m}m"
  else echo "${m}m"
  fi
}

if [ ! -d "${REPO}/.git" ]; then
  log "no git clone at ${REPO} — alerting" >&2
  post_discord ":rotating_light: **${HOSTNAME_SHORT}** host-clone drift: no git repo at \`${REPO}\` — the host timers have nothing to run from."
  exit 0
fi

cd "${REPO}"

# Collect drift reasons; alert once with all of them, stay silent if none.
reasons=()

# 1) origin URL assertion (mirrors the assertion AgenticOS#650 added).
CUR_ORIGIN="$(git remote get-url origin 2>/dev/null || echo '<none>')"
if [ "${CUR_ORIGIN}" != "${CANONICAL_ORIGIN}" ]; then
  reasons+=("origin remote is \`${CUR_ORIGIN}\` (expected \`${CANONICAL_ORIGIN}\`)")
fi

# 2) fetch the tracked branch (read-only; updates refs/remotes only).
if ! git fetch --quiet origin "${BRANCH}" 2>/dev/null; then
  log "git fetch origin ${BRANCH} FAILED — alerting (box may be network/credential-blind)" >&2
  post_discord ":rotating_light: **${HOSTNAME_SHORT}** host-clone drift: \`git fetch origin ${BRANCH}\` FAILED in \`${REPO}\` — cannot verify the clone is current (network/credential issue on the box?)."
  exit 0
fi

LOCAL="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
REMOTE="$(git rev-parse "origin/${BRANCH}" 2>/dev/null || echo unknown)"

# 3) detached / wrong branch.
CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "${CUR_BRANCH}" = "HEAD" ]; then
  reasons+=("clone is in DETACHED HEAD state (expected branch \`${BRANCH}\`)")
elif [ "${CUR_BRANCH}" != "${BRANCH}" ]; then
  reasons+=("clone is on branch \`${CUR_BRANCH}\` (expected \`${BRANCH}\`)")
fi

# 4) HEAD vs origin/BRANCH.
if [ "${LOCAL}" != "${REMOTE}" ]; then
  # left-right count: "<ahead>\t<behind>" for HEAD...origin/BRANCH.
  counts="$(git rev-list --left-right --count "HEAD...origin/${BRANCH}" 2>/dev/null || echo '? ?')"
  ahead="$(echo "${counts}" | awk '{print $1}')"
  behind="$(echo "${counts}" | awk '{print $2}')"

  lag=""
  local_ct="$(git log -1 --format=%ct HEAD 2>/dev/null || echo '')"
  remote_ct="$(git log -1 --format=%ct "origin/${BRANCH}" 2>/dev/null || echo '')"
  if [ -n "${local_ct}" ] && [ -n "${remote_ct}" ] && [ "${remote_ct}" -gt "${local_ct}" ]; then
    lag=" (~$(humanize_secs "$(( remote_ct - local_ct ))") behind by commit time)"
  fi

  reasons+=("clone HEAD \`${LOCAL:0:12}\` != origin/${BRANCH} \`${REMOTE:0:12}\` — behind ${behind}, ahead ${ahead}${lag}")
fi

if [ "${#reasons[@]}" -eq 0 ]; then
  log "in sync: HEAD=${LOCAL:0:12} on ${CUR_BRANCH}, origin=${CUR_ORIGIN} — nothing to do"
  exit 0
fi

log "DRIFT detected (${#reasons[@]} reason(s)) — alerting"
msg=":warning: **${HOSTNAME_SHORT}** host-clone drift in \`${REPO}\` (the host timers run from here):"
for r in "${reasons[@]}"; do
  log "  - ${r}"
  msg="${msg}
• ${r}"
done
msg="${msg}
Repair path: the deploy-host-scripts workflow (AgenticOS#650) reset-hards this clone on infra/scripts or scripts changes; re-run it, or on the box (root/deploy): \`cd ${REPO} && git fetch origin ${BRANCH} && git reset --hard origin/${BRANCH}\`."
post_discord "${msg}"
exit 0
