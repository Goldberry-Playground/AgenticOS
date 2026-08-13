# Cloudflare Access service token for machine-to-machine delivery of GitHub
# Actions → Paperclip routine webhooks.
#
# WHY: paperclip.gatheringatthegrove.com is behind Cloudflare Access (Google
# SSO) — great for humans, but a GitHub Actions runner POSTing to a routine's
# webhook would just get 302'd to the Google login. A *service token* is a
# non-interactive credential (Client-Id + Client-Secret headers) that bypasses
# the SSO gate for one machine client.
#
# SCOPE: rather than letting the token reach the whole Paperclip host, this
# defines a SEPARATE, path-scoped Access application covering ONLY the routine
# webhook delivery path:
#   POST https://paperclip.gatheringatthegrove.com/api/routine-triggers/public/<publicId>/fire
# Cloudflare matches the most-specific application, so requests to that path are
# gated by the service-token policy here, while everything else on the host stays
# behind the Google-SSO `dashboard`/`paperclip` Access apps. If the token leaks,
# the blast radius is "can fire routine webhooks," not "full Paperclip API."

resource "cloudflare_zero_trust_access_service_token" "qa_smoke_webhook" {
  account_id = var.cloudflare_account_id
  name       = "odoocker-qa-smoke-webhook"
  # Default duration is non-expiring; rotate via `terraform taint` if needed.
}

resource "cloudflare_zero_trust_access_application" "paperclip_routine_webhook" {
  account_id = var.cloudflare_account_id
  name       = "AgenticOS Paperclip — routine webhooks (service token)"
  # Path-scoped: only the routine-trigger fire endpoint. More specific than the
  # host-wide `paperclip` Access app, so it wins for this path.
  domain                     = "${var.paperclip_domain}/api/routine-triggers/public"
  type                       = "self_hosted"
  session_duration           = "0s" # non-identity / no session for a machine endpoint
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_webhook_allow_service_token" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_routine_webhook.id
  name           = "Allow QA smoke service token"
  precedence     = 1
  decision       = "non_identity" # service-token auth, no human identity

  include {
    service_token = [cloudflare_zero_trust_access_service_token.qa_smoke_webhook.id]
  }
}

# --- Step 9 inbound: GitHub → Paperclip via the github-sync-plugin webhook ------
# The plugin exposes a public inbound webhook at
#   POST /api/plugins/<plugin-id>/webhooks/github-issue
# That lives under /api/plugins/* — NOT /api/routine-triggers/public — so the app
# above does not cover it, and GitHub Actions would be 302'd to SSO. Add a SECOND
# path-scoped Access app for this plugin's /webhooks prefix, reusing the SAME
# service token. Scoped to the plugin's webhooks path only, so the token can't
# reach /api/plugins/<id>/config or /install (those also require board auth at the
# app layer — this keeps least-privilege at the edge too). Signature verification
# is still the plugin's job (HMAC).
#
# ⚠️ THIS ID IS A LANDMINE — verify before ever changing it. It must equal the id
# of `agenticos.github-sync-plugin` — NOT `agenticos.github-plugin`, a different,
# older plugin whose key also matches a naive "github" search of /api/plugins.
# That exact confusion caused the 2026-08-13 incident: the id here was "corrected"
# to github-plugin's id (PR #503), which moved all three Access bypasses OFF the
# real webhook path and 302'd every GitHub delivery at the edge until it was
# reverted the same day. Verify with:
#   GET /api/plugins → the entry with pluginKey == "agenticos.github-sync-plugin"
# The id is stable across normal operation but WOULD rotate on a delete+install
# reinstall (Paperclip has no in-place update). If it ever legitimately changes,
# THREE places must move together in one change window: this variable (3 Access-app
# paths), the GitHub App's webhook URL, and any legacy per-repo workflow path.
# The deploy-gate id-drift check + inbound dead-man probe (GOL-1394, PR #506)
# exist to catch both failure modes.

variable "github_sync_plugin_id" {
  description = "Installed id of agenticos.github-sync-plugin (NOT agenticos.github-plugin — see landmine note). Path-scopes the inbound webhook Access apps; must match the GitHub App webhook URL."
  type        = string
  default     = "f46075f1-bfb9-441b-90ea-ab1976ef83ff"
}

resource "cloudflare_zero_trust_access_application" "paperclip_plugin_webhook" {
  account_id = var.cloudflare_account_id
  name       = "AgenticOS Paperclip — plugin webhooks (service token)"
  # Path-scoped to this one plugin's webhook endpoints. More specific than the
  # host-wide `paperclip` SSO app, so it wins for this path.
  domain                     = "${var.paperclip_domain}/api/plugins/${var.github_sync_plugin_id}/webhooks"
  type                       = "self_hosted"
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_plugin_webhook_allow_service_token" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_plugin_webhook.id
  name           = "Allow issue-sync service token"
  precedence     = 1
  decision       = "non_identity"

  include {
    service_token = [cloudflare_zero_trust_access_service_token.qa_smoke_webhook.id]
  }
}

# The CI client credentials. Put them in odoocker's GitHub Actions secrets
# (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET) and have the qa-smoke workflow
# send them as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers on the
# webhook POST. See docs/runbooks/qa-smoke-paperclip-webhook.md.
output "qa_smoke_access_client_id" {
  description = "Cloudflare Access service-token Client-Id for the odoocker QA-smoke webhook (not secret)."
  value       = cloudflare_zero_trust_access_service_token.qa_smoke_webhook.client_id
}

output "qa_smoke_access_client_secret" {
  description = "Cloudflare Access service-token Client-Secret. Capture once (terraform output -raw) into 1Password + odoocker GH secret CF_ACCESS_CLIENT_SECRET."
  value       = cloudflare_zero_trust_access_service_token.qa_smoke_webhook.client_secret
  sensitive   = true
}

# --- Native GitHub App issues webhook (inbound v2, PR #228) --------------------
# GitHub App deliveries carry ONLY an HMAC signature (X-Hub-Signature-256) —
# GitHub cannot attach Cloudflare Access service-token headers, so the
# Service-Auth app above 403s every delivery at the edge (verified live
# 2026-07-08: POST → 403 with cf-access-domain, deliveries dead on arrival).
#
# Fix: a MORE specific Access application scoped to exactly the github-app
# endpoint with a Bypass policy. Cloudflare matches the most-specific app per
# path, so:
#   /api/plugins/<id>/webhooks/github-app  → this app (Bypass — GitHub can POST)
#   /api/plugins/<id>/webhooks/*           → service-token app above (unchanged)
# Authentication for this path is the plugin's job and already implemented:
# onWebhook verifies X-Hub-Signature-256 against config.appWebhookSecret and
# drops anything unsigned/invalid. This is the standard GitHub-webhook trust
# model (same as the QA-smoke HMAC), minus the service token GitHub can't send.
resource "cloudflare_zero_trust_access_application" "paperclip_github_app_webhook" {
  account_id = var.cloudflare_account_id
  name       = "AgenticOS Paperclip — GitHub App issues webhook (HMAC, bypass)"
  domain     = "${var.paperclip_domain}/api/plugins/${var.github_sync_plugin_id}/webhooks/github-app"
  type       = "self_hosted"
  # Machine endpoint: no sessions, hidden from the app launcher.
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_github_app_webhook_bypass" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_github_app_webhook.id
  name           = "Bypass — GitHub App deliveries (HMAC-verified by the plugin)"
  precedence     = 1
  decision       = "bypass"

  include {
    everyone = true
  }
}

# --- Native GitHub App pull_request webhook (PR review pipeline, GOL-158) ------
# The agent PR review pipeline (github-sync-plugin v0.7.0) adds a THIRD inbound
# endpoint, `…/webhooks/github-pr`, fed by the App's `pull_request` events. Like
# the github-app issues webhook, GitHub can only attach an HMAC signature — it
# cannot send Cloudflare Access service-token headers — so without a more-specific
# Bypass app the service-token app above 403s every delivery at the edge.
#
# Same trust model as github-app: a MORE specific Access application scoped to
# exactly this endpoint with a Bypass policy. Cloudflare matches most-specific:
#   /api/plugins/<id>/webhooks/github-pr   → this app (Bypass — GitHub can POST)
#   /api/plugins/<id>/webhooks/github-app  → the issues bypass app (unchanged)
#   /api/plugins/<id>/webhooks/*           → service-token app (unchanged)
# Authentication is the plugin's job: onWebhook verifies X-Hub-Signature-256
# against config.appWebhookSecret (the SAME secret as github-app) and drops
# anything unsigned/invalid.
resource "cloudflare_zero_trust_access_application" "paperclip_github_pr_webhook" {
  account_id = var.cloudflare_account_id
  name       = "AgenticOS Paperclip — GitHub App pull_request webhook (HMAC, bypass)"
  domain     = "${var.paperclip_domain}/api/plugins/${var.github_sync_plugin_id}/webhooks/github-pr"
  type       = "self_hosted"
  # Machine endpoint: no sessions, hidden from the app launcher.
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_github_pr_webhook_bypass" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_github_pr_webhook.id
  name           = "Bypass — GitHub App pull_request deliveries (HMAC-verified by the plugin)"
  precedence     = 1
  decision       = "bypass"

  include {
    everyone = true
  }
}
