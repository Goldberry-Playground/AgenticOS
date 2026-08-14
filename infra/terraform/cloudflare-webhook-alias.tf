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
# ORDERING — ⚠️ CORRECTED 2026-08-14 (was empirically wrong). This block ORIGINALLY
# claimed URL Rewrite (http_request_transform) runs BEFORE Access, so Access would
# see the rewritten `/api/plugins/<id>/webhooks/...` path — which is why the bypass
# apps in cloudflare-qa-webhook.tf were wildcarded to `/api/plugins/*/webhooks/...`.
# FALSE: Cloudflare Access matches its applications on the ORIGINAL incoming path
# (verified live after the #550 apply — the alias 302'd to the Access login while
# the literal path returned 502). The rewrite only rewrites the ORIGIN-bound path.
# The fix is at the BOTTOM of this file: Access bypass apps scoped to the id-free
# `/api/gh-webhooks/*` alias paths themselves. The wildcarded `/api/plugins/*/
# webhooks/...` apps still correctly cover the literal-path App URL in use pre-cutover.
#
# ROLLOUT is additive + reversible. Applying this ruleset changes nothing for the
# CURRENT App URL (still the literal `/api/plugins/<id>/webhooks/...` path, which
# no rewrite touches and the wildcard Access apps still cover). Only after the
# stable path is verified (curl below) does the GitHub App URL flip to
# `/api/gh-webhooks/*`. Rollback = flip the App URL back; the literal path never
# stopped working. See docs/runbooks/inbound-webhook-alias-cutover.md.
#
# VERIFY the edge before the App-URL cutover (a NON-Access response — e.g. 400/401
# from the plugin's HMAC check — proves both the rewrite AND the bypass fired; a
# 302-to-Google or 403 cf-access means the wiring is wrong, do NOT cut over):
#   curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
#     https://paperclip.gatheringatthegrove.com/api/gh-webhooks/github-app \
#     -H 'X-GitHub-Event: ping' -d '{}'
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
          value = "/api/plugins/${var.github_sync_plugin_id}/webhooks/github-app"
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
          value = "/api/plugins/${var.github_sync_plugin_id}/webhooks/github-pr"
        }
      }
    }
    enabled = true
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

# --- Access BYPASS on the id-free alias paths (GOL-1416 follow-up) -------------
#
# WHY THIS EXISTS — corrects a wrong ordering assumption in the original alias
# change (#550, 90d399b). #550 assumed Cloudflare's URL-Rewrite (Transform Rules,
# http_request_transform phase) runs BEFORE Access enforcement, so that Access
# would evaluate the POST-rewrite `/api/plugins/<id>/webhooks/...` path — which is
# why the three bypass/service-token apps in cloudflare-qa-webhook.tf were
# wildcarded to `/api/plugins/*/webhooks/...`. That assumption is EMPIRICALLY
# FALSE: Cloudflare Access matches its applications on the ORIGINAL incoming path
# (it has to — the login redirect it builds carries the URL the client asked
# for). Verified live 2026-08-14 after applying #550: a POST to the id-free alias
#   POST paperclip.gatheringatthegrove.com/api/gh-webhooks/github-app
# still 302'd to goldberrygrove.cloudflareaccess.com/.../login with
# redirect_url=/api/gh-webhooks/github-app, while the literal
#   /api/plugins/f46075f1.../webhooks/github-app
# returned 502 (Access bypassed, plugin rejecting the unsigned ping — the healthy
# "non-Access" response). i.e. Access never saw the rewritten path; the rewrite
# only rewrites the ORIGIN-bound path, it does not change what Access matches.
#
# FIX: give the id-free alias paths their OWN Access bypass apps (most-specific
# path wins over the host-wide `paperclip` SSO app, exactly like the literal-path
# bypass apps). Access then lets the alias POST through on the original path; the
# webhook_alias Transform Rule (above) still rewrites it to
# /api/plugins/<id>/webhooks/... for the origin. The plugin still authenticates
# every delivery via HMAC (X-Hub-Signature-256) — same trust model as the
# literal-path github-app / github-pr bypass apps in cloudflare-qa-webhook.tf.
#
# STILL ID-FREE: these apps match the `/api/gh-webhooks/*` alias — no plugin id
# LITERAL and no wildcard-over-plugins here. The plugin id survives in exactly one
# place, the Transform Rule rewrite target above (deploy-gate + dead-man covered,
# #506). The wildcarded `/api/plugins/*/webhooks/...` apps in cloudflare-qa-webhook
# .tf stay — they cover the CURRENT App URL (still the literal path) until cutover
# and remain a correct belt-and-suspenders for any direct literal-path delivery.
resource "cloudflare_zero_trust_access_application" "paperclip_gh_alias_github_app" {
  account_id = var.cloudflare_account_id
  name       = "AgenticOS Paperclip — gh-webhooks alias github-app (HMAC, bypass)"
  # Exact id-free alias path. More specific than the host-wide `paperclip` SSO
  # app, so Access applies THIS app (bypass) to the alias POST.
  domain                     = "${var.paperclip_domain}/api/gh-webhooks/github-app"
  type                       = "self_hosted"
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_gh_alias_github_app_bypass" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_gh_alias_github_app.id
  name           = "Bypass — gh-webhooks/github-app alias (HMAC-verified by the plugin)"
  precedence     = 1
  decision       = "bypass"

  include {
    everyone = true
  }
}

resource "cloudflare_zero_trust_access_application" "paperclip_gh_alias_github_pr" {
  account_id                 = var.cloudflare_account_id
  name                       = "AgenticOS Paperclip — gh-webhooks alias github-pr (HMAC, bypass)"
  domain                     = "${var.paperclip_domain}/api/gh-webhooks/github-pr"
  type                       = "self_hosted"
  session_duration           = "0s"
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_gh_alias_github_pr_bypass" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_gh_alias_github_pr.id
  name           = "Bypass — gh-webhooks/github-pr alias (HMAC-verified by the plugin)"
  precedence     = 1
  decision       = "bypass"

  include {
    everyone = true
  }
}
