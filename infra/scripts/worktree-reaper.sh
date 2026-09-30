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
# Log-only by design: no Discord. Reclaiming disk on schedule is not an event;
# the hourly paperclip-volume-guard already pages if headroom is actually at
# risk. Runs nightly via agenticos-worktree-reaper.timer.
#
# Knobs: DRY_RUN=1 (skip the apply pass), MIN_AGE_HOURS, CONTAINER, REPO, ROOT.
set -euo pipefail

REPO="${REPO:-/opt/agenticos/repo}"
CONTAINER="${CONTAINER:-paperclip-server}"
REAPER="${REPO}/scripts/ops/reap-stale-worktrees.sh"
# 48h, not the reaper's own 24h default: this run is unattended, so give an
# idle-but-not-dead agent a second full day before its worktree is eligible.
MIN_AGE_HOURS="${MIN_AGE_HOURS:-48}"
ROOT="${ROOT:-/paperclip/instances/default/projects}"
DRY_RUN="${DRY_RUN:-0}"

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] worktree-reaper: $*"; }

if [ ! -f "${REAPER}" ]; then
  log "ERROR reaper not found at ${REAPER} — is the clone current? skipping."
  exit 0
fi

# Container absent (recreate window, dead daemon, fresh box) is a skip, never a
# failure: a janitor must not turn a deploy blip into a red unit.
if ! docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -qx true; then
  log "container ${CONTAINER} is not running — nothing to reap, skipping."
  exit 0
fi

run_pass() { # $1 = label; remaining args → reaper
  local label="$1"; shift
  log "--- ${label} (root=${ROOT} min-age=${MIN_AGE_HOURS}h)"
  # `bash -s --` feeds the reaper on stdin; everything after -- lands in "$@".
  if ! docker exec -i -u node "${CONTAINER}" bash -s -- \
        "--root=${ROOT}" "--min-age-hours=${MIN_AGE_HOURS}" "$@" < "${REAPER}"; then
    log "WARN ${label} exited non-zero"
    return 1
  fi
}

run_pass "dry-run" || exit 0

if [ "${DRY_RUN}" = "1" ]; then
  log "DRY_RUN=1 — stopping before the apply pass."
  exit 0
fi

run_pass "apply" --apply || true

log "done."
