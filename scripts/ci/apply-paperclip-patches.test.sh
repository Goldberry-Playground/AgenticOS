#!/usr/bin/env bash
# Tests for infra/scripts/apply-paperclip-patches.sh (GOL-3005).
#
# The script runs on the Droplet in the deploy path, immediately before
# `docker compose build paperclip-server`, so its failure modes are the
# interesting part: a stale patch must FAIL the deploy (not build a half-patched
# image), and a re-run must be a no-op (the deploy is run repeatedly and
# cloud-init runs it too). Both are exercised here against real git repos and
# real patches — no git stubbing, because `git apply`'s own classification of
# "applies" vs "already applied" is exactly what is under test.
#
# Also asserts the REAL patches in infra/paperclip-patches/ are well-formed and
# target a path the fork actually has, which is the cheap half of catching a
# patch that rotted against a pin bump. (The other half needs the fork source,
# which CI does not have — the deploy's own --check is the backstop.)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${REPO_ROOT}/infra/scripts/apply-paperclip-patches.sh"
PATCH_DIR="${REPO_ROOT}/infra/paperclip-patches"
FAILED=0

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; FAILED=1; }

# A throwaway "fork" repo with one tracked file.
new_fork() {
  local root; root="$(mktemp -d)"
  mkdir -p "${root}/packages/adapter-utils/src"
  printf 'export const existing = 1;\n' > "${root}/packages/adapter-utils/src/thing.ts"
  git -C "$root" init -q
  git -C "$root" -c user.email=ci@example.com -c user.name=ci add -A
  git -C "$root" -c user.email=ci@example.com -c user.name=ci commit -qm baseline
  echo "$root"
}

# A patch that edits the tracked file AND adds a new one — the shape of the real
# GOL-3005 patch, and the shape that makes re-runs tricky.
write_good_patch() {
  cat > "$1" <<'PATCH'
Header text before the first diff is ignored by git apply.

diff --git a/packages/adapter-utils/src/thing.ts b/packages/adapter-utils/src/thing.ts
--- a/packages/adapter-utils/src/thing.ts
+++ b/packages/adapter-utils/src/thing.ts
@@ -1 +1,2 @@
 export const existing = 1;
+export const added = 2;
diff --git a/packages/adapter-utils/src/brand-new.ts b/packages/adapter-utils/src/brand-new.ts
new file mode 100644
--- /dev/null
+++ b/packages/adapter-utils/src/brand-new.ts
@@ -0,0 +1 @@
+export const brandNew = 3;
PATCH
}

write_stale_patch() {
  cat > "$1" <<'PATCH'
diff --git a/packages/adapter-utils/src/thing.ts b/packages/adapter-utils/src/thing.ts
--- a/packages/adapter-utils/src/thing.ts
+++ b/packages/adapter-utils/src/thing.ts
@@ -1 +1,2 @@
-export const gone_upstream = 99;
+export const replacement = 100;
PATCH
}

echo "apply-paperclip-patches.sh"

# --- 1. happy path -----------------------------------------------------------
fork="$(new_fork)"; patches="$(mktemp -d)"
write_good_patch "${patches}/0001-good.patch"
if out="$(bash "$SCRIPT" "$fork" "$patches" 2>&1)"; then
  pass "applies a good patch (exit 0)"
else
  fail "good patch rejected: $out"
fi
if grep -q 'export const added = 2;' "${fork}/packages/adapter-utils/src/thing.ts"; then
  pass "edit hunk landed"
else
  fail "edit hunk did not land"
fi
if [ -f "${fork}/packages/adapter-utils/src/brand-new.ts" ]; then
  pass "new file landed"
else
  fail "new file did not land"
fi

# --- 2. idempotent re-run (deploy runs repeatedly) ---------------------------
if out="$(bash "$SCRIPT" "$fork" "$patches" 2>&1)"; then
  pass "re-run against an already patched tree exits 0"
else
  fail "re-run failed: $out"
fi
# Must not double-apply.
if [ "$(grep -c 'export const added = 2;' "${fork}/packages/adapter-utils/src/thing.ts")" = "1" ]; then
  pass "re-run did not duplicate the hunk"
else
  fail "re-run duplicated the hunk"
fi
if [ -f "${fork}/packages/adapter-utils/src/brand-new.ts" ]; then
  pass "re-run left the new file in place"
else
  fail "re-run lost the new file"
fi

# --- 3. the half-reverted tree the real deploy produces ----------------------
# `git checkout --force --detach <ref>` in deploy-paperclip-server.yml reverts
# the TRACKED hunks but leaves the previous deploy's untracked new file behind.
# That tree is neither appliable (hunk context is back to baseline... but the new
# file already exists) nor reversible (tracked hunks are gone), so a naive
# check/skip would fail the deploy. Reconstruct it exactly.
git -C "$fork" checkout --force -q -- packages/adapter-utils/src/thing.ts
if [ -f "${fork}/packages/adapter-utils/src/brand-new.ts" ] \
  && ! grep -q 'export const added = 2;' "${fork}/packages/adapter-utils/src/thing.ts"; then
  pass "precondition: half-reverted tree reconstructed (new file kept, hunk reverted)"
else
  fail "precondition broken: could not reconstruct the half-reverted tree"
fi
if out="$(bash "$SCRIPT" "$fork" "$patches" 2>&1)"; then
  pass "recovers from the half-reverted tree the deploy leaves behind"
else
  fail "half-reverted tree broke the script (reset+clean guard not working): $out"
fi
if grep -q 'export const added = 2;' "${fork}/packages/adapter-utils/src/thing.ts" \
  && [ -f "${fork}/packages/adapter-utils/src/brand-new.ts" ]; then
  pass "both hunk and new file present after recovery"
else
  fail "recovery did not restore both hunk and new file"
fi

# --- 3b. a patch already in the pinned ref is reported, not failed -----------
# Once the fix is upstreamed and the pin bumped, the patch is dead weight. The
# deploy must not break on that; it must say the patch can be deleted.
forkup="$(new_fork)"; patchesup="$(mktemp -d)"
write_good_patch "${patchesup}/0001-good.patch"
bash "$SCRIPT" "$forkup" "$patchesup" >/dev/null 2>&1
git -C "$forkup" -c user.email=ci@example.com -c user.name=ci add -A
git -C "$forkup" -c user.email=ci@example.com -c user.name=ci commit -qm "upstreamed the fix"
if out="$(bash "$SCRIPT" "$forkup" "$patchesup" 2>&1)"; then
  pass "a patch already in the pinned ref exits 0"
else
  fail "a patch already in the pinned ref failed the deploy: $out"
fi
if printf '%s' "$out" | grep -q 'already in the pinned ref'; then
  pass "reports the patch as upstreamed and deletable"
else
  fail "did not report the patch as upstreamed: $out"
fi

# --- 4. a stale patch must FAIL, and must not leave a half-patched tree ------
fork2="$(new_fork)"; patches2="$(mktemp -d)"
write_good_patch "${patches2}/0001-good.patch"
write_stale_patch "${patches2}/0002-stale.patch"
if out="$(bash "$SCRIPT" "$fork2" "$patches2" 2>&1)"; then
  fail "stale patch did NOT fail the run"
else
  pass "stale patch fails the run (exit non-zero)"
fi
if printf '%s' "$out" | grep -q '0002-stale.patch'; then
  pass "failure names the offending patch"
else
  fail "failure did not name the offending patch: $out"
fi
# All-or-nothing: 0001 sorts BEFORE the stale 0002 and applies cleanly, but
# nothing may be written once any patch is known-bad.
if [ -z "$(git -C "$fork2" status --porcelain)" ]; then
  pass "all-or-nothing: no patch applied when a later one is stale"
else
  fail "left a partially patched tree: $(git -C "$fork2" status --porcelain)"
fi

# --- 5. empty / missing patch dir is a legitimate no-op ---------------------
# Patches are deleted as they are upstreamed, so an empty dir must not break
# the deploy.
fork3="$(new_fork)"; empty="$(mktemp -d)"
if bash "$SCRIPT" "$fork3" "$empty" >/dev/null 2>&1; then
  pass "empty patch dir exits 0"
else
  fail "empty patch dir failed"
fi
if bash "$SCRIPT" "$fork3" "${empty}/does-not-exist" >/dev/null 2>&1; then
  pass "missing patch dir exits 0"
else
  fail "missing patch dir failed"
fi

# --- 6. a non-repo target fails loudly --------------------------------------
notrepo="$(mktemp -d)"
if bash "$SCRIPT" "$notrepo" "$patches" >/dev/null 2>&1; then
  fail "a non-git target was accepted"
else
  pass "a non-git target is rejected"
fi

# --- 7. the REAL patches are well-formed ------------------------------------
shopt -s nullglob
real=("${PATCH_DIR}"/*.patch)
shopt -u nullglob
if [ ${#real[@]} -eq 0 ]; then
  # Legitimate once everything is upstreamed; say so rather than fail.
  pass "no patches in infra/paperclip-patches (all upstreamed?)"
else
  for p in "${real[@]}"; do
    name="$(basename "$p")"
    case "$name" in
      [0-9][0-9][0-9][0-9]-*.patch) pass "$name uses the NNNN- prefix" ;;
      *) fail "$name does not use the NNNN-<slug>.patch convention" ;;
    esac
    if grep -q '^diff --git a/' "$p"; then
      pass "$name is an a/-prefixed git diff (git apply -p1 default)"
    else
      fail "$name has no 'diff --git a/' header — git apply -p1 will not match"
    fi
    if grep -qE '^(GOL-[0-9]+|.*GOL-[0-9]+)' "$p"; then
      pass "$name references an issue id"
    else
      fail "$name has no GOL- issue reference in its header"
    fi
    # `git apply --check` needs the fork tree, which CI lacks, but
    # --numstat parses the patch and proves it is structurally valid.
    if git apply --numstat --check=false "$p" >/dev/null 2>&1 || git apply --numstat "$p" >/dev/null 2>&1; then
      pass "$name parses as a valid patch"
    else
      fail "$name does not parse as a valid patch"
    fi
  done
  if grep -q "$(basename "${real[0]}")" "${PATCH_DIR}/README.md"; then
    pass "README.md lists $(basename "${real[0]}")"
  else
    fail "README.md does not list $(basename "${real[0]}") — keep the table current"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  echo "apply-paperclip-patches.sh: FAILURES" >&2
  exit 1
fi
echo "apply-paperclip-patches.sh: all checks passed"
