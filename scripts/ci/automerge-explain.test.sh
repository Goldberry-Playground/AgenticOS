#!/usr/bin/env bash
#
# automerge-explain.test.sh — offline harness for automerge-explain.sh
# (GOL-2815). A stubbed `gh` serves the comment list from a fixture file and
# appends posted comments to it, so we can prove end-to-end that:
#   1. a decline posts exactly one comment carrying the kind's marker,
#   2. a SECOND run with the same kind posts NOTHING (idempotent — this is the
#      property that keeps high-volume check_run re-fires from spamming a PR),
#   3. a DIFFERENT kind still posts (markers are per-reason, not per-PR),
#   4. only github-actions[bot]'s own comments suppress — a human quoting the
#      marker back into the thread cannot silence a real explanation,
#   5. the body carries the reason text, the head SHA, and the "needs a human"
#      instruction,
#   6. an unknown kind, a missing REPO, and a failing `gh pr comment` are all
#      non-fatal (exit 0) — the explainer must never change a merge decision.
# No network, no live repo.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/automerge-explain.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export FAKE_COMMENTS="$WORK/comments.json"
export FAKE_HEAD_SHA="deadbeefcafe1234567890abcdefdeadbeefcafe"
echo '[]' >"$FAKE_COMMENTS"

# --- stubbed gh -------------------------------------------------------------
cat >"$WORK/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  api)
    shift
    jqf=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -q|--jq) jqf="$2"; shift ;;
        --paginate|-*) ;;
        *) ;;
      esac
      shift
    done
    if [ -n "$jqf" ]; then jq -r "$jqf" "$FAKE_COMMENTS"; else cat "$FAKE_COMMENTS"; fi
    ;;
  pr)
    shift
    case "${1:-}" in
      view)   echo "$FAKE_HEAD_SHA" ;;
      comment)
        [ "${FAKE_COMMENT_FAILS:-0}" = 1 ] && { echo "fake gh: post refused" >&2; exit 1; }
        body=""
        while [ $# -gt 0 ]; do
          [ "$1" = "--body" ] && { body="$2"; shift; }
          shift
        done
        jq --arg b "$body" '. + [{user:{login:"github-actions[bot]"},body:$b}]' \
          "$FAKE_COMMENTS" >"$FAKE_COMMENTS.tmp" && mv "$FAKE_COMMENTS.tmp" "$FAKE_COMMENTS"
        echo "https://github.com/o/r/pull/772#issuecomment-1"
        ;;
      *) echo "fake gh: unhandled pr $*" >&2; exit 98 ;;
    esac
    ;;
  *) echo "fake gh: unhandled $*" >&2; exit 99 ;;
esac
GH
chmod +x "$WORK/gh"
export PATH="$WORK:$PATH"
export REPO="Goldberry-Playground/AgenticOS"

FAILURES=0
ok()   { echo "  ok   — $1"; }
fail() { echo "  FAIL — $1" >&2; FAILURES=$((FAILURES + 1)); }
check(){ if [ "$1" = 0 ]; then ok "$2"; else fail "$2"; fi; }

count_marker() { grep -cF "$1" <(jq -r '.[].body' "$FAKE_COMMENTS") || true; }
n_comments()   { jq 'length' "$FAKE_COMMENTS"; }

# The real #772 numbers, so this harness is a dry-run of the case that motivated
# the change: 1992 + 10 = 2002 lines against AUTOMERGE_MAX_LINES=800.
REASON_772="2002 changed lines exceeds AUTOMERGE_MAX_LINES=800"

echo "case 1: first decline posts exactly one marked comment"
"$SCRIPT" 772 gate "$REASON_772" >/dev/null
[ "$(n_comments)" = 1 ] && check 0 "one comment posted" || check 1 "one comment posted (got $(n_comments))"
[ "$(count_marker '<!-- automerge-declined:gate -->')" = 1 ] \
  && check 0 "carries the gate marker" || check 1 "carries the gate marker"

echo "case 2: body states the reason, the SHA, and that a human must merge"
BODY=$(jq -r '.[0].body' "$FAKE_COMMENTS")
grep -qF "$REASON_772" <<<"$BODY"        && check 0 "body quotes the gate reason" || check 1 "body quotes the gate reason"
grep -qF "$FAKE_HEAD_SHA" <<<"$BODY"     && check 0 "body pins the head SHA"      || check 1 "body pins the head SHA"
grep -qiF "needs a human" <<<"$BODY"     && check 0 "body says it needs a human"  || check 1 "body says it needs a human"
grep -qiF "CODEOWNER" <<<"$BODY"         && check 0 "body names CODEOWNER as the unblock" || check 1 "body names CODEOWNER as the unblock"
grep -qiF "merge it by hand" <<<"$BODY"  && check 0 "body says merge by hand"     || check 1 "body says merge by hand"

echo "case 3: re-firing the SAME kind posts nothing (idempotent)"
"$SCRIPT" 772 gate "$REASON_772" >/dev/null
"$SCRIPT" 772 gate "a differently worded reason for the same gate" >/dev/null
[ "$(n_comments)" = 1 ] && check 0 "still exactly one comment after 3 runs" \
                        || check 1 "still exactly one comment after 3 runs (got $(n_comments))"

echo "case 4: a DIFFERENT kind still gets its own comment"
"$SCRIPT" 772 carveout "protected path(s) touched: .github/workflows/ci.yml" >/dev/null
[ "$(n_comments)" = 2 ] && check 0 "carve-out decline posted" || check 1 "carve-out decline posted (got $(n_comments))"
CARVE=$(jq -r '.[1].body' "$FAKE_COMMENTS")
grep -qF "not a code owner" <<<"$CARVE" \
  && check 0 "carve-out body says a bot approval cannot satisfy code-owner review" \
  || check 1 "carve-out body says a bot approval cannot satisfy code-owner review"
"$SCRIPT" 772 carveout "protected path(s) touched: .github/workflows/ci.yml" >/dev/null
[ "$(n_comments)" = 2 ] && check 0 "carve-out kind is idempotent too" || check 1 "carve-out kind is idempotent too"

echo "case 5: a HUMAN comment quoting the marker does not suppress the bot"
echo '[]' >"$FAKE_COMMENTS"
jq '. + [{user:{login:"EngineeringMoonBear"},body:"why is this stuck? <!-- automerge-declined:gate -->"}]' \
  "$FAKE_COMMENTS" >"$FAKE_COMMENTS.tmp" && mv "$FAKE_COMMENTS.tmp" "$FAKE_COMMENTS"
"$SCRIPT" 772 gate "$REASON_772" >/dev/null
[ "$(n_comments)" = 2 ] && check 0 "bot still explained despite the human quote" \
                        || check 1 "bot still explained despite the human quote (got $(n_comments))"

echo "case 6: failure modes are non-fatal and post nothing"
echo '[]' >"$FAKE_COMMENTS"
"$SCRIPT" 772 not-a-kind "x" >/dev/null 2>&1
check $? "unknown kind exits 0"
[ "$(n_comments)" = 0 ] && check 0 "unknown kind posted nothing" || check 1 "unknown kind posted nothing"

( unset REPO; "$SCRIPT" 772 gate "x" >/dev/null 2>&1 )
check $? "missing REPO exits 0"
[ "$(n_comments)" = 0 ] && check 0 "missing REPO posted nothing" || check 1 "missing REPO posted nothing"

"$SCRIPT" >/dev/null 2>&1
check $? "missing arguments exits 0"

FAKE_COMMENT_FAILS=1 "$SCRIPT" 772 gate "$REASON_772" >/dev/null 2>&1
check $? "a failing gh pr comment still exits 0 (never changes the merge decision)"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "automerge-explain.test.sh: all assertions passed"
else
  echo "automerge-explain.test.sh: $FAILURES assertion(s) FAILED" >&2
  exit 1
fi
