#!/usr/bin/env bash
# Reap agent git worktrees whose work is FINISHED (GOL-3255).
#
# Why: reap-stale-worktrees.sh only looks at `.wt-*` worktrees inside the
# project checkouts. Agents have since moved to ad-hoc `gol<N>-wt` worktrees in
# /paperclip/work and in <project>/_default/, which nothing reclaimed. Each one
# carries its own node_modules (~1-1.6 GB). On 2026-10-08 they were 14 GB of
# /paperclip/work plus most of the Grove project's 4.8 GB, and a core-server
# deploy died with `no space left on device` at 97% root FS.
#
# A worktree is removed only when ALL of these hold:
#   1. nothing in it (outside node_modules/.next/.git) changed for MIN_AGE_HOURS
#   2. no live process has its cwd, or an open fd, inside it
#   3. the worktree is not `git worktree lock`ed
#   4. its work is provably elsewhere, by ONE of:
#      a. FINISHED -- a closed or merged GitHub PR has exactly this HEAD as its
#         head commit. Leftover edits are allowed: the tracked diff and the
#         untracked files are first saved to ARCHIVE_DIR as
#         <name>-<date>.tar.gz (patch + files), then the worktree goes. If the
#         untracked files exceed ARCHIVE_MAX_MB it is skipped instead.
#      b. LOSSLESS -- HEAD is contained in a remote-tracking branch AND there
#         are no modified tracked files and no untracked files. Removing it
#         drops only git-ignored output (node_modules, builds), which
#         `pnpm install` recreates.
#   Anything with edits and no finished PR is real work in progress: SKIP.
# Everything else is SKIPped with the reason.
#
# Removal goes through `git worktree remove`, then `git worktree prune` on each
# parent, never a bare `rm -rf`, so the parent repo's admin entries stay right.
#
# Must run INSIDE paperclip-server as the `node` user (see the header of
# infra/scripts/worktree-reaper.sh for the reasons: /proc namespace + git
# dubious-ownership). PR state comes from the GitHub App token broker
# (/paperclip/agent-git/github-app-token.mjs). If no token can be minted, rule
# 4a is unavailable and only rule 4b can reap -- fail safe, never fail open.
#
# Idempotent. Dry-run by default; pass --apply to delete.
#
# Knobs: --root=<dir> (repeatable; default /paperclip/work and
# /paperclip/instances/default/projects), --min-age-hours=N (48),
# PR_LOOKUP_CMD (tests: a command run as `$PR_LOOKUP_CMD <owner/repo> <sha>`
# that prints the JSON of GET /repos/<o>/<r>/commits/<sha>/pulls).
set -euo pipefail

ROOTS=()
MIN_AGE_HOURS="${MIN_AGE_HOURS:-48}"
APPLY=0
TOKEN_HELPER="${TOKEN_HELPER:-/paperclip/agent-git/github-app-token.mjs}"
ARCHIVE_DIR="${ARCHIVE_DIR:-/paperclip/work/archives/reaped-worktrees}"
ARCHIVE_MAX_MB="${ARCHIVE_MAX_MB:-50}"
PR_LOOKUP_CMD="${PR_LOOKUP_CMD:-}"
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --root=*) ROOTS+=("${arg#*=}") ;;
    --min-age-hours=*) MIN_AGE_HOURS="${arg#*=}" ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done
[ "${#ROOTS[@]}" -gt 0 ] || ROOTS=(/paperclip/work /paperclip/instances/default/projects)

log() { printf '%s\n' "$*"; }
# Never let our own inspection refresh the index: that would reset the
# worktree's idle clock and could race a live agent's git.
export GIT_OPTIONAL_LOCKS=0

live_paths() {
  local p t fd
  for p in /proc/[0-9]*; do
    t=$(readlink "$p/cwd" 2>/dev/null) && [ -n "$t" ] && printf '%s\n' "$t"
    for fd in "$p"/fd/*; do
      t=$(readlink "$fd" 2>/dev/null) && [ -n "$t" ] && printf '%s\n' "$t"
    done 2>/dev/null
  done 2>/dev/null
}
LIVE=$(live_paths | sort -u || true)

# GitHub owner/repo from a remote URL (https or ssh form), or empty.
owner_repo() {
  printf '%s' "$1" | sed -nE 's#^(https://([^@/]+@)?github\.com/|git@github\.com:)([^/]+/[^/]+)$#\3#p' | sed 's/\.git$//'
}

declare -A TOKENS=()
pr_lookup() { # $1 owner/repo, $2 sha -> JSON array on stdout, non-zero on failure
  if [ -n "${PR_LOOKUP_CMD}" ]; then
    ${PR_LOOKUP_CMD} "$1" "$2"
    return
  fi
  local owner="${1%%/*}" tok
  if [ -z "${TOKENS[$owner]+x}" ]; then
    # awk NR==1 $1: line 1 is `ghs_..._<jwt>`; a grep for ^ghs_ truncates it.
    TOKENS[$owner]="$(node "${TOKEN_HELPER}" token "$1" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  fi
  tok="${TOKENS[$owner]}"
  [ -n "$tok" ] || return 1
  curl -fsS -m 20 --noproxy '*' -H "Authorization: token ${tok}" \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$1/commits/$2/pulls"
}

# Collect worktree roots: a directory whose `.git` is a FILE (linked worktree).
# Skip .wt-* (reap-stale-worktrees.sh owns those) and anything nested inside a
# candidate (submodules, a worktree inside a worktree).
candidates() {
  local root
  for root in "${ROOTS[@]}"; do
    [ -d "$root" ] || continue
    find "$root" -maxdepth 5 \( -name node_modules -o -name .next \) -prune \
      -o -name .git -type f -print 2>/dev/null
  done | sed 's#/\.git$##' | sort -u | awk '
    { for (i = 1; i <= n; i++) if (index($0, keep[i] "/") == 1) next; keep[++n] = $0; print }'
}

# Save a worktree's leftover edits: `edits.patch` (tracked diff vs HEAD, binary
# safe, apply with `git apply`) + the untracked files, in one tarball. The file
# is fully written and read back before the caller deletes anything.
archive_edits() { # $1 worktree, $2 archive path, $3 head sha
  local wt="$1" out="$2" stage
  mkdir -p "$(dirname "$out")" || return 1
  stage=$(mktemp -d) || return 1
  {
    printf 'worktree: %s\nhead: %s\nbranch: %s\nremote: %s\n' "$wt" "$3" \
      "$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)" \
      "$(git -C "$wt" remote get-url origin 2>/dev/null)" >"$stage/README" &&
    git -C "$wt" diff HEAD --binary >"$stage/edits.patch" &&
    mkdir -p "$stage/untracked" &&
    (cd "$wt" && git ls-files --others --exclude-standard -z | tar --null -T - -cf -) \
      | tar -xf - -C "$stage/untracked" &&
    tar -czf "$out.tmp" -C "$stage" . && tar -tzf "$out.tmp" >/dev/null &&
    mv -f "$out.tmp" "$out"
  }
  local rc=$?
  rm -rf "$stage" "$out.tmp"
  return $rc
}

skipped=0; reaped=0; freed=0
declare -A PARENTS=()
skip() { log "SKIP  $1 (${2}MB): $3"; skipped=$((skipped+1)); }

while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  name="${wt#/}"
  case "$(basename "$wt")" in .wt-*) continue ;; esac
  size_mb=$(du -sm "$wt" 2>/dev/null | cut -f1 || echo 0)

  # 1. idle: any file (outside heavy generated dirs) newer than the window?
  if [ -n "$(find "$wt" \( -name node_modules -o -name .next -o -name .git \) -prune \
              -o -newermt "${MIN_AGE_HOURS} hours ago" -print -quit 2>/dev/null)" ]; then
    skip "$name" "$size_mb" "modified < ${MIN_AGE_HOURS}h ago"; continue
  fi

  # 2. live process inside (exact root, or a path under it)
  if printf '%s\n' "$LIVE" | grep -qF -- "$wt/" || printf '%s\n' "$LIVE" | grep -qxF -- "$wt"; then
    skip "$name" "$size_mb" "live process holds a path inside it"; continue
  fi

  if ! git -C "$wt" rev-parse --git-dir >/dev/null 2>&1; then
    skip "$name" "$size_mb" "not a usable git worktree (orphaned admin dir?)"; continue
  fi
  common=$(git -C "$wt" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  parent=$(dirname "${common:-/nonexistent/x}")
  if [ -z "$common" ] || ! git -C "$parent" rev-parse --git-dir >/dev/null 2>&1; then
    skip "$name" "$size_mb" "cannot resolve parent repo"; continue
  fi
  if git -C "$parent" worktree list --porcelain 2>/dev/null \
       | awk -v w="$wt" '$1=="worktree"{cur=substr($0,10)} $1=="locked"&&cur==w{f=1} END{exit !f}'; then
    skip "$name" "$size_mb" "worktree is locked"; continue
  fi

  tracked=$(git -C "$wt" status --porcelain --untracked-files=no 2>/dev/null | wc -l)
  untracked=$(git -C "$wt" status --porcelain --untracked-files=normal 2>/dev/null | grep -c '^??' || true)
  head=$(git -C "$wt" rev-parse HEAD 2>/dev/null || true)
  branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)

  # 4a. finished: a closed/merged PR whose head is exactly this HEAD
  why=""
  repo=$(owner_repo "$(git -C "$wt" remote get-url origin 2>/dev/null || true)")
  if [ -n "$repo" ] && [ -n "$head" ]; then
    if prs=$(pr_lookup "$repo" "$head" 2>/dev/null); then
      hit=$(printf '%s' "$prs" | jq -r --arg h "$head" \
        '[.[] | select(.head.sha == $h and .state == "closed")][0]
         | if . == null then empty else "#\(.number) \(if .merged_at then "merged" else "closed" end)" end' 2>/dev/null || true)
      [ -n "$hit" ] && why="PR ${repo}${hit} is finished"
    fi
  fi
  # 4b. lossless: HEAD is on a remote-tracking branch and the tree is clean
  if [ -z "$why" ]; then
    if [ -z "$head" ] || [ -z "$(git -C "$wt" branch -r --contains "$head" 2>/dev/null | head -1)" ]; then
      skip "$name" "$size_mb" "no finished PR for HEAD and HEAD not on any remote branch"; continue
    fi
    if [ "$tracked" -ne 0 ] || [ "$untracked" -ne 0 ]; then
      skip "$name" "$size_mb" "no finished PR; $tracked modified + $untracked untracked file(s)"; continue
    fi
    why="HEAD is on a remote branch, tree clean"
  fi

  # A finished PR with leftover edits: keep a copy of the edits before removal.
  extra=""; archive=""
  if [ "$tracked" -ne 0 ] || [ "$untracked" -ne 0 ]; then
    ut_kb=$(git -C "$wt" ls-files --others --exclude-standard -z 2>/dev/null \
      | (cd "$wt" && xargs -0r du -ck 2>/dev/null) | awk '$2!="total"{s+=$1} END{print s+0}')
    if [ "$ut_kb" -gt $((ARCHIVE_MAX_MB * 1024)) ]; then
      skip "$name" "$size_mb" "finished PR but $((ut_kb / 1024))MB of untracked files (> ${ARCHIVE_MAX_MB}MB archive cap)"; continue
    fi
    archive="${ARCHIVE_DIR}/$(basename "$wt")-$(date +%Y%m%d%H%M%S).tar.gz"
    extra=", $tracked modified + $untracked untracked file(s) archived to $archive"
  fi

  if [ "$APPLY" -eq 1 ]; then
    if [ -n "$archive" ] && ! archive_edits "$wt" "$archive" "$head"; then
      skip "$name" "$size_mb" "could not archive leftover edits to $archive"; continue
    fi
    if git -C "$parent" worktree remove --force "$wt" 2>/dev/null; then
      log "REAP  $name (${size_mb}MB): $why [branch $branch$extra]"
    else
      skip "$name" "$size_mb" "git worktree remove failed"; continue
    fi
  else
    log "WOULD REAP  $name (${size_mb}MB): $why [branch $branch$extra]"
  fi
  PARENTS["$parent"]=1
  reaped=$((reaped+1)); freed=$((freed+size_mb))
done < <(candidates)

if [ "$APPLY" -eq 1 ]; then
  for parent in "${!PARENTS[@]}"; do
    git -C "$parent" worktree prune 2>/dev/null || true
  done
fi

log "---"
log "reaped=$reaped skipped=$skipped freed=${freed}MB apply=$APPLY"
