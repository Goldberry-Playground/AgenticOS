# ONE-SHOT import blocks for the two live AgenticOS rulesets (GOL-3078).
#
# These rulesets were hand-created on 2026-09-05 after the org transfer and
# were never in Terraform state -- verified 2026-10-05: `terraform state list`
# contains no `github_repository_ruleset` at all. So the resources in
# github-branch-protection.tf describe real infrastructure that Terraform does
# not yet manage, and a plain apply would have created duplicates.
#
# `import` blocks (Terraform >= 1.5) close that gap WITHOUT a manual
# `terraform import` state write: `terraform plan` resolves them in memory and
# reports "N to import" plus any real diff, so the reconciliation is provable
# read-only before anything is committed to state.
#
# ID format for integrations/github `github_repository_ruleset` is
# `<repository>:<ruleset_id>`.
#
# !! DELETE THIS FILE in the PR immediately after the import apply lands. !!
# Import blocks are not idempotent config: once the resources are in state they
# have nothing left to do, and leaving them makes every future plan re-assert a
# one-time migration. The expected plan after they are gone is "No changes."

import {
  to = github_repository_ruleset.main_branch_protection
  id = "AgenticOS:22343539"
}

import {
  to = github_repository_ruleset.merge_queue
  id = "AgenticOS:20318403"
}
