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

# ============================================================================
# KEY-STABLE INBOUND PATH (GOL-1394, option A — board-approved 2026-08-14) —
# the id-rotation-severs-inbound CLASS is closed at the edge. The inbound Access
# apps and the GitHub App webhook URL are scoped to the plugin KEY path, which the
# host resolves to the current install id at request time and which never rotates
# on reinstall.
# ============================================================================
# WHY THE UUID USED TO BE A LANDMINE: a github-sync reinstall ROTATES the plugin
# UUID (delete+install is Paperclip's only update path). The UUID was embedded in
# the inbound webhook URL in THREE places that had to move together — the CF Access
# apps, the GitHub App webhook URL, and the install — and on 2026-08-12 only the
# install moved → ~20h of silently-severed inbound sync (every GitHub delivery
# 302'd at the CF edge).
#
# THE FIX: the deployed paperclip-server resolves a NON-UUID `:pluginId` path
# segment as a plugin KEY via `registry.getByKey()` (server/src/routes/plugins.ts
# resolvePlugin()). The key is `manifest.id = "agenticos.github-sync-plugin"` — a
# SOURCE CONSTANT under a UNIQUE DB constraint; the install upserts by key, so the
# UUID rotates on reinstall but the KEY never does. Live-proven 2026-08-14:
#   POST /api/plugins/agenticos.github-sync-plugin/webhooks/github-app → 200
#   POST /api/plugins/no-such-key/webhooks/github-app                  → 404
# So scoping the Access apps + the GitHub App webhook URL to the KEY path makes
# inbound survive a reinstall with ZERO manual TF / GitHub-App edits.
#
# ⚠️ THE KEY IS STILL A LANDMINE OF ONE KIND: it must equal `agenticos.github-sync-plugin`
# — NOT `agenticos.github-plugin`, a different, older plugin that also matches a
# naive "github" search. That confusion caused PR #503 (2026-08-13, reverted same
# day). It is otherwise immutable.
#
# CUTOVER COMPLETE (GOL-1720, 2026-08-24): Josh flipped the GitHub App webhook URL
# to the KEY path (11:50 EDT) and sustained signed 200s were verified on it with
# zero legacy-path traffic. The GOL-1416 cutover BRIDGE — the wildcard
# `/api/plugins/*/webhooks[...]` Access apps and the id-free `/api/gh-webhooks/*`
# alias (formerly cloudflare-webhook-alias.tf) — has been removed here; only the
# KEY-path apps below remain as the inbound edge scope. The inbound dead-man probe
# (GOL-1394) now targets the KEY-path URL.

# Stable plugin KEY — resolved to the current install id at request time by the
# host. NEVER rotates on reinstall; this is the durable inbound scope (GOL-1394).
variable "github_sync_plugin_key" {
  description = "Manifest key of agenticos.github-sync-plugin. The host resolves this non-UUID :pluginId path segment to the current install id at request time (registry.getByKey), so it is id-stable across reinstalls. Scopes the key-path inbound Access apps and the GitHub App webhook URL. MUST be the -sync- key, not agenticos.github-plugin."
  type        = string
  default     = "agenticos.github-sync-plugin"
}

# Legacy live install UUID. NO LONGER path-load-bearing anywhere in the edge
# config — the UUID-scoped bridge Access apps and the /api/gh-webhooks/* alias
# that referenced it were removed at the GOL-1720 cutover teardown. Retained SOLELY
# as the deploy-gate's cosmetic drift signal (scripts/deploy-plugin.sh parses this
# committed default). It may safely drift from the live id after a reinstall; the
# key-path apps carry inbound regardless.
variable "github_sync_plugin_id" {
  description = "Legacy install UUID of agenticos.github-sync-plugin (NOT agenticos.github-plugin — see landmine note). NOT id-stable and not the durable inbound scope (see github_sync_plugin_key). No longer embedded in any Access-app path or URL rewrite (the /api/gh-webhooks/* alias was removed in GOL-1720). Sole remaining use: the deploy-gate drift tripwire in scripts/deploy-plugin.sh."
  type        = string
  default     = "f46075f1-bfb9-441b-90ea-ab1976ef83ff"
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

# ============================================================================
# KEY-PATH inbound Access apps (GOL-1394 option A) — the DURABLE, id-stable scope.
# ============================================================================
# These mirror the three UUID-scoped apps above but are scoped to the KEY path
#   /api/plugins/${var.github_sync_plugin_key}/webhooks[...]
# which the host resolves to the current install id at request time and which
# never rotates on reinstall. They are ADDITIVE (a path nothing yet POSTs to), so
# applying them cannot sever inbound. After Josh flips the GitHub App webhook URL
# to the key path and a live delivery is verified, the three UUID apps above are
# deleted in a follow-up and these become the sole inbound edge scope.

# /webhooks — service-token app (QA-smoke + any token-auth webhook), key-scoped.
resource "cloudflare_zero_trust_access_application" "paperclip_plugin_webhook_key" {
  account_id                 = var.cloudflare_account_id
  name                       = "AgenticOS Paperclip — plugin webhooks (service token, key-path)"
  domain                     = "${var.paperclip_domain}/api/plugins/${var.github_sync_plugin_key}/webhooks"
  type                       = "self_hosted"
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_plugin_webhook_key_allow_service_token" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_plugin_webhook_key.id
  name           = "Allow issue-sync service token (key-path)"
  precedence     = 1
  decision       = "non_identity"

  include {
    service_token = [cloudflare_zero_trust_access_service_token.qa_smoke_webhook.id]
  }
}

# /webhooks/github-app — GitHub App issues deliveries (HMAC, bypass), key-scoped.
resource "cloudflare_zero_trust_access_application" "paperclip_github_app_webhook_key" {
  account_id                 = var.cloudflare_account_id
  name                       = "AgenticOS Paperclip — GitHub App issues webhook (HMAC, bypass, key-path)"
  domain                     = "${var.paperclip_domain}/api/plugins/${var.github_sync_plugin_key}/webhooks/github-app"
  type                       = "self_hosted"
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_github_app_webhook_key_bypass" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_github_app_webhook_key.id
  name           = "Bypass — GitHub App deliveries, key-path (HMAC-verified by the plugin)"
  precedence     = 1
  decision       = "bypass"

  include {
    everyone = true
  }
}

# /webhooks/github-pr — GitHub App pull_request deliveries (HMAC, bypass), key-scoped.
resource "cloudflare_zero_trust_access_application" "paperclip_github_pr_webhook_key" {
  account_id                 = var.cloudflare_account_id
  name                       = "AgenticOS Paperclip — GitHub App pull_request webhook (HMAC, bypass, key-path)"
  domain                     = "${var.paperclip_domain}/api/plugins/${var.github_sync_plugin_key}/webhooks/github-pr"
  type                       = "self_hosted"
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_github_pr_webhook_key_bypass" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_github_pr_webhook_key.id
  name           = "Bypass — GitHub App pull_request deliveries, key-path (HMAC-verified by the plugin)"
  precedence     = 1
  decision       = "bypass"

  include {
    everyone = true
  }
}
