#!/usr/bin/env bash
# Apply this repo's Paperclip fork patches to a /opt/paperclip-style build
# context, before `docker compose build paperclip-server`.
#
# Why patches at all: paperclip-server builds from a clone of
# EngineeringMoonBear/Paperclip-AgenticOS, a repo under a different owner that
# our GitHub App is not installed on — so agent automation cannot PR it. See
# infra/paperclip-patches/README.md for the convention and the exit plan.
#
# Contract:
#   apply-paperclip-patches.sh <repo-dir> <patch-dir>
#
#   - ALL-OR-NOTHING: every patch is `git apply --check`ed before any is applied,
#     so a stale patch (e.g. after a pin bump) fails the deploy instead of
#     producing a half-patched image.
#   - IDEMPOTENT: a patch that is already applied is detected with a reverse
#     --check and skipped, so re-running against an already patched tree is a
#     no-op rather than an error.
#   - QUIET SUCCESS, LOUD FAILURE: a missing or empty patch dir is a legitimate
#     "nothing to patch" (patches are deleted once upstreamed); anything that
#     cannot be classified exits non-zero with the offending patch named.
set -euo pipefail

REPO_DIR="${1:?usage: apply-paperclip-patches.sh <repo-dir> <patch-dir>}"
PATCH_DIR="${2:?usage: apply-paperclip-patches.sh <repo-dir> <patch-dir>}"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "ERROR: $REPO_DIR is not a git repository (expected the Paperclip fork clone)" >&2
  exit 1
fi

if [ ! -d "$PATCH_DIR" ]; then
  echo "no patch directory at $PATCH_DIR — nothing to apply"
  exit 0
fi

# Sorted order, so the NNNN- prefixes sequence deterministically. Use a glob
# rather than `find`/`ls` parsing so an empty dir is unambiguous.
shopt -s nullglob
PATCHES=("$PATCH_DIR"/*.patch)
shopt -u nullglob

if [ ${#PATCHES[@]} -eq 0 ]; then
  echo "no *.patch files in $PATCH_DIR — nothing to apply"
  exit 0
fi

# Reset to a pristine checkout of the pinned ref before classifying anything.
#
# Half-measures do not work here. A patch that adds a NEW file leaves that file
# untracked, and `git checkout --force` restores tracked files without removing
# untracked ones — so on a second deploy the tracked hunks are reverted while the
# new file is still there, a state that is neither appliable (hunk context gone)
# nor reversible (new file present but unmodified). `clean -fd` alone has the
# mirror problem: it removes the new file and leaves the tracked hunks applied.
# Only reset + clean together give a tree the --check classification below can
# reason about, and it makes this script idempotent by construction.
#
# This is a build-context clone of a pinned upstream ref with no local commits,
# so discarding local state is the correct behaviour — but say so out loud,
# because it also discards any hand-edit someone made on the box.
echo "resetting $REPO_DIR to a pristine checkout of $(git -C "$REPO_DIR" rev-parse --short HEAD) before patching"
git -C "$REPO_DIR" reset --hard --quiet HEAD
# No -x: nothing ignored here is ours to delete.
git -C "$REPO_DIR" clean -fd

PENDING=()
for patch in "${PATCHES[@]}"; do
  name="$(basename "$patch")"
  if git -C "$REPO_DIR" apply --check "$patch" 2>/dev/null; then
    PENDING+=("$patch")
    echo "  will apply   $name"
  elif git -C "$REPO_DIR" apply --reverse --check "$patch" 2>/dev/null; then
    # The tree was just reset to the pinned ref, so "already applied" means the
    # PINNED REF now contains this fix — the patch has been upstreamed and is
    # dead weight. Not an error (the deploy must not break on good news), but it
    # should be deleted; the README table is the place that tracks that.
    echo "  already in the pinned ref, skipping (upstreamed — delete it)   $name"
  else
    echo "ERROR: $name does not apply to $REPO_DIR (ref $(git -C "$REPO_DIR" rev-parse --short HEAD)) and is not already applied." >&2
    echo "       The pinned Paperclip ref has probably moved past this patch." >&2
    echo "       Either the fix is upstream now (delete the patch) or the patch needs a refresh." >&2
    echo "       Refusing to build a partially patched image." >&2
    git -C "$REPO_DIR" apply --check "$patch" || true
    exit 1
  fi
done

if [ ${#PENDING[@]} -eq 0 ]; then
  echo "all ${#PATCHES[@]} patch(es) are already in the pinned ref — nothing to apply"
  exit 0
fi

for patch in "${PENDING[@]}"; do
  echo "applying $(basename "$patch")"
  git -C "$REPO_DIR" apply "$patch"
done

echo "applied ${#PENDING[@]} of ${#PATCHES[@]} patch(es); changed files:"
git -C "$REPO_DIR" status --porcelain
