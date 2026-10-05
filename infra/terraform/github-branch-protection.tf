# main-branch protection as a ruleset (Layer 2 of the merge-automation spec).
#
# Replaces classic branch protection, which cannot express a merge queue.
# `strict` (require-branches-up-to-date) is deliberately GONE: it forced a manual
# "Update branch" on every open PR after each merge, and the queue supersedes it
# by building and testing the prospective merge commit itself.
#
# OPERATOR AMENDMENT (2026-08-03): the `pull_request` rule below was added
# after the plan was written, to restore CODEOWNERS enforcement (security
# review finding M2). `.github/CODEOWNERS` only binds when a ruleset with
# "Require review from Code Owners" is enabled — classic protection on `main`
# has `required_pull_request_reviews: null`, so CODEOWNERS is inert today, and
# a separate change (Layer 4) is making the auto-approve workflow's
# sensitive-path gate default off. This ruleset is where that protection gets
# restored structurally.
#
# `required_approving_review_count = 0` + `require_code_owner_review = true`
# is GitHub's documented ruleset pattern for "no generic approvals required,
# but a designated code owner must approve changes to paths they own": the two
# fields are independent (see the `integrations/github` provider docs for
# `rules.pull_request`), and `require_code_owner_review` only engages for
# files that have a CODEOWNERS entry. So an ordinary PR touching no
# CODEOWNERS path needs zero approvals — hands-free auto-merge still works —
# while a PR touching a CODEOWNERS path (`.github/`, `infra/`,
# `docker-compose*`, `scripts/agent-git/`, `packages/credential-broker/`,
# `.gitleaks.toml`, `Dockerfile*`) requires the code owner's approval.
# `github-actions[bot]` (the auto-approve workflow's identity, see
# .github/workflows/auto-approve.yml) is not a code owner — only
# @EngineeringMoonBear is — so its approval cannot satisfy this requirement.
# See docs/superpowers/specs/2026-08-03-agent-pr-merge-automation-design.md
# for the full design and the amendment note appended there.
# =============================================================================
# !! DRIFT WARNING -- THIS FILE DOES NOT DESCRIBE LIVE STATE (GOL-3051) !!
#
# Verified against Goldberry-Playground/AgenticOS on 2026-10-05. This file
# declares ONE ruleset named "main". Live, there are TWO, both created by hand
# on 2026-09-05 after the org transfer, and neither is named "main":
#
#   22343539  "main-branch-protection"  deletion, non_fast_forward,
#                                       required_linear_history, pull_request,
#                                       required_status_checks
#   20318403  "merge-queue"             merge_queue only
#
# DO NOT `terraform apply` THIS FILE AS-IS. Because the live rulesets carry
# different NAMES, an apply does not update them -- it CREATES A THIRD ruleset
# on the default branch. And this resource declares
# `required_approving_review_count = 0` where live
# `main-branch-protection` requires 1, so the union would relax the approval
# requirement on `main`.
#
# Until this is reconciled, the enforced sources of truth are:
#   - `.github/merge-policy.json` + `scripts/ci/apply-merge-policy.sh --check`
#     for the settings that tool manages (it reads LIVE state, so it cannot
#     drift the way this file has);
#   - the live rulesets themselves for everything else.
#
# Reconciling this file to the live two-ruleset layout (import + split, or
# delete this file in favour of the policy tool) is tracked separately -- it is
# a protection change on `main` and therefore a board decision, not a drive-by.
# =============================================================================
resource "github_repository_ruleset" "main" {
  name        = "main"
  repository  = "AgenticOS"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    required_status_checks {
      strict_required_status_checks_policy = false

      required_check { context = "Lint" }
      required_check { context = "Typecheck" }
      required_check { context = "Unit tests" }
      required_check { context = "Build" }
    }

    merge_queue {
      # 90, not GitHub's default 30 and not the 60 this line used to carry
      # (GOL-3051). The live value was 30 and the queue silently dequeued
      # approved, green PRs: the hosted-runner wait under ordinary multi-agent
      # PR load is 45-90 min, and once the wait exceeds this timeout GitHub
      # removes the entry with NO failure event -- the PR reverts to
      # open + APPROVED + CLEAN and nothing turns red. 60 would not have been
      # enough either (PR #814 waited 48+ min for `CI` to even start).
      # The declared target of record is `.github/merge-policy.json`
      # (`merge_queue_targets`), which `scripts/ci/apply-merge-policy.sh
      # --surface merge-queue --check` enforces against live state; keep this
      # number equal to it.
      check_response_timeout_minutes    = 90
      grouping_strategy                 = "ALLGREEN"
      max_entries_to_build              = 5
      max_entries_to_merge              = 5
      merge_method                      = "SQUASH"
      min_entries_to_merge              = 1
      min_entries_to_merge_wait_minutes = 5
    }

    # Operator amendment — restores CODEOWNERS enforcement (finding M2).
    # See the header comment above for why 0 + true achieves "zero approvals
    # for ordinary PRs, code-owner approval required on sensitive paths."
    pull_request {
      required_approving_review_count = 0
      require_code_owner_review       = true
    }
  }
}
