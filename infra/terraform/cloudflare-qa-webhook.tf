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
# ============================================================================
# KEY-STABLE INBOUND PATH (GOL-1394, option A — board-approved 2026-08-14) —
# the id-rotation-severs-inbound CLASS is now closed at the edge. This SUPERSEDES
# the GOL-1416 wildcard mitigation as the DURABLE fix; the GOL-1416 wildcard apps
# + the id-free alias still coexist below/alongside as the zero-gap cutover bridge.
# ============================================================================
# WHY THE UUID USED TO BE A LANDMINE: a github-sync reinstall ROTATES the plugin
# UUID (delete+install is Paperclip's only update path). The UUID was embedded in
# the inbound webhook URL in THREE places that had to move together — the CF
# Access apps below, the GitHub App webhook URL, and the install — and on
# 2026-08-12 only the install moved → ~20h of silently-severed inbound sync
# (every GitHub delivery 302'd at the CF edge).
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
# COEXISTING GOL-1416 MITIGATION (still live below): before the key path, GOL-1416
# already (a) removed the UUID from the GitHub App URL via the id-free
# `/api/gh-webhooks/*` alias (cloudflare-webhook-alias.tf) and (b) removed the UUID
# LITERAL from the Access-app paths by wildcarding the id segment
# (`/api/plugins/*/webhooks[...]`). Those wildcard apps are the pre-key-path apps
# and now serve as the cutover BRIDGE. Cloudflare runs URL Rewrite (phase 3) before
# Access (~phase 13) and selects by PATH SPECIFICITY (most-specific path wins,
# exact or wildcard), so the more-specific literal KEY-path apps below win over the
# `*` bridge apps for the github-sync key path, while the `*` apps keep covering any
# other plugin's `/webhooks/...` — a SAFE machine-only default, since every plugin
# webhook still independently authenticates at the app layer (HMAC for github-*,
# service token + board auth for the generic prefix). The edge match is purely
# "which Access policy," not "who is trusted."
#
# BRIDGE / DEPROVISION: the wildcard (GOL-1416) Access apps + the id-free alias are
# kept ONLY as a zero-gap cutover bridge so inbound never drops during the switch.
# Once Josh has repointed the GitHub App webhook URL to the KEY path and a live
# delivery is verified on it (see docs/runbooks/github-issue-sync.md), delete the
# pre-key-path apps + the alias in a trivial follow-up — nothing will POST to the
# UUID/alias path after the App URL flip. Adding the key-path apps is purely
# ADDITIVE and cannot sever anything, so `terraform apply` of this change is safe on
# its own. The deploy-gate id-drift check + inbound dead-man probe (GOL-1394, PR
# #506) still guard the one remaining UUID reference (the alias rewrite target).

# Stable plugin KEY — resolved to the current install id at request time by the
# host. NEVER rotates on reinstall; this is the durable inbound scope (GOL-1394).
variable "github_sync_plugin_key" {
  description = "Manifest key of agenticos.github-sync-plugin. The host resolves this non-UUID :pluginId path segment to the current install id at request time (registry.getByKey), so it is id-stable across reinstalls. Scopes the key-path inbound Access apps and the GitHub App webhook URL. MUST be the -sync- key, not agenticos.github-plugin."
  type        = string
  default     = "agenticos.github-sync-plugin"
}

# Legacy live install UUID. NO LONGER path-load-bearing — retained only for the
# UUID-scoped BRIDGE Access apps (deleted post-cutover) and as the deploy-gate's
# cosmetic drift signal (scripts/deploy-plugin.sh). It may safely drift from the
# live id after a reinstall; the key-path apps carry inbound regardless.
variable "github_sync_plugin_id" {
  description = "Legacy install UUID of agenticos.github-sync-plugin (NOT agenticos.github-plugin — see landmine note). NOT id-stable and no longer the durable inbound scope (see github_sync_plugin_key); no longer embedded as a LITERAL in any Access-app path (those wildcard the id segment or use the key path). Remaining uses: the /api/gh-webhooks/* rewrite target in cloudflare-webhook-alias.tf (GOL-1416) and the deploy-gate drift tripwire in scripts/deploy-plugin.sh. Both are deleted/relaxed post-cutover."
  type        = string
  default     = "f46075f1-bfb9-441b-90ea-ab1976ef83ff"
}

resource "cloudflare_zero_trust_access_application" "paperclip_plugin_webhook" {
  account_id = var.cloudflare_account_id
  name       = "AgenticOS Paperclip — plugin webhooks (service token)"
  # Path-scoped to the plugin webhook endpoints. The `*` wildcards the plugin-id
  # segment (no id LITERAL here) and Access matches the POST-rewrite path; more
  # specific than the host-wide `paperclip` SSO app, so it wins for this path.
  domain                     = "${var.paperclip_domain}/api/plugins/*/webhooks"
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
  domain     = "${var.paperclip_domain}/api/plugins/*/webhooks/github-app"
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
  domain     = "${var.paperclip_domain}/api/plugins/*/webhooks/github-pr"
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
