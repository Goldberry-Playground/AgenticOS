#!/usr/bin/env bash
# AgenticOS nightly worktree reaper — host-side driver for
# scripts/ops/reap-stale-worktrees.sh (GOL-1632 / AgenticOS#765).
#
# WHY A WRAPPER
# The reaper itself must run INSIDE the paperclip-server container, not on the
# host. Its central safety guard reads /proc/<pid>/{cwd,fd} to refuse any
# worktree a live process is sitting in. Agent processes run in the container's
# PID + mount namespaces, so from the host their cwd symlinks resolve to
# CONTAINER paths (/paperclip/instances/...) which do not exist on the host,
# while the worktrees themselves would have to be addressed by their HOST path
# (/var/lib/docker/volumes/*paperclip-data/_data/...). The two never compare
# equal, so a host-side run would find no live process for ANY worktree and the
# guard would silently no-op — exactly the class of blind-guard bug the live
# check was strengthened to close. Running in the container keeps both sides of
# that comparison in the same namespace, which is the whole point of the guard.
#
# The script is piped in over stdin (`bash -s --`) rather than bind-mounted:
# /opt/agenticos/repo is not mounted into paperclip-server, and adding a mount
# would need a full compose redeploy for a nightly janitor. stdin always runs
# whatever the clone currently holds, which deploy-host-scripts.yml keeps at
# origin/main.
#
# `-u node` is load-bearing. The worktrees are owned by uid 1000 (node); a root
# exec would trip git's dubious-ownership check on every `git status`, every
# worktree would SKIP, and the reaper would report a clean, successful, totally
# inert run.
#
# Two passes on purpose: a dry-run first so the log always records what was
# eligible, then --apply. Nothing is deleted unless the dry-run already named it.
#
# Safety comes from the reaper, not from here: it only removes a .wt-* worktree
# that is >MIN_AGE_HOURS idle, has no uncommitted changes, is held by no live
# process, is not detached, and whose branch still resolves in the parent repo —
# so every removal is recoverable with `git worktree add <path> <branch>`.
#
# GOL-3255 added two more janitors to the same nightly run, same mechanics
# (piped in over stdin, `-u node`, dry-run then --apply):
#   * scripts/ops/reap-finished-worktrees.sh -- the ad-hoc `gol<N>-wt`
#     worktrees in /paperclip/work and <project>/_default that the .wt-* reaper
#     never looked at. Removes one only when its PR is closed/merged (leftover
#     edits archived first) or it is clean with HEAD on a remote branch, it has
#     been idle 48h, and no process is inside it.
#   * scripts/ops/run-log-retention.sh -- gzip heartbeat run logs after 7d,
#     delete after 30d. Files only; `heartbeat_runs` rows are never touched.
# Riding this already-installed timer means the new retention needs no root
# install on the host: deploy-host-scripts.yml refreshes the clone and the next
# 03:40 run picks them up. A failure in one janitor never skips the others.
#
# GOL-3321 added a fourth janitor that runs on the HOST, not in the container:
#   * infra/scripts/paperclip-backup-retention.py -- keep the newest
#     BACKUP_KEEP_NEWEST (6, ~24h) Paperclip DB dumps on the volume and delete
#     older ones ONLY after proving, in the same run, that the off-box shipper
#     is healthy and each dump has a size-matching object in the Spaces bucket.
#     Off-box check fails -> deletes nothing, alerts once per state change.
#     Host-side because the Spaces credentials live in /opt/agenticos/.env and
#     the volume is reached via `docker volume inspect` -- same as the shipper.
#     Same dry-run-then-apply contract; it does not need the container, so a
#     recreate window skips only the in-container janitors, not this one.
#
# Log-only by design: no Discord. Reclaiming disk on schedule is not an event;
# the hourly paperclip-volume-guard already pages if headroom is actually at
# risk. Runs nightly via agenticos-worktree-reaper.timer.
#
# Knobs: DRY_RUN=1 (skip every apply pass), MIN_AGE_HOURS, BACKUP_KEEP_NEWEST,
# CONTAINER, REPO, ROOT.
set -euo pipefail

REPO="${REPO:-/opt/agenticos/repo}"
CONTAINER="${CONTAINER:-paperclip-server}"
REAPER="${REPO}/scripts/ops/reap-stale-worktrees.sh"
FINISHED_REAPER="${REPO}/scripts/ops/reap-finished-worktrees.sh"
RUN_LOG_RETENTION="${REPO}/scripts/ops/run-log-retention.sh"
BACKUP_RETENTION="${REPO}/infra/scripts/paperclip-backup-retention.py"
BACKUP_KEEP_NEWEST="${BACKUP_KEEP_NEWEST:-6}"
# 48h, not the reaper's own 24h default: this run is unattended, so give an
# idle-but-not-dead agent a second full day before its worktree is eligible.
MIN_AGE_HOURS="${MIN_AGE_HOURS:-48}"
ROOT="${ROOT:-/paperclip/instances/default/projects}"
DRY_RUN="${DRY_RUN:-0}"

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] worktree-reaper: $*"; }

# Container absent (recreate window, dead daemon, fresh box) is a skip, never a
# failure: a janitor must not turn a deploy blip into a red unit. Only the
# in-container janitors need it; the host-side backup retention still runs.
CONTAINER_UP=1
if ! docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -qx true; then
  log "container ${CONTAINER} is not running — skipping the in-container janitors."
  CONTAINER_UP=0
fi

in_container() { # $1 = label; $2 = script; remaining args → script
  local label="$1" script="$2"; shift 2
  log "--- ${label}"
  # `bash -s --` feeds the script on stdin; everything after -- lands in "$@".
  if ! docker exec -i -u node "${CONTAINER}" bash -s -- "$@" < "${script}"; then
    log "WARN ${label} exited non-zero"
    return 1
  fi
}

# Dry-run, then (unless DRY_RUN=1) apply. A failed dry-run skips that janitor's
# apply, never the next janitor.
janitor() { # $1 = name; $2 = script; remaining args → script
  local name="$1" script="$2"; shift 2
  if [ "${CONTAINER_UP}" != 1 ]; then
    log "SKIP ${name}: container ${CONTAINER} is not running."
    return 0
  fi
  if [ ! -f "${script}" ]; then
    log "WARN ${name}: ${script} not found — is the clone current? skipping."
    return 0
  fi
  in_container "${name} dry-run" "${script}" "$@" || return 0
  if [ "${DRY_RUN}" = "1" ]; then
    log "DRY_RUN=1 — ${name}: stopping before the apply pass."
    return 0
  fi
  in_container "${name} apply" "${script}" "$@" --apply || true
}

janitor "stale .wt-* worktrees (root=${ROOT} min-age=${MIN_AGE_HOURS}h)" "${REAPER}" \
  "--root=${ROOT}" "--min-age-hours=${MIN_AGE_HOURS}"
janitor "finished worktrees (min-age=${MIN_AGE_HOURS}h)" "${FINISHED_REAPER}" \
  "--min-age-hours=${MIN_AGE_HOURS}"
janitor "run-log retention" "${RUN_LOG_RETENTION}"

# Host-side janitor: same dry-run-then-apply contract and the same isolation
# (its exit status is logged, never propagated). Runs as this unit's user
# (root) so it can read /opt/agenticos/.env and the docker volume.
host_janitor() { # $1 = name; $2 = script; remaining args → script
  local name="$1" script="$2"; shift 2
  if [ ! -f "${script}" ]; then
    log "WARN ${name}: ${script} not found — is the clone current? skipping."
    return 0
  fi
  log "--- ${name} dry-run"
  if ! python3 "${script}" "$@" --dry-run; then
    log "WARN ${name} dry-run exited non-zero — skipping its apply pass"
    return 0
  fi
  if [ "${DRY_RUN}" = "1" ]; then
    log "DRY_RUN=1 — ${name}: stopping before the apply pass."
    return 0
  fi
  log "--- ${name} apply"
  python3 "${script}" "$@" --apply || log "WARN ${name} apply exited non-zero"
}

KEEP_NEWEST="${BACKUP_KEEP_NEWEST}" \
  host_janitor "on-box backup retention (keep newest ${BACKUP_KEEP_NEWEST}, off-box verified only)" "${BACKUP_RETENTION}"

log "done."
