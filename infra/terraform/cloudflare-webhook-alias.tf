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
# ORDERING — why this works (and why Access still uses the plugin-id path, not the
# alias). Cloudflare's request pipeline runs URL Rewrite in the `http_request_
# transform` phase (phase 3) BEFORE the Access enforcement phase (~phase 13)
# (ruleset-engine/reference/phases-list). So by the time Access evaluates, the
# path is ALREADY the rewritten `/api/plugins/<id>/webhooks/...`. That is why the
# bypass Access apps in cloudflare-qa-webhook.tf match on `/api/plugins/*/webhooks/
# github-*` (post-rewrite) — a wildcard on the id segment, so no id LITERAL lives
# in the Access config, while the app still matches the real (post-rewrite) path.
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
