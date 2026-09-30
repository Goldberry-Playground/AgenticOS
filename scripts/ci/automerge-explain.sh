#!/usr/bin/env bash
#
# automerge-explain.sh — make auto-approve.yml's SILENT declines visible on the
# PR itself (GOL-2815).
#
# The problem it solves: when auto-approve.yml declines a PR it writes a line to
# a workflow log nobody reads and exits 0. From the PR the result is
# indistinguishable from a broken gate — 21/21 checks green, agent-review
# success, `mergeStateStatus: BLOCKED`, no explanation. That costs a triage
# round-trip every single time (GOL-2769 / PR #772: "2002 changed lines exceeds
# AUTOMERGE_MAX_LINES=800", visible only in the log).
#
# WHICH declines get a comment: the ones that are not otherwise visible on the
# PR. Gate 1 (automerge-gate.mjs: author / size / sensitive-path / dependabot
# risk) and the protected-paths carve-out are pure workflow-internal policy with
# no PR-side artifact, so they comment. The agent-review gate and the
# all-checks-green gate are NOT wired here on purpose: each is already rendered
# on the PR as a check-run the reader can see, and both are transient (they
# re-fire and can flip to green later), so a comment would be noise that goes
# stale.
#
# Usage:
#   scripts/ci/automerge-explain.sh <pr-number> <kind> <reason>
#     kind: gate | carveout | maintainer-carveout
#   env: REPO=owner/name (required), GH_TOKEN (required for a real post)
#
# Idempotency: every comment carries an HTML marker `<!-- automerge-declined:
# <kind> -->`. The script looks for that marker among github-actions[bot]'s
# existing comments and returns without posting if it is already there, so the
# high-volume check_run re-fires cannot spam the thread.
#
# Never fatal: this is an explanation, not a gate. Any failure (missing token,
# API hiccup) is reported on stderr and the script still exits 0 so it can never
# change auto-approve.yml's merge decision.
set -uo pipefail

PR="${1:-}"
KIND="${2:-}"
REASON="${3:-}"

if [ -z "$PR" ] || [ -z "$KIND" ] || [ -z "$REASON" ]; then
  echo "automerge-explain: usage: $0 <pr-number> <kind> <reason>" >&2
  exit 0
fi
if [ -z "${REPO:-}" ]; then
  echo "automerge-explain: REPO is unset; not posting." >&2
  exit 0
fi

MARKER="<!-- automerge-declined:${KIND} -->"

# ── already said it? ────────────────────────────────────────────────────────
# Scope the search to github-actions[bot]'s own comments so a human quoting the
# marker back into the thread cannot suppress a real explanation.
EXISTING=$(gh api "repos/$REPO/issues/$PR/comments?per_page=100" --paginate \
  -q '.[] | select(.user.login=="github-actions[bot]") | .body' 2>/dev/null || true)
if printf '%s' "$EXISTING" | grep -qF "$MARKER"; then
  echo "automerge-explain: PR #$PR already carries a '$KIND' decline comment; not posting again."
  exit 0
fi

# Resolved lazily — only on the rare path where we actually post.
HEAD_SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid -q '.headRefOid' 2>/dev/null || true)
AT_SHA=""
[ -n "$HEAD_SHA" ] && AT_SHA=" at \`${HEAD_SHA}\`"

case "$KIND" in
  gate)
    NEXT=$'**What happens next: nothing, unless a human acts.** No `github-actions[bot]` approval will be\nstamped and auto-merge will not be enabled. A CODEOWNER has to review and approve this PR and\nthen merge it by hand.\n\nIf the blocker is size (`AUTOMERGE_MAX_LINES` / `AUTOMERGE_MAX_FILES`), splitting the change into\nsmaller PRs restores the hands-free path.'
    ;;
  carveout|maintainer-carveout)
    NEXT=$'**What happens next: nothing, unless a human acts.** The bot deliberately withholds its approval\nwhen a PR touches a protected path, so that a workflow / CI / Terraform change gets real human\neyes instead of an automatic stamp.\n\nA CODEOWNER for the listed path(s) has to review and approve this PR and then merge it by hand.\nNote that a `github-actions[bot]` approval could not satisfy this anyway: `main-branch-protection`\nrequires **code-owner** review, and the bot is not a code owner.'
    ;;
  *)
    echo "automerge-explain: unknown kind '$KIND'; not posting." >&2
    exit 0
    ;;
esac

BODY="${MARKER}
### 🤖 Auto-merge declined — this PR needs a human

\`auto-approve.yml\` evaluated this PR${AT_SHA} and declined to approve it or enable auto-merge:

> ${REASON}

${NEXT}

<sub>Posted once per PR per reason by \`auto-approve.yml\`; re-runs of the workflow do not repeat it. Green checks on this PR are real — the block is policy, not a broken gate. (GOL-2815)</sub>"

if gh pr comment "$PR" --repo "$REPO" --body "$BODY"; then
  echo "automerge-explain: posted '$KIND' decline comment on PR #$PR."
else
  echo "automerge-explain: FAILED to post '$KIND' decline comment on PR #$PR (continuing anyway)." >&2
fi
exit 0
