#!/usr/bin/env bash
# Self-test for reap-stale-worktrees.sh. Builds throwaway repos in a temp dir
# and asserts each safety guard both fires and lets clean worktrees through.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/reap-stale-worktrees.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fail=0
check() { # desc, expected-substring, haystack
  if printf '%s' "$3" | grep -qF -- "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1 (missing: $2)"; fail=1; fi
}

mkrepo() { # path
  mkdir -p "$1"; git -C "$1" init -q -b main; echo x > "$1/f"; git -C "$1" add f
  git -C "$1" commit -qm init
}

# Layout must match the reaper's find depth: <root>/<a>/<b>/<checkout>/.wt-*
CK="$TMP/co/proj/_default"; mkdir -p "$CK"
mkrepo "$CK/repo"
git -C "$CK/repo" worktree add -q -b feat-clean "$CK/.wt-clean-repo" >/dev/null
git -C "$CK/repo" worktree add -q -b feat-dirty "$CK/.wt-dirty-repo" >/dev/null
echo "uncommitted" > "$CK/.wt-dirty-repo/scratch.txt"   # untracked -> dirty
# age them past the 24h gate
touch -d '3 days ago' "$CK/.wt-clean-repo" "$CK/.wt-dirty-repo"

out=$("$SCRIPT" --root="$TMP/co" 2>&1) || true
echo "$out"
check "clean worktree is reapable"        "WOULD REAP  .wt-clean-repo" "$out"
check "dirty worktree is skipped"         "SKIP  .wt-dirty-repo"       "$out"
check "dirty reason reported"             "uncommitted change"          "$out"

# recency guard
touch "$CK/.wt-clean-repo"
out2=$("$SCRIPT" --root="$TMP/co" 2>&1) || true
check "recently-modified worktree is skipped" "SKIP  .wt-clean-repo" "$out2"
touch -d '3 days ago' "$CK/.wt-clean-repo"

# live-process guard: a process whose cwd is the worktree *root* (no trailing
# path) must still be detected, or --apply would stomp a running agent.
( cd "$CK/.wt-clean-repo" && exec sleep 30 ) &
livepid=$!
sleep 0.3
out_live=$("$SCRIPT" --root="$TMP/co" 2>&1) || true
check "live process at worktree root is skipped" "live process holds a path" "$out_live"
kill "$livepid" 2>/dev/null || true
wait "$livepid" 2>/dev/null || true

# dry-run must not delete
[ -d "$CK/.wt-clean-repo" ] && echo "  PASS  dry-run left worktree in place" || { echo "  FAIL  dry-run deleted"; fail=1; }

# apply: reaps clean, keeps dirty, and the branch survives in the parent repo
out3=$("$SCRIPT" --root="$TMP/co" --apply 2>&1) || true
[ -d "$CK/.wt-clean-repo" ] && { echo "  FAIL  apply did not remove clean worktree"; fail=1; } || echo "  PASS  apply removed clean worktree"
[ -d "$CK/.wt-dirty-repo" ] && echo "  PASS  apply preserved dirty worktree" || { echo "  FAIL  apply removed dirty worktree"; fail=1; }
if git -C "$CK/repo" rev-parse --verify --quiet refs/heads/feat-clean >/dev/null; then
  echo "  PASS  branch survived reaping (work recoverable)"
else echo "  FAIL  branch lost"; fail=1; fi

# idempotency: a second apply is a no-op and still exits 0
out4=$("$SCRIPT" --root="$TMP/co" --apply 2>&1) || { echo "  FAIL  second run exited non-zero"; fail=1; }
check "second run is a no-op" "reaped=0" "$out4"

[ "$fail" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "FAILURES"; exit 1; }
