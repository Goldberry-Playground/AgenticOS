#!/usr/bin/env bash
# Offline behavioural harness for the per-agent git identity hooks (GOL-2986).
#
# Reproduces the GOL-2976 shared-worktree identity bleed in a throwaway repo and
# asserts the hook's contract: fail CLOSED on a proven mis-attribution (repairing the
# identity so the retry lands correctly), exit 0 for every ambiguous or human case,
# and never let a repo-provided hook run.
#
# Hermetic: GIT_CONFIG_GLOBAL/SYSTEM are pinned to /dev/null and the agent id +
# identity map are injected, so it does not read the live agent roster or ~/.gitconfig.
set -uo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
AGENT_GIT_DIR="$repo_root/agent-git"
IDENTITY="$AGENT_GIT_DIR/agent-identity.mjs"
HOOKS="$AGENT_GIT_DIR/hooks"

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset PAPERCLIP_AGENT_ID AGENT_GIT_AGENT_ID AGENT_GIT_IDENTITY_ASSERT 2>/dev/null || true
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL 2>/dev/null || true

TMP=$(mktemp -d "${TMPDIR:-/tmp}/agent-git-identity.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

A_ID=aaaaaaaa-0000-0000-0000-00000000000a
B_ID=bbbbbbbb-0000-0000-0000-00000000000b
A_NAME="Agent - Ayla"; A_MAIL="ayla@example.test"
B_NAME="Agent - Bodhi"; B_MAIL="bodhi@example.test"
N_NAME="Neutral Bot"; N_MAIL="neutral[bot]@example.test"
export AGENT_GIT_IDENTITY_MAP="$TMP/map.json"
cat > "$AGENT_GIT_IDENTITY_MAP" <<JSON
{"neutral":{"name":"$N_NAME","email":"$N_MAIL"},
 "agents":{
  "$A_ID":{"name":"$A_NAME","email":"$A_MAIL"},
  "$B_ID":{"name":"$B_NAME","email":"$B_MAIL"}
}}
JSON

pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3], got [$2]"; fi; }
contains(){ case "$2" in *"$3"*) ok "$1";; *) bad "$1" "expected to contain [$3], got [$2]";; esac; }

# A repo wired exactly like an agent box: hooks come from scripts/agent-git/hooks.
new_repo() { # $1 = dir
  git init -q "$1"
  git -C "$1" config core.hooksPath "$HOOKS"
  printf 'seed\n' > "$1/seed.txt"
  git -C "$1" -c user.name=Seed -c user.email=seed@example.test add seed.txt
  git -C "$1" -c user.name=Seed -c user.email=seed@example.test commit -q -m seed
}
author_of(){ git -C "$1" log -1 --pretty=%ae; }
commit_in(){ # $1 = dir, $2 = file content tag, rest: env already exported by caller
  printf '%s\n' "$2" > "$1/$2.txt"
  git -C "$1" add "$2.txt"
  git -C "$1" commit -m "chore: $2" 2>"$TMP/stderr.$2" >"$TMP/stdout.$2"
}

echo "== 1. the live identity map is well formed"
node - "$repo_root/agent-git/agent-identities.json" <<'NODE'
const fs = require("node:fs");
const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const agents = raw.agents || {};
if (!raw.neutral?.name || !raw.neutral?.email) throw new Error("missing `neutral` fallback identity");
const ids = Object.keys(agents);
if (ids.length === 0) throw new Error("no agents in the map");
const seen = new Set();
for (const [id, v] of Object.entries(agents)) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error(`key is not a uuid: ${id}`);
  if (!v || typeof v.name !== "string" || !v.name.trim()) throw new Error(`${id}: missing name`);
  if (typeof v.email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(v.email)) throw new Error(`${id}: bad email ${v.email}`);
  const key = v.email.toLowerCase();
  if (seen.has(key)) throw new Error(`duplicate email ${v.email} — two agents would be indistinguishable`);
  seen.add(key);
}
NODE
if [ $? -eq 0 ]; then ok "agent-identities.json: uuid keys, name+email present, emails unique, neutral set"; else bad "agent-identities.json shape"; fi

echo "== 2. no acting agent (human / CI / host) => never blocks"
new_repo "$TMP/human"
git -C "$TMP/human" config user.name Human
git -C "$TMP/human" config user.email human@example.test
commit_in "$TMP/human" human
check "human commit succeeds" "$?" "0"
check "human keeps their own author" "$(author_of "$TMP/human")" "human@example.test"
check "no identity pinned for a human" "$(git -C "$TMP/human" config --local --get user.email)" "human@example.test"

echo "== 3. agent id absent from the map => fails safe (no assertion)"
new_repo "$TMP/unknown"
git -C "$TMP/unknown" config user.email stale@example.test
git -C "$TMP/unknown" config user.name Stale
( export PAPERCLIP_AGENT_ID=cccccccc-0000-0000-0000-00000000000c
  commit_in "$TMP/unknown" unknown )
check "unknown agent commit succeeds" "$?" "0"
check "author untouched" "$(author_of "$TMP/unknown")" "stale@example.test"

echo "== 4. acting agent already correct => succeeds and the identity is pinned per worktree"
new_repo "$TMP/match"
git -C "$TMP/match" config user.name "$A_NAME"
git -C "$TMP/match" config user.email "$A_MAIL"
( export PAPERCLIP_AGENT_ID=$A_ID; commit_in "$TMP/match" match )
check "matching commit succeeds" "$?" "0"
check "author is the acting agent" "$(author_of "$TMP/match")" "$A_MAIL"
check "identity is now per-worktree" "$(git -C "$TMP/match" config --worktree --get user.email)" "$A_MAIL"
contains "Co-authored-by trailer stamped" "$(git -C "$TMP/match" log -1 --pretty=%B)" "Co-authored-by: $A_NAME <$A_MAIL>"

echo "== 5. GOL-2976 bleed: a sibling agent's identity in the SHARED .git/config"
new_repo "$TMP/shared"
# The host checkout step writes the acting agent's identity into the repo-local
# config; with several runs in flight the last writer owns every worktree.
git -C "$TMP/shared" config user.name "$B_NAME"
git -C "$TMP/shared" config user.email "$B_MAIL"
git -C "$TMP/shared" worktree add -q "$TMP/wt-a" -b feat-a
check "bled: fresh worktree inherits the sibling's identity" "$(git -C "$TMP/wt-a" config --get user.email)" "$B_MAIL"
( export PAPERCLIP_AGENT_ID=$A_ID; commit_in "$TMP/wt-a" bleed )
check "mis-attributed commit is BLOCKED" "$?" "1"
contains "block message names the defect" "$(cat "$TMP/stderr.bleed")" "BLOCKED: this commit would be attributed to the wrong agent"
contains "block message names the acting agent" "$(cat "$TMP/stderr.bleed")" "$A_MAIL"
check "nothing was committed" "$(git -C "$TMP/wt-a" log --oneline | wc -l | tr -d ' ')" "1"
check "repaired: per-worktree identity is the acting agent" "$(git -C "$TMP/wt-a" config --worktree --get user.email)" "$A_MAIL"
# Replaced, not unset: a repo with no resolvable identity makes git die (128) before
# any hook runs, so unsetting would trade mis-attribution for a cryptic hard failure.
check "repaired: the shared .git/config identity is de-personalised" "$(git -C "$TMP/shared" config --local --get user.email)" "$N_MAIL"
( export PAPERCLIP_AGENT_ID=$A_ID; commit_in "$TMP/wt-a" retry )
check "the retry succeeds with no further action" "$?" "0"
check "retry author is the real author" "$(author_of "$TMP/wt-a")" "$A_MAIL"
# ... and the sibling, whose shared value we just removed, converges the same way.
( export PAPERCLIP_AGENT_ID=$B_ID; commit_in "$TMP/shared" sibling )
check "sibling in the main checkout is blocked once" "$?" "1"
( export PAPERCLIP_AGENT_ID=$B_ID; commit_in "$TMP/shared" sibling2 )
check "sibling retry succeeds" "$?" "0"
check "sibling commits as itself" "$(author_of "$TMP/shared")" "$B_MAIL"
check "worktree identity survived the sibling's claim" "$(git -C "$TMP/wt-a" config --get user.email)" "$A_MAIL"

echo "== 6. GIT_AUTHOR_EMAIL env wins over a wrong config => allowed"
new_repo "$TMP/envwin"
git -C "$TMP/envwin" config user.email "$B_MAIL"
git -C "$TMP/envwin" config user.name "$B_NAME"
( export PAPERCLIP_AGENT_ID=$A_ID GIT_AUTHOR_NAME="$A_NAME" GIT_AUTHOR_EMAIL="$A_MAIL" \
         GIT_COMMITTER_NAME="$A_NAME" GIT_COMMITTER_EMAIL="$A_MAIL"
  commit_in "$TMP/envwin" envwin )
check "env-provided identity is accepted" "$?" "0"
check "author from env" "$(author_of "$TMP/envwin")" "$A_MAIL"

echo "== 7. documented escape hatches"
new_repo "$TMP/escape"
git -C "$TMP/escape" config user.email "$B_MAIL"
git -C "$TMP/escape" config user.name "$B_NAME"
( export PAPERCLIP_AGENT_ID=$A_ID AGENT_GIT_IDENTITY_ASSERT=off; commit_in "$TMP/escape" off )
check "AGENT_GIT_IDENTITY_ASSERT=off allows a foreign author" "$?" "0"
check "author kept as given" "$(author_of "$TMP/escape")" "$B_MAIL"
new_repo "$TMP/noverify"
git -C "$TMP/noverify" config user.email "$B_MAIL"
git -C "$TMP/noverify" config user.name "$B_NAME"
printf 'x\n' > "$TMP/noverify/x.txt"; git -C "$TMP/noverify" add x.txt
( export PAPERCLIP_AGENT_ID=$A_ID; git -C "$TMP/noverify" commit -q --no-verify -m "chore: x" )
check "--no-verify bypasses the hook" "$?" "0"

echo "== 8. a sequencer in progress leaves a foreign author alone"
new_repo "$TMP/seq"
git -C "$TMP/seq" config user.email "$B_MAIL"
git -C "$TMP/seq" config user.name "$B_NAME"
: > "$TMP/seq/.git/CHERRY_PICK_HEAD"
( export PAPERCLIP_AGENT_ID=$A_ID; commit_in "$TMP/seq" seq )
check "cherry-pick in progress => allowed" "$?" "0"
rm -f "$TMP/seq/.git/CHERRY_PICK_HEAD"

echo "== 9. trailer stamping is idempotent and merge-safe"
new_repo "$TMP/trailer"
git -C "$TMP/trailer" config user.name "$A_NAME"
git -C "$TMP/trailer" config user.email "$A_MAIL"
printf 'y\n' > "$TMP/trailer/y.txt"; git -C "$TMP/trailer" add y.txt
( export PAPERCLIP_AGENT_ID=$A_ID
  git -C "$TMP/trailer" commit -q -m "chore: y

Co-authored-by: $A_NAME <$A_MAIL>" )
n=$(git -C "$TMP/trailer" log -1 --pretty=%B | grep -ci "co-authored-by: $A_NAME")
check "an existing trailer is not duplicated" "$n" "1"

echo "== 10. repo-provided hooks still never run"
new_repo "$TMP/hostile"
git -C "$TMP/hostile" config user.name "$A_NAME"
git -C "$TMP/hostile" config user.email "$A_MAIL"
mkdir -p "$TMP/hostile/.git/hooks"
printf '#!/bin/sh\ntouch "%s/PWNED"\n' "$TMP" > "$TMP/hostile/.git/hooks/pre-commit"
chmod +x "$TMP/hostile/.git/hooks/pre-commit"
( export PAPERCLIP_AGENT_ID=$A_ID; commit_in "$TMP/hostile" hostile )
check "commit succeeds" "$?" "0"
if [ -e "$TMP/PWNED" ]; then bad "repo-provided .git/hooks/pre-commit must NOT run"; else ok "repo-provided .git/hooks/pre-commit never ran"; fi

echo "== 11. \`export\` emits eval-able shell"
out=$(PAPERCLIP_AGENT_ID=$A_ID node "$IDENTITY" export)
got=$(eval "$out"; printf '%s|%s|%s' "$GIT_AUTHOR_NAME" "$GIT_AUTHOR_EMAIL" "$GIT_COMMITTER_EMAIL")
check "export sets author + committer" "$got" "$A_NAME|$A_MAIL|$A_MAIL"
PAPERCLIP_AGENT_ID=cccccccc-0000-0000-0000-00000000000c node "$IDENTITY" export >/dev/null 2>&1
check "export for an unmapped agent exits 3" "$?" "3"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
