#!/usr/bin/env bash
# Offline self-test for scripts/ops/reap-finished-worktrees.sh (GOL-3255).
# Builds throwaway repos + worktrees, stubs the GitHub PR lookup, and asserts
# every guard fires, that only finished/lossless worktrees go, and that leftover
# edits on a finished PR are archived (and restorable) before removal.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../ops" && pwd)/reap-finished-worktrees.sh"
TMP=$(mktemp -d); trap 'kill "${livepid:-}" 2>/dev/null || true; rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null
fail=0
pass() { echo "  PASS  $1"; }
bad() { echo "  FAIL  $1"; fail=1; }
has() { if printf '%s' "$3" | grep -qF -- "$2"; then pass "$1"; else bad "$1 (missing: $2)"; fi; }

ROOT="$TMP/work"; mkdir -p "$ROOT"
git init -q --bare "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$ROOT/repo" 2>/dev/null
( cd "$ROOT/repo" && echo x >f && echo node_modules/ >.gitignore && git add . && git commit -qm init && git push -q origin HEAD:main )
git -C "$ROOT/repo" fetch -q origin
git -C "$ROOT/repo" remote set-url origin https://github.com/acme/demo.git

mkwt() { # name branch -> commits one change on its branch
  git -C "$ROOT/repo" worktree add -q -b "$2" "$ROOT/$1" origin/main >/dev/null 2>&1
  ( cd "$ROOT/$1" && echo "$1" >"$1.txt" && git add . && git commit -qm "$1" )
  mkdir -p "$ROOT/$1/node_modules/pkg" && echo big >"$ROOT/$1/node_modules/pkg/i.js"
}
pushed() { git -C "$ROOT/repo" update-ref "refs/remotes/origin/$2" "$(git -C "$ROOT/$1" rev-parse HEAD)"; }
age() { find "$ROOT/$1" -exec touch -h -d '3 days ago' {} +; }

mkwt finished   b-finished;   echo edit >>"$ROOT/finished/f"; echo scratch >"$ROOT/finished/notes.md"
mkwt lossless   b-lossless;   pushed lossless b-lossless
mkwt wip        b-wip                                   # never pushed, no PR
mkwt dirtypush  b-dirtypush;  pushed dirtypush b-dirtypush; echo s >"$ROOT/dirtypush/scratch"
mkwt recent     b-recent
mkwt live       b-live;       pushed live b-live
mkwt locked     b-locked;     pushed locked b-locked; git -C "$ROOT/repo" worktree lock "$ROOT/locked"
mkdir -p "$ROOT/proj"; git -C "$ROOT/repo" worktree add -q -b b-dotwt "$ROOT/proj/.wt-x" origin/main >/dev/null 2>&1
for w in finished lossless wip dirtypush live locked; do age "$w"; done
age proj

# Stub GitHub: `finished` and `recent` have a merged PR whose head is their HEAD.
FIN=$(git -C "$ROOT/finished" rev-parse HEAD); REC=$(git -C "$ROOT/recent" rev-parse HEAD)
cat >"$TMP/stub" <<EOF
#!/usr/bin/env bash
case "\$2" in
  $FIN) echo '[{"number":7,"state":"closed","merged_at":"2026-10-01T00:00:00Z","head":{"sha":"$FIN"}}]' ;;
  $REC) echo '[{"number":8,"state":"closed","merged_at":null,"head":{"sha":"$REC"}}]' ;;
  *) echo '[]' ;;
esac
EOF
chmod +x "$TMP/stub"
export PR_LOOKUP_CMD="$TMP/stub" ARCHIVE_DIR="$TMP/archives"

( cd "$ROOT/live" && exec sleep 60 ) & livepid=$!
sleep 0.3

out=$(bash "$SCRIPT" --root="$ROOT" 2>&1) || true
echo "$out" | sed 's/^/    /'
has "finished PR with edits is reapable"   "WOULD REAP  ${ROOT#/}/finished"  "$out"
has "edits on finished PR are archived"    "1 modified + 1 untracked file(s) archived" "$out"
has "pushed + clean is reapable"            "WOULD REAP  ${ROOT#/}/lossless"  "$out"
has "unpushed, no PR is skipped"            "SKIP  ${ROOT#/}/wip"             "$out"
has "pushed but untracked, no PR skipped"   "SKIP  ${ROOT#/}/dirtypush"       "$out"
has "recently modified is skipped"          "SKIP  ${ROOT#/}/recent"          "$out"
has "live cwd is skipped"                   "live process holds a path"       "$out"
has "locked worktree is skipped"            "worktree is locked"              "$out"
if printf '%s' "$out" | grep -q '\.wt-x'; then bad ".wt-* left to reap-stale-worktrees"; else pass ".wt-* left to reap-stale-worktrees"; fi
[ -d "$ROOT/finished" ] && [ ! -d "$TMP/archives" ] && pass "dry-run deletes and archives nothing" || bad "dry-run touched disk"

out2=$(bash "$SCRIPT" --root="$ROOT" --apply 2>&1) || true
for w in finished lossless; do [ -d "$ROOT/$w" ] && bad "apply removed $w" || pass "apply removed $w"; done
for w in wip dirtypush recent live locked proj/.wt-x repo; do [ -d "$ROOT/$w" ] && pass "apply kept $w" || bad "apply kept $w"; done
if git -C "$ROOT/repo" worktree list --porcelain | grep -q "$ROOT/finished"; then bad "worktree admin entry pruned"; else pass "worktree admin entry pruned"; fi
git -C "$ROOT/repo" rev-parse --verify -q refs/heads/b-finished >/dev/null && pass "branch survives reaping" || bad "branch survives reaping"

# The archive restores the exact edits.
arc=$(ls "$TMP"/archives/finished-*.tar.gz 2>/dev/null | head -1)
if [ -n "$arc" ]; then
  mkdir "$TMP/x"; tar -xzf "$arc" -C "$TMP/x"
  git -C "$ROOT/repo" worktree add -q "$TMP/restore" b-finished >/dev/null 2>&1
  git -C "$TMP/restore" apply "$TMP/x/edits.patch" && grep -q edit "$TMP/restore/f" && pass "archived patch re-applies" || bad "archived patch re-applies"
  [ "$(cat "$TMP/x/untracked/notes.md" 2>/dev/null)" = scratch ] && pass "archived untracked file intact" || bad "archived untracked file intact"
else bad "archive written"; fi

out3=$(bash "$SCRIPT" --root="$ROOT" --apply 2>&1) || true
has "second apply is a no-op" "reaped=0" "$out3"

# No PR lookup available (broker down): a finished-PR worktree falls back to the
# lossless rule only, so its edits are never dropped.
mkwt nobroker b-nobroker; pushed nobroker b-nobroker; echo e >>"$ROOT/nobroker/f"; age nobroker
out4=$(PR_LOOKUP_CMD=false bash "$SCRIPT" --root="$ROOT" --apply 2>&1) || true
[ -d "$ROOT/nobroker" ] && pass "no PR lookup => edited worktree kept" || bad "no PR lookup => edited worktree kept"

[ "$fail" -eq 0 ] && echo "reap-finished-worktrees: all checks passed" || { echo "reap-finished-worktrees: FAILURES"; exit 1; }
