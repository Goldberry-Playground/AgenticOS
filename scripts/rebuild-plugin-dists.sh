#!/usr/bin/env bash
#
# rebuild-plugin-dists.sh — GOL-2591
#
# Rebuild the bind-mounted plugin dists in /opt/agenticos/repo after something
# has moved that checkout, and report which plugins actually changed so the
# caller can converge just those in the registry.
#
# WHY THIS EXISTS — the silent plugin DOWNGRADE that disarmed GOL-2371:
# docker-compose.yml bind-mounts `./packages/<p>` (i.e. /opt/agenticos/repo/packages/<p>)
# straight into paperclip-server, so the checkout's `dist/` IS the live plugin
# artifact. deploy-host-scripts.yml `git reset --hard origin/main`s that same
# checkout on any scripts/** push — and it does NOT rebuild, because it was written
# for plain bash host scripts (GOL-1965) and predates the bind mounts mattering.
#
# The committed dist is therefore whatever artifact happened to be checked in. On
# 2026-09-29 that bit hard: AgenticOS #688 landed github-sync 0.16.9 in
# src/manifest.ts but NEVER rebuilt the committed dist (it still held 0.16.8 with
# no `worker-heartbeat` job and no boot-retry code at all). The 20:50Z plugin
# deploy rebuilt it on the box → 0.16.9 → migration 007 ran and the heartbeat
# started. The 20:58Z host-scripts deploy then reset the checkout → dist reverted
# to 0.16.8 → paperclip-server re-activated at 0.16.8 → the `worker-heartbeat`
# job went `paused` and the liveness heartbeat stopped, 14 minutes after it was
# first armed. Nothing anywhere went red.
#
# So: any reset of this checkout must be followed by a rebuild, or the box quietly
# runs whatever stale bundle is committed. Idempotent — on a healthy box where the
# dists are already current this is a no-op rebuild and prints no REBUILT lines.
#
# Usage:
#   scripts/rebuild-plugin-dists.sh                # rebuild every managed plugin
#   scripts/rebuild-plugin-dists.sh <old> <new>    # only plugins whose files moved
#
# Output: `REBUILT: <plugin>` per plugin whose dist bytes changed (the caller
# converges exactly those), then a summary line. Exits non-zero if a build fails
# or leaves an incomplete dist — a half-built dist is the stale-worker trap.
#
# Env: REPO_DIR (default /opt/agenticos/repo)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/opt/agenticos/repo}"
# shellcheck source=scripts/plugin-registry.sh
source "${HERE}/plugin-registry.sh"

cd "$REPO_DIR"

targets=""
if [ "$#" -ge 2 ]; then
  # Scope to plugins the move actually touched. `git diff` on the two revs is the
  # honest question: "did this reset change anything the container reads?"
  changed="$(git diff --name-only "$1" "$2" -- packages/ 2>/dev/null || true)"
  for p in ${PLUGIN_DIRS}; do
    case "$changed" in *"packages/${p}/"*) targets="${targets} ${p}" ;; esac
  done
  targets="${targets# }"
  if [ -z "$targets" ]; then
    echo "rebuild-plugin-dists: no packages/** changes between $1 and $2 — nothing to rebuild."
    echo "REBUILT_COUNT: 0"
    exit 0
  fi
else
  targets="${PLUGIN_DIRS}"
fi
echo "rebuild-plugin-dists: targets = ${targets}"

# Hash BEFORE so we can report what genuinely changed rather than claiming every
# plugin moved on every run (the caller uses this to bound what it /upgrades).
declare -A before
for p in ${targets}; do
  before["$p"]="$(cat "packages/${p}/dist/manifest.js" "packages/${p}/dist/worker.js" 2>/dev/null | sha256sum | cut -d' ' -f1)"
done

filters=""
for p in ${targets}; do filters="${filters} --filter @agenticos/${p}"; done
# shellcheck disable=SC2086  # word-splitting of the filter list is intended
pnpm install --frozen-lockfile ${filters}
# shellcheck disable=SC2086
pnpm ${filters} build

rc=0
count=0
for p in ${targets}; do
  for f in dist/worker.js dist/manifest.js; do
    if [ ! -s "packages/${p}/${f}" ]; then
      echo "FATAL: packages/${p}/${f} missing or empty after build" >&2
      rc=1
    fi
  done
  after="$(cat "packages/${p}/dist/manifest.js" "packages/${p}/dist/worker.js" 2>/dev/null | sha256sum | cut -d' ' -f1)"
  if [ "${before[$p]}" != "$after" ]; then
    echo "REBUILT: ${p}"
    count=$((count + 1))
  else
    echo "unchanged: ${p}"
  fi
done
echo "REBUILT_COUNT: ${count}"
exit "$rc"
