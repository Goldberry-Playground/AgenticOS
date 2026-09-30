#!/usr/bin/env bash
# Reap abandoned agent git worktrees from the Paperclip agent box.
#
# Why: agents create per-issue worktrees (.wt-<issue>-<repo>) inside the shared
# project checkouts. Each carries its own node_modules, so an abandoned worktree
# costs ~1GB. On 2026-09-30 thirty-one of them held 3.4GB and were a third of a
# disk-full incident (GOL-1631 / GOL-1632).
#
# Safety: removing a *clean* worktree loses nothing permanent -- the branch ref
# and every commit live in the parent repository's object store, so the work is
# recovered with `git worktree add <path> <branch>`. This script therefore
# refuses to touch a worktree that has uncommitted changes, that any live
# process is sitting in, or that was modified recently.
#
# Idempotent: safe to run repeatedly; converges to "no stale worktrees".
# Dry-run by default -- pass --apply to actually delete.
set -euo pipefail

ROOT="${WORKTREE_REAP_ROOT:-/paperclip/instances/default/projects}"
MIN_AGE_HOURS="${WORKTREE_REAP_MIN_AGE_HOURS:-24}"
APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --root=*) ROOT="${arg#*=}" ;;
    --min-age-hours=*) MIN_AGE_HOURS="${arg#*=}" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '%s\n' "$*"; }

# Paths that a live process has as its cwd or holds an open fd on.
live_paths() {
  local p t
  for p in /proc/[0-9]*; do
    t=$(readlink "$p/cwd" 2>/dev/null) && [ -n "$t" ] && printf '%s\n' "$t"
    for fd in "$p"/fd/*; do
      t=$(readlink "$fd" 2>/dev/null) && [ -n "$t" ] && printf '%s\n' "$t"
    done 2>/dev/null
  done 2>/dev/null
}

LIVE=$(live_paths | sort -u || true)

skipped=0; reaped=0; freed=0
declare -A PARENTS=()

while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  name=$(basename "$wt")
  size_mb=$(du -sm "$wt" 2>/dev/null | cut -f1 || echo 0)

  # 1. recently touched -> probably an in-flight heartbeat
  if [ -n "$(find "$wt" -maxdepth 0 -mmin "-$((MIN_AGE_HOURS * 60))" 2>/dev/null)" ]; then
    log "SKIP  $name (${size_mb}MB): modified < ${MIN_AGE_HOURS}h ago"; skipped=$((skipped+1)); continue
  fi

  # 2. a live process is using it -> deleting would corrupt that run
  if printf '%s\n' "$LIVE" | grep -qF -- "$wt/"; then
    log "SKIP  $name (${size_mb}MB): live process holds a path inside it"; skipped=$((skipped+1)); continue
  fi

  # 3. locate the repo root inside the worktree and require a clean tree
  gitfile=$(find "$wt" -maxdepth 2 -name .git -print -quit 2>/dev/null || true)
  if [ -z "$gitfile" ]; then
    log "SKIP  $name (${size_mb}MB): no .git found"; skipped=$((skipped+1)); continue
  fi
  repo=$(dirname "$gitfile")
  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    log "SKIP  $name (${size_mb}MB): not a usable git worktree"; skipped=$((skipped+1)); continue
  fi
  dirty=$(git -C "$repo" status --porcelain 2>/dev/null | wc -l)
  if [ "$dirty" -ne 0 ]; then
    log "SKIP  $name (${size_mb}MB): $dirty uncommitted change(s)"; skipped=$((skipped+1)); continue
  fi

  # 4. the branch must be reachable from the parent repo, or the commits die with it
  branch=$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
  if [ "$branch" = "HEAD" ]; then
    log "SKIP  $name (${size_mb}MB): detached HEAD, commits would be unreachable"; skipped=$((skipped+1)); continue
  fi
  if [ -z "$common" ] || [ ! -e "$common" ]; then
    log "SKIP  $name (${size_mb}MB): cannot resolve parent repo"; skipped=$((skipped+1)); continue
  fi
  parent=$(dirname "$common")
  if ! git -C "$parent" rev-parse --verify --quiet "refs/heads/$branch" >/dev/null 2>&1; then
    log "SKIP  $name (${size_mb}MB): branch '$branch' not in parent repo"; skipped=$((skipped+1)); continue
  fi

  if [ "$APPLY" -eq 1 ]; then
    rm -rf "$wt"
    log "REAP  $name (${size_mb}MB): branch '$branch' preserved in $(basename "$parent")"
  else
    log "WOULD REAP  $name (${size_mb}MB): branch '$branch' preserved in $(basename "$parent")"
  fi
  PARENTS["$parent"]=1
  reaped=$((reaped+1)); freed=$((freed+size_mb))
done < <(find "$ROOT" -maxdepth 4 -type d -name '.wt-*' 2>/dev/null | sort)

if [ "$APPLY" -eq 1 ]; then
  for parent in "${!PARENTS[@]}"; do
    git -C "$parent" worktree prune 2>/dev/null || true
  done
fi

log "---"
log "reaped=$reaped skipped=$skipped freed=${freed}MB apply=$APPLY"
