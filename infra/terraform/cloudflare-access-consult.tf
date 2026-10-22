# Cloudflare Access for the Grove Consult dashboard (GOL-3577, consult phase 2 E).
#
# consult.gatheringatthegrove.com is an INTERNAL staff tool (grove-sites
# apps/consult) served from a DigitalOcean App Platform app that odoocker's
# production Terraform owns (infra/terraform/environments/production/consult.tf:
# the app, the proxied CNAME, the Spaces prefix). The Access application and
# policy live HERE, not there, because this is where the Cloudflare token with
# Account→Access:Edit already is (odoocker's prod token is zone-scoped) and
# because the spec asks for "the same mechanism Paperclip uses": same Google
# IdP data source, same self_hosted app shape, same email-allowlist policy as
# cloudflare-tunnel.tf's `paperclip` app. No new credentials.
#
# What the two halves exchange: the Access app's AUD tag (output
# `consult_access_aud`, below). odoocker's consult app carries it as
# CF_ACCESS_AUD so the BFF can verify `Cf-Access-Jwt-Assertion` on every
# request -- App Platform's default *.ondigitalocean.app ingress is public and
# has no IP allowlist, so edge Access alone is not enough; the app must check
# the JWT and fail closed.
#
# KILL SWITCH (either half, independently; neither touches the nursery):
#   - here:    comment out / delete cloudflare_zero_trust_access_policy
#              .consult_allow_staff and apply. An Access app with no allow
#              policy denies everyone at the edge. Reverse by restoring it.
#   - odoocker: set var.consult_enabled=false and apply targeted (destroys the
#              app + CNAME). See docs/runbooks/consult-cloudflare-access.md.

resource "cloudflare_zero_trust_access_application" "consult" {
  account_id                 = var.cloudflare_account_id
  name                       = "Grove Consult"
  domain                     = var.consult_domain
  type                       = "self_hosted"
  session_duration           = "24h"
  auto_redirect_to_identity  = true # single IdP; skip the chooser, same as paperclip
  allowed_idps               = [data.cloudflare_zero_trust_access_identity_provider.google.id]
  app_launcher_visible       = true
  http_only_cookie_attribute = true
}

# Staff emails only. var.consult_staff_emails is the allowlist; add a staff
# member by appending their Google-SSO address there and applying -- never by
# hand in the Zero Trust dashboard (the next apply would remove it).
resource "cloudflare_zero_trust_access_policy" "consult_allow_staff" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.consult.id
  name           = "Allow consult staff"
  precedence     = 1
  decision       = "allow"

  include {
    email = var.consult_staff_emails
  }
}

output "consult_access_aud" {
  description = "AUD tag of the Grove Consult Access application. Paste into odoocker production var.consult_access_aud (CF_ACCESS_AUD on grove-consult-prod) so the BFF can verify Access JWTs. Not a secret."
  value       = cloudflare_zero_trust_access_application.consult.aud
}
