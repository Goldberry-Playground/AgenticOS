# main-branch protection + merge queue on Goldberry-Playground/AgenticOS,
# declared as the two rulesets that ACTUALLY EXIST (Layer 2 of the
# merge-automation spec). Reconciled with live on 2026-10-05 (GOL-3078).
#
# Rulesets replace classic branch protection, which cannot express a merge
# queue. `strict` (require-branches-up-to-date) is deliberately absent: it
# forced a manual "Update branch" on every open PR after each merge, and the
# queue supersedes it by building and testing the prospective merge commit.
#
# =============================================================================
# WHY THERE ARE TWO RESOURCES AND TWO `import` BLOCKS (GOL-3078)
#
# Until 2026-10-05 this file declared ONE ruleset named "main" that matched
# NOTHING live. Both live rulesets were hand-created on 2026-09-05 after the
# org transfer, under different names, and were never imported:
#
#   22343539  "main-branch-protection"
#   20318403  "merge-queue"
#
# GitHub matches rulesets by NAME, so an apply of the old single "main"
# resource would not have updated either of them -- it would have CREATED A
# THIRD ruleset on the default branch. Measured blast radius of that create,
# from a real `terraform plan` (1.9.8, integrations/github 6.13.0) on
# 2026-10-05 -- `Plan: 1 to add`:
#
#   * NOT an approval relaxation. An earlier reading of this hazard claimed a
#     third ruleset declaring `required_approving_review_count = 0` would drop
#     `main` from 1 approval to 0. That is WRONG and is corrected here:
#     GitHub aggregates overlapping rulesets and "the most restrictive version
#     of the rule applies", so 22343539's `1` would have continued to win.
#   * The real hazards were (a) a SECOND `merge_queue` rule on the default
#     branch, racing the one ruleset the queue actually reads (20318403 -- the
#     one whose 30-minute `check_response_timeout_minutes` silently dequeued
#     approved green PRs, GOL-3051), and (b) a ruleset with NO `bypass_actors`
#     while 22343539 grants admin (`RepositoryRole 5`) bypass -- most-
#     restrictive aggregation means the new ruleset would have removed the
#     admin break-glass path (GOL-1736) from `main`.
#   * It could not fire by accident. With committed defaults an apply fails
#     CLOSED before any write: `var.github_ci_token` defaults to "" so the
#     provider gets `401 Bad credentials`, and the provider `owner` resolved
#     from `var.github_ci_secrets_repo` was the PRE-TRANSFER owner
#     `EngineeringMoonBear` (now a user account; the repo path only resolves
#     via a 301 redirect). Reaching the create required deliberately
#     overriding BOTH. That default owner is also fixed in variables.tf.
#
# The `import` blocks live in github-rulesets-import.tf and are ONE-SHOT --
# read the header there before applying.
#
# Not managed here, deliberately: ruleset 16479528 "ClaudeLimits". It is
# `enforcement = "disabled"` AND its `conditions.ref_name.include` is empty,
# so it targets nothing and enforces nothing. Left as-is rather than imported;
# deleting it is a separate board call.
#
# ---------------------------------------------------------------------------
# CODEOWNERS (operator amendment 2026-08-03, security review finding M2)
#
# `.github/CODEOWNERS` only binds when a ruleset with "Require review from
# Code Owners" is enabled. `require_code_owner_review = true` below is what
# makes it bind. Live also requires 1 generic approval
# (`required_approving_review_count = 1`), which is STRICTER than the 0 this
# file used to declare -- so hands-free auto-merge on AgenticOS needs an
# approval, which is why `agent-review/*` sign-off exists. A PR touching a
# CODEOWNERS path (`.github/`, `infra/`, `docker-compose*`,
# `scripts/agent-git/`, `packages/credential-broker/`, `.gitleaks.toml`,
# `Dockerfile*`) additionally requires the code owner's approval;
# `github-actions[bot]` is not a code owner, so its approval cannot satisfy
# that requirement.
# See docs/superpowers/specs/2026-08-03-agent-pr-merge-automation-design.md
#
# ---------------------------------------------------------------------------
# HOW TO VERIFY THIS FILE STILL DESCRIBES LIVE (no state write, read-only)
#
#   export AWS_ACCESS_KEY_ID=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/tfstate_spaces_access_key_id")
#   export AWS_SECRET_ACCESS_KEY=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/tfstate_spaces_secret_key")
#   TOK=$(node scripts/agent-git/github-app-token.mjs token Goldberry-Playground/AgenticOS | awk 'NR==1{print $1}')
#   terraform -chdir=infra/terraform init
#   terraform -chdir=infra/terraform plan -lock=false \
#       -var "github_ci_token=$TOK" \
#       -target=github_repository_ruleset.main_branch_protection \
#       -target=github_repository_ruleset.merge_queue
#
# Expected BEFORE the one-shot import apply: "2 to import, 0 to add,
# 0 to change, 0 to destroy". AFTER it: "No changes." Anything else is drift.
# (A full untargeted plan additionally needs every other TF_VAR in
# variables.tf; the two -targets keep this to the GitHub provider alone.)
# =============================================================================

# Live id 22343539. Carries everything except the merge queue.
resource "github_repository_ruleset" "main_branch_protection" {
  name        = "main-branch-protection"
  repository  = "AgenticOS"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  # Admin break-glass. RepositoryRole 5 == the repository `admin` role. This is
  # the documented escape hatch for a wedged queue / emergency revert
  # (GOL-1736); removing it is a board call, not a tidy-up.
  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    pull_request {
      required_approving_review_count   = 1
      dismiss_stale_reviews_on_push     = true
      require_code_owner_review         = true
      require_last_push_approval        = false
      required_review_thread_resolution = false
    }

    # LOCKSTEP: this set must equal AgenticOS's `required_contexts` in
    # .github/merge-policy.json and .github/required-checks.json. The
    # GOL-1953 promotion that widens it is paused; see the `//pause` note in
    # merge-policy.json. Change all three in the same PR.
    required_status_checks {
      strict_required_status_checks_policy = false

      required_check { context = "Lint" }
      required_check { context = "Typecheck" }
      required_check { context = "Unit tests" }
      required_check { context = "Build" }
    }
  }
}

# Live id 20318403. Merge queue ONLY -- this is the ruleset GitHub's merge
# queue actually reads. It must stay the single source of merge_queue rules on
# the default branch; a second one races it.
#
# `check_response_timeout_minutes = 90` is load-bearing (GOL-3051): hosted
# runner queue waits of 45-90 min under multi-agent load exceeded the previous
# 30, and the queue then SILENTLY dequeued approved, green PRs with nothing
# reported red. Do not lower it without re-measuring the queue wait.
# `.github/merge-policy.json` declares the same 90 and
# `scripts/ci/apply-merge-policy.sh --check` fails on drift.
resource "github_repository_ruleset" "merge_queue" {
  name        = "merge-queue"
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
    merge_queue {
      check_response_timeout_minutes    = 90
      grouping_strategy                 = "ALLGREEN"
      max_entries_to_build              = 5
      max_entries_to_merge              = 5
      merge_method                      = "SQUASH"
      min_entries_to_merge              = 1
      min_entries_to_merge_wait_minutes = 2
    }
  }
}
