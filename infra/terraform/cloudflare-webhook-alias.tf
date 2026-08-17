# --- Stable inbound-webhook alias (GOL-1416, folds #504 / extends #506) --------
#
# PROBLEM this kills: the github-sync-plugin id used to appear in TWO externally-
# visible surfaces — the GitHub App's webhook URL and the CF Access app paths —
# so a plugin-id change (a delete+reinstall; Paperclip has no in-place update)
# meant editing the GitHub App settings AND three Access-app paths in one fragile
# change window. Worse, the id is one naive `/api/plugins` search away from the
# WRONG plugin (`agenticos.github-plugin`); that confusion 302'd every GitHub
# delivery at the edge on 2026-08-13 (PR #503, reverted same day #507). #506 added
# an id-drift deploy-gate + dead-man probe to *catch* the mistake; this alias
# *removes the coupling* so the mistake mostly can't be made.
#
# HOW: a zone URL-Rewrite (Transform Rule) translates a STABLE, id-free public
# path to the real plugin-id path before the request reaches origin:
#   POST paperclip.<domain>/api/gh-webhooks/github-app  ─rewrite→ /api/plugins/<id>/webhooks/github-app
#   POST paperclip.<domain>/api/gh-webhooks/github-pr   ─rewrite→ /api/plugins/<id>/webhooks/github-pr
# The GitHub App webhook URL and the CF Access apps then reference ONLY the
# id-free `/api/gh-webhooks/*` (App URL) / `/api/plugins/*/webhooks/...` (Access,
# wildcard) surfaces. The plugin id survives in exactly ONE place: the rewrite
# target below — a single, deploy-gate-covered line, not three edge surfaces.
#
# ORDERING — CORRECTED 2026-08-16 (GOL-1416 live re-verify). The earlier assumption
# here was that URL Rewrite (http_request_transform, phase 3) runs before Access
# (~phase 13) so Access would evaluate the ALREADY-rewritten `/api/plugins/<id>/...`
# path and the wildcard bypass apps would cover the alias for free. That is FALSE
# in practice: Cloudflare Access matches its applications against the ORIGINAL
# request path, not the transform-rewritten one. Proven live — with this ruleset
# APPLIED (state id 452caa91, zero drift), a POST to the alias path still 302s to
# the Google-SSO login, and the 302 `redirect_url` is the ORIGINAL
# `/api/gh-webhooks/github-app` (not the rewrite target). So the alias path needs
# its OWN bypass Access application; the wildcard `/api/plugins/*/webhooks/...`
# apps in cloudflare-qa-webhook.tf do NOT cover `/api/gh-webhooks/*`. Those bypass
# apps (added below) satisfy Access on the alias path; the transform then rewrites
# to the id-stable KEY path for origin routing.
#
# The rewrite target now points at the KEY path (var.github_sync_plugin_key,
# `agenticos.github-sync-plugin`), NOT the legacy install UUID — so the alias is
# both id-FREE (public) and id-STABLE (survives a plugin reinstall), closing the
# last UUID reference on the inbound path (aligns with GOL-1394 option A).
#
# ROLLOUT is additive + reversible. Applying this ruleset changes nothing for the
# CURRENT App URL (still the literal `/api/plugins/<id>/webhooks/...` path, which
# no rewrite touches and the wildcard Access apps still cover). Only after the
# stable path is verified (curl below) does the GitHub App URL flip to
# `/api/gh-webhooks/*`. Rollback = flip the App URL back; the literal path never
# stopped working. See docs/runbooks/inbound-webhook-alias-cutover.md.
#
# VERIFY the edge AFTER applying this change and BEFORE the App-URL cutover (a
# NON-Access response — 401 from HMAC, or the same status the KEY path returns —
# proves BOTH the alias bypass Access app AND the rewrite fired; a 302-to-Google
# or 403 cf-access means Access still gates the alias, do NOT cut over):
#   curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
#     https://paperclip.gatheringatthegrove.com/api/gh-webhooks/github-app \
#     -H 'X-GitHub-Event: ping' -d '{}'
# NB (2026-08-16): the KEY/UUID plugin webhook paths themselves currently return
# 502 at origin (a bogus plugin id cleanly 404s), i.e. the github-sync-plugin
# webhook handler is erroring — resolve that origin-health issue before trusting
# a live-delivery cutover; the alias will inherit whatever the key path returns.
#
# BLAST RADIUS: a zone-level entrypoint ruleset (whole gatheringatthegrove.com
# zone), but each rule's expression is pinned to the exact host + exact path, so
# nothing else in the zone is touched. Cloudflare allows ONE entrypoint ruleset
# per (zone, phase): if `terraform apply` returns 409 "ruleset already exists" for
# http_request_transform, an entrypoint was created out-of-band — import it
# (`terraform import cloudflare_ruleset.webhook_alias zone/<zone_id>/<ruleset_id>`)
# and fold these rules into it rather than creating a second.
resource "cloudflare_ruleset" "webhook_alias" {
  zone_id     = var.cloudflare_zone_id
  name        = "Inbound webhook alias — stable id-free paths"
  description = "GOL-1416: rewrite /api/gh-webhooks/* to the github-sync-plugin id path so the plugin id never appears in the GitHub App URL or CF Access paths."
  kind        = "zone"
  phase       = "http_request_transform"

  rules {
    ref         = "gh_webhook_alias_github_app"
    description = "Alias: /api/gh-webhooks/github-app -> github-sync-plugin issues webhook"
    expression  = "(http.host eq \"${var.paperclip_domain}\" and http.request.uri.path eq \"/api/gh-webhooks/github-app\")"
    action      = "rewrite"
    action_parameters {
      uri {
        path {
          value = "/api/plugins/${var.github_sync_plugin_key}/webhooks/github-app"
        }
      }
    }
    enabled = true
  }

  rules {
    ref         = "gh_webhook_alias_github_pr"
    description = "Alias: /api/gh-webhooks/github-pr -> github-sync-plugin pull_request webhook"
    expression  = "(http.host eq \"${var.paperclip_domain}\" and http.request.uri.path eq \"/api/gh-webhooks/github-pr\")"
    action      = "rewrite"
    action_parameters {
      uri {
        path {
          value = "/api/plugins/${var.github_sync_plugin_key}/webhooks/github-pr"
        }
      }
    }
    enabled = true
  }
}

# --- Bypass Access apps for the id-free alias paths (GOL-1416 fix, 2026-08-16) ---
# Cloudflare Access matches applications on the ORIGINAL request path (see ORDERING
# note above), so the `/api/gh-webhooks/*` alias paths need their OWN bypass Access
# apps — the wildcard `/api/plugins/*/webhooks/...` apps in cloudflare-qa-webhook.tf
# do not cover them, which is why the alias 302'd to SSO with this ruleset already
# applied. These mirror the github-app / github-pr bypass apps exactly (Bypass,
# everyone) — same trust model: Access is bypassed at the edge and the request is
# authenticated by the plugin's HMAC (X-Hub-Signature-256) at the app layer after
# the transform rewrites the path to the id-stable KEY plugin webhook. Scoped to
# the two exact alias paths, so blast radius is those endpoints only.
resource "cloudflare_zero_trust_access_application" "paperclip_gh_webhook_alias_app" {
  account_id                 = var.cloudflare_account_id
  name                       = "AgenticOS Paperclip — gh-webhooks alias, issues (HMAC, bypass)"
  domain                     = "${var.paperclip_domain}/api/gh-webhooks/github-app"
  type                       = "self_hosted"
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_gh_webhook_alias_app_bypass" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_gh_webhook_alias_app.id
  name           = "Bypass — gh-webhooks alias issues (HMAC-verified by the plugin)"
  precedence     = 1
  decision       = "bypass"

  include {
    everyone = true
  }
}

resource "cloudflare_zero_trust_access_application" "paperclip_gh_webhook_alias_pr" {
  account_id                 = var.cloudflare_account_id
  name                       = "AgenticOS Paperclip — gh-webhooks alias, pull_request (HMAC, bypass)"
  domain                     = "${var.paperclip_domain}/api/gh-webhooks/github-pr"
  type                       = "self_hosted"
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_gh_webhook_alias_pr_bypass" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_gh_webhook_alias_pr.id
  name           = "Bypass — gh-webhooks alias pull_request (HMAC-verified by the plugin)"
  precedence     = 1
  decision       = "bypass"

  include {
    everyone = true
  }
}

# The stable, id-free paths to configure as the GitHub App webhook URL(s) after
# the edge is verified. Surfaced as outputs so the cutover runbook can read them
# straight from `terraform output` instead of hand-assembling the URL.
output "github_app_webhook_alias_url" {
  description = "Stable id-free GitHub App webhook URL for issues events (POST). Set this as the GitHub App's webhook URL after verifying the edge."
  value       = "https://${var.paperclip_domain}/api/gh-webhooks/github-app"
}

output "github_pr_webhook_alias_url" {
  description = "Stable id-free GitHub App webhook URL for pull_request events (POST), if delivered to a distinct URL."
  value       = "https://${var.paperclip_domain}/api/gh-webhooks/github-pr"
}
