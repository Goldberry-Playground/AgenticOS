# PR policy: Draft vs. Ready

This repo follows one house rule for pull requests: **open work-in-progress as
a Draft, and only mark a PR Ready when it is genuinely ready for review.**

The goal is to stop red "ready" PRs — PRs that land in the review queue with
failing checks or unmet dependencies. Draft PRs are excluded from review and
from the CI-failure escalation loop, so use them freely for WIP.

## Open as Draft when any of these is true

- The work is **WIP** — not finished, or you plan to keep pushing to it.
- It **needs human input** before it can proceed (a decision, a credential, a
  design call).
- It **depends on an unmerged PR** or a blocked issue.
- You **do not expect CI to be green** yet.

## Mark Ready only when all of these are true

- The change is **self-contained** — it stands on its own with no unmerged
  dependencies.
- You **ran the smallest local verify** that proves the change (the relevant
  test, lint, or typecheck — not necessarily the full suite).
- You **expect CI to be green**.

## How to open a Draft

- GitHub UI: use the "Create pull request" split button, then **Create draft
  pull request**.
- CLI: `gh pr create --draft`.
- Convert later: use the **Ready for review** button (or `gh pr ready
  <number>`) once the Ready criteria above are met.

When in doubt, open as Draft. It is cheap to promote a Draft to Ready; a red
"ready" PR costs reviewer attention and trips the CI-failure loop.

## After you open the PR: what the merge gates actually require

`main` on this repo is governed by three rulesets. Read them with
`gh api repos/Goldberry-Playground/AgenticOS/rulesets` — the **classic**
branch-protection endpoint answers "Branch not protected" and is misleading.

| ruleset | state | what it means for you |
| --- | --- | --- |
| `ClaudeLimits` (16479528) | disabled | nothing |
| `main-branch-protection` (22343539) | **active** | 1 approving review, **code-owner review required**, **stale approvals dismissed on push**, linear history, required checks: Lint / Typecheck / Unit tests / Build |
| `merge-queue` (20318403) | active | merges go through the queue (squash, all-green grouping) |

Two consequences bite agents regularly:

### Do not push after a maintainer approves — it silently dismisses the review

`dismiss_stale_reviews_on_push: true` means **any** new commit on the branch
drops every existing approval, including a routine "merge `main` in to refresh
the branch". The PR quietly returns to `REVIEW_REQUIRED` and nothing on the page
explains why the approval you just got is gone. This is exactly what happened to
GOL-2769 / #772.

So: get the branch into its final shape *first*, then ask for the approval. If
you must push afterwards, say so and re-request review — do not assume the
earlier approval still counts. If a re-review is only needed because of an
unrelated `main` merge, `git compare <last-signed-sha>...<new-sha>` is enough to
show the reviewed files are untouched, so the prior sign-off can be re-stated
cheaply.

### A bot approval cannot clear a CODEOWNERS path

`auto-approve.yml` stamps an approving review as `github-actions[bot]`, which
does satisfy the "1 approving review" rule. It does **not** satisfy
`require_code_owner_review`, because the bot is not a code owner. Any PR
touching a CODEOWNERS path (`.github/**`, `infra/**`, `scripts/ci/**`, …) needs
a human CODEOWNER regardless — and `auto-approve.yml` deliberately withholds its
approval on those paths rather than stamping a useless one.

**Maintainer-authored exception (GOL-3225).** When the PR's author *is* the
maintainer (Josh), nobody else can approve it, which deadlocked AgenticOS#867.
For those PRs only, the bot approves a protected-path change once
`agent-review/*` (Ada) is `success` **on the current head SHA**, and never
before. Until then the PR carries a "waiting on `agent-review/ada`" comment.
Auto-merge stays off. This clears the "1 approving review" rule. It still can't
satisfy `require_code_owner_review` when the author is the only code owner,
because GitHub won't count an author's own ownership, so that part depends on
the ruleset (see GOL-3225).

### If auto-merge declines, the PR now says so

A PR can be fully green — all checks passing, `agent-review/*` = success — and
still sit at `mergeStateStatus: BLOCKED`, because `auto-approve.yml` declined it
on policy: too large (`AUTOMERGE_MAX_LINES`, default 800), too many files
(`AUTOMERGE_MAX_FILES`, default 25), a sensitive path, or a major production
dependency bump. That used to be invisible outside a workflow log.

Since GOL-2815 the workflow posts one idempotent comment on the PR explaining
the decline and naming the unblock (a CODEOWNER approving and merging by hand).
**If a green PR looks stuck and there is no such comment, the block is not a
policy decline** — look at the check-runs instead.
