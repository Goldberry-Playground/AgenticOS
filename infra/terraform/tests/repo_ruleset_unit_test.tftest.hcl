# Unit tests for the GOL-578 `main` merge-gate ruleset (repo-ruleset.tf).
#
# Plan-mode only + mocked providers: these assert the CONFIGURATION shape, not
# live GitHub state, so they need no credentials and create nothing. They exist
# because this resource is fail-closed by design — a wrong context string or a
# silently-dropped required check either bricks `main` for every PR or removes
# the gate entirely, and neither failure is visible until after an apply.

mock_provider "github" {}
mock_provider "digitalocean" {}
mock_provider "cloudflare" {}
mock_provider "tailscale" {}
mock_provider "random" {}

variables {
  # Satisfy root-module variables unrelated to this resource so `plan` can run.
  # These are DUMMY values consumed only by mocked providers — no real
  # credential is read, and nothing here is ever sent anywhere.
  github_ci_secrets_repo  = "Goldberry-Playground/AgenticOS"
  do_token                = "test-not-a-real-token"
  tailscale_api_key       = "test-not-a-real-token"
  tailscale_tailnet       = "example.com"
  cloudflare_api_token    = "test-not-a-real-token"
  cloudflare_zone_id      = "00000000000000000000000000000000"
  cloudflare_account_id   = "00000000000000000000000000000000"
  agenticos_db_password   = "test-not-a-real-password"
  openviking_root_api_key = "test-not-a-real-token"
  paperclip_company_id    = "00000000-0000-0000-0000-000000000000"
  paperclip_board_key     = "test-not-a-real-token"
  paperclip_tunnel_secret = "test-not-a-real-token"
}

# ── The feature flag is the safety interlock: default MUST manage no resource ──
run "flag_defaults_off_manages_zero_rulesets" {
  command = plan

  assert {
    condition     = length(github_repository_ruleset.main_merge_gate) == 0
    error_message = "Default config must manage ZERO rulesets — an accidental apply has to be a no-op until the soak + emission gates clear."
  }
}

run "flag_off_explicitly_manages_zero_rulesets" {
  command = plan

  variables {
    enable_agent_review_merge_gate = false
  }

  assert {
    condition     = length(github_repository_ruleset.main_merge_gate) == 0
    error_message = "enable_agent_review_merge_gate=false must manage zero rulesets."
  }
}

# ── When enabled, the gate must have exactly the intended shape ────────────────
run "enabled_gate_targets_default_branch_and_is_active" {
  command = plan

  variables {
    enable_agent_review_merge_gate = true
  }

  assert {
    condition     = length(github_repository_ruleset.main_merge_gate) == 1
    error_message = "Enabling the flag must manage exactly one ruleset."
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].enforcement == "active"
    error_message = "Ruleset must be `active` — an `evaluate`/`disabled` gate silently protects nothing."
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].target == "branch"
    error_message = "Ruleset target must be `branch`."
  }

  assert {
    condition = contains(
      github_repository_ruleset.main_merge_gate[0].conditions[0].ref_name[0].include,
      "~DEFAULT_BRANCH"
    )
    error_message = "Gate must apply to the default branch (~DEFAULT_BRANCH), not a hardcoded name that breaks if main is renamed."
  }
}

# ── The agent-review check is the whole point of GOL-578 ──────────────────────
run "agent_review_check_is_required_and_correctly_named" {
  command = plan

  variables {
    enable_agent_review_merge_gate = true
  }

  # Byte-for-byte match with what the github-sync plugin posts. A mismatch here
  # is unrecoverable-by-retry: GitHub matches required checks by context name,
  # so a typo means no PR can ever satisfy the gate.
  assert {
    condition     = var.agent_review_check_context == "agent-review/ada"
    error_message = "agent_review_check_context must be `agent-review/ada` — the retired `alice` slug would never be posted, permanently blocking every merge to main."
  }

  assert {
    condition = contains(
      [for c in github_repository_ruleset.main_merge_gate[0].rules[0].required_status_checks[0].required_check : c.context],
      var.agent_review_check_context
    )
    error_message = "The agent-review context must be present in required_status_checks — without it this ruleset is just the pre-existing CI gate."
  }
}

# ── CI checks must not silently disappear from the gate ───────────────────────
run "all_four_ci_checks_remain_required" {
  command = plan

  variables {
    enable_agent_review_merge_gate = true
  }

  assert {
    condition = alltrue([
      for required in ["Lint", "Typecheck", "Unit tests", "Build"] :
      contains(
        [for c in github_repository_ruleset.main_merge_gate[0].rules[0].required_status_checks[0].required_check : c.context],
        required
      )
    ])
    error_message = "All four CI contexts (Lint/Typecheck/Unit tests/Build) must stay required — these are the job `name:` values in ci.yml and dropping one removes real coverage."
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].rules[0].required_status_checks[0].strict_required_status_checks_policy == true
    # NOTE (2026-08-03): this pins the value THIS file currently declares, and it
    # CONFLICTS with `github_repository_ruleset.main` on main (#462), which sets
    # strict = false deliberately ("it forced a manual Update branch on every
    # open PR after each merge, and the queue supersedes it"). Whichever ruleset
    # ends up owning the branch, both must not disagree — resolve before apply.
    error_message = "strict policy value changed — reconcile with github_repository_ruleset.main (#462) sets strict=false; two rulesets on one branch must not disagree."
  }
}

# ── History/coverage invariants shared with the peer repos ────────────────────
run "history_protections_match_peer_repos" {
  command = plan

  variables {
    enable_agent_review_merge_gate = true
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].rules[0].required_linear_history == true
    error_message = "required_linear_history must match grove-sites/odoocker peer rulesets."
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].rules[0].deletion == true
    error_message = "Branch deletion protection must be on."
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].rules[0].non_fast_forward == true
    error_message = "Force-push (non_fast_forward) protection must be on."
  }

  assert {
    condition = (
      length(github_repository_ruleset.main_merge_gate[0].rules[0].pull_request[0].allowed_merge_methods) == 2 &&
      !contains(github_repository_ruleset.main_merge_gate[0].rules[0].pull_request[0].allowed_merge_methods, "merge")
    )
    error_message = "allowed_merge_methods must be squash+rebase only — a merge commit contradicts required_linear_history."
  }
}

# ── Emergency bypass stays admin-only ─────────────────────────────────────────
run "bypass_is_admin_role_only" {
  command = plan

  variables {
    enable_agent_review_merge_gate = true
  }

  assert {
    condition     = length(github_repository_ruleset.main_merge_gate[0].bypass_actors) == 1
    error_message = "Exactly one bypass actor — every extra actor is a hole in a fail-closed gate."
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].bypass_actors[0].actor_type == "RepositoryRole"
    error_message = "Bypass must be the built-in Admin repository role, not an Integration/App (an App bypass would let agent PRs skip the very gate this ruleset creates)."
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].bypass_actors[0].actor_id == 5
    error_message = "Bypass actor must be role id 5 (Admin), matching the peer rulesets."
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].bypass_actors[0].bypass_mode == "always"
    error_message = "bypass_mode must stay `always` — narrowing it to `pull_request` silently removes the admin escape hatch for direct pushes during an incident."
  }
}

# ── Human review stays out of the gate (the Phase-3 posture) ──────────────────
run "human_review_not_required" {
  command = plan

  variables {
    enable_agent_review_merge_gate = true
  }

  assert {
    condition     = github_repository_ruleset.main_merge_gate[0].rules[0].pull_request[0].required_approving_review_count == 0
    error_message = "Phase 3 intentionally requires ZERO human approvals — agent sign-off is the gate. Changing this is a policy decision, not a config tweak."
  }
}

# ── This ruleset must NOT declare a merge queue (see repo-ruleset.tf) ─────────
run "declares_no_merge_queue" {
  command = plan

  variables {
    enable_agent_review_merge_gate = true
  }

  assert {
    condition     = length(github_repository_ruleset.main_merge_gate[0].rules[0].merge_queue) == 0
    error_message = "This ruleset must not declare a merge_queue: the queue is owned by github_repository_ruleset.main (#462), and a queue combined with the plugin-posted agent-review/ada check locks main for every non-admin merge (the plugin never posts on merge_group SHAs)."
  }
}
