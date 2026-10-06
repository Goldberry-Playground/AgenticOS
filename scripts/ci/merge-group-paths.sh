#!/usr/bin/env bash
# merge-group-paths.sh — evaluate a workflow's own `paths:` filter against a
# merge_group entry's diff (GOL-3080).
#
# WHY THIS EXISTS
#   GitHub does NOT support `paths:`/`paths-ignore:` on the `merge_group`
#   trigger. A workflow that carefully scopes its `pull_request` leg
#   (`paths: ['apps/dashboard/**', ...]`) therefore re-runs UNCONDITIONALLY on
#   every queue entry — including entries that touch none of those paths. That
#   is the only strictly-wasted spend in the merge-queue fan-out: measured on
#   AgenticOS, E2E (~91s) + CodeQL (~75s) per entry, ~39% of all merge_group
#   runner-time, burned on diffs they cannot possibly be affected by.
#
#   Demoting those workflows off `merge_group` would fix the cost but DROP a
#   gate: `merge_group` is the only trigger that tests the prospective merge
#   commit, so it is the only place a semantic conflict between a PR and
#   whatever merged ahead of it is caught. This script is the third option —
#   keep the trigger, make it CONDITIONAL — so no coverage is lost: when the
#   merge commit touches the workflow's paths the gate runs exactly as before.
#
# FAIL OPEN, ALWAYS
#   Every ambiguity (missing shas, API failure, truncated compare, non-
#   merge_group event, no patterns given) prints `true`. A wrong `false` would
#   silently skip a gate; a wrong `true` only costs one run. Cost optimisation
#   must never be the reason a check did not run.
#
# PATTERN SYNTAX
#   GitHub filter-pattern subset, translated to ERE:
#     `**/` → zero or more directories        `**` → any characters, incl. `/`
#     `*`   → any characters except `/`        `?`  → one character except `/`
#   Everything else is literal. `**/*.ts` therefore matches a root-level `a.ts`
#   as well as `pkg/src/a.ts`, and a pattern ending in `/**` also matches the
#   directory entry itself.
#
# USAGE
#   merge-group-paths.sh --base <sha> --head <sha> [--repo owner/name] \
#                        --pattern 'apps/dashboard/**' --pattern 'pnpm-lock.yaml'
#   Prints `true` or `false` on stdout. Diagnostics go to stderr.
#   Honours $GH_TOKEN/$GITHUB_TOKEN for the compare API; set $MG_PATHS_FILES to
#   a newline-separated file list to bypass the API (used by the test harness).
set -uo pipefail

BASE=""; HEAD=""; REPO="${GITHUB_REPOSITORY:-}"; PATTERNS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --base)    BASE="${2:-}"; shift 2 ;;
    --head)    HEAD="${2:-}"; shift 2 ;;
    --repo)    REPO="${2:-}"; shift 2 ;;
    --pattern) PATTERNS+=("${2:-}"); shift 2 ;;
    -h|--help) awk 'NR>1 && /^#/ {print; next} NR>1 {exit}' "$0"; exit 0 ;;
    *) echo "merge-group-paths: unknown argument '$1'" >&2; echo true; exit 0 ;;
  esac
done

open() { echo "merge-group-paths: FAIL-OPEN — $1" >&2; echo true; exit 0; }

[ ${#PATTERNS[@]} -gt 0 ] || open "no --pattern given"

# Translate a GitHub filter pattern into an anchored ERE.
pattern_to_ere() {
  local p="$1" out="" i ch
  for (( i=0; i<${#p}; i++ )); do
    ch="${p:i:1}"
    case "$ch" in
      '*')
        if [ "${p:i+1:1}" = '*' ]; then
          # `**/` means ZERO OR MORE directories, so `**/*.ts` has to match a
          # root-level `a.ts` as well as `pkg/src/a.ts` — `.*/` would not.
          if [ "${p:i+2:1}" = '/' ]; then out+='(.*/)?'; (( i += 2 ));
          else out+='.*'; (( i++ )); fi
        else out+='[^/]*'; fi ;;
      '?') out+='[^/]' ;;
      '.'|'+'|'('|')'|'['|']'|'{'|'}'|'^'|'$'|'|'|'\\') out+="\\$ch" ;;
      *) out+="$ch" ;;
    esac
  done
  printf '^%s$' "$out"
}

# Changed-file list: injected (tests) or from the compare API.
if [ -n "${MG_PATHS_FILES:-}" ]; then
  FILES="$MG_PATHS_FILES"
else
  [ -n "$BASE" ] && [ -n "$HEAD" ] || open "base/head sha missing (not a merge_group event?)"
  [ -n "$REPO" ] || open "repo unknown (pass --repo or set GITHUB_REPOSITORY)"
  TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  [ -n "$TOKEN" ] || open "no GH_TOKEN/GITHUB_TOKEN for the compare API"

  BODY="$(curl -sS --fail-with-body -H "Authorization: Bearer $TOKEN" \
            -H 'Accept: application/vnd.github+json' \
            "https://api.github.com/repos/$REPO/compare/$BASE...$HEAD?per_page=300" 2>&1)" \
    || open "compare API failed: ${BODY:0:200}"

  # `files` is capped at 300 entries; past that the list is incomplete and a
  # `false` could be a lie, so treat truncation as ambiguity.
  read -r TOTAL NFILES <<<"$(printf '%s' "$BODY" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print("ERR 0"); raise SystemExit
print(d.get("total_commits","ERR"), len(d.get("files") or []))' 2>/dev/null)"
  [ "${TOTAL:-ERR}" != "ERR" ] || open "compare API returned unparseable JSON"
  [ "${NFILES:-0}" -lt 300 ] || open "compare file list truncated at 300 files"

  FILES="$(printf '%s' "$BODY" | python3 -c '
import json,sys
for f in json.load(sys.stdin).get("files") or []:
    print(f["filename"])
    # A rename changes the old path too; either side can trip a filter.
    if f.get("previous_filename"): print(f["previous_filename"])')"
fi

# An empty diff genuinely matches nothing — that is a real `false`, not an
# ambiguity (an empty queue entry cannot affect any workflow's paths).
if [ -z "$FILES" ]; then
  echo "merge-group-paths: diff is empty — no pattern can match" >&2
  echo false; exit 0
fi

for p in "${PATTERNS[@]}"; do
  [ -n "$p" ] || continue
  ere="$(pattern_to_ere "$p")"
  if printf '%s\n' "$FILES" | grep -Eq -- "$ere"; then
    echo "merge-group-paths: matched '$p'" >&2
    echo true; exit 0
  fi
  # `dir/**` should also match the bare directory entry `dir`.
  case "$p" in
    */'**')
      bare="$(pattern_to_ere "${p%/\*\*}")"
      if printf '%s\n' "$FILES" | grep -Eq -- "$bare"; then
        echo "merge-group-paths: matched '$p' (directory itself)" >&2
        echo true; exit 0
      fi ;;
  esac
done

echo "merge-group-paths: no pattern matched $(printf '%s\n' "$FILES" | wc -l) changed file(s)" >&2
echo false
