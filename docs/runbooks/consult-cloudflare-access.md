# Runbook — Grove Consult dashboard behind Cloudflare Access (GOL-3577)

`consult.gatheringatthegrove.com` is the internal syntropic-design dashboard
(grove-sites `apps/consult`, spec: grove-odoo-modules
`docs/superpowers/specs/2026-10-22-consult-dashboard-design.md` §D/§E). Staff
only, Google SSO, same mechanism as Paperclip's board UI
([paperclip-cloudflare-access.md](paperclip-cloudflare-access.md)).

## Architecture: two Terraform roots, one host

```
browser ─► Cloudflare edge (Access: Google SSO, staff emails) ─► proxied CNAME
                                                                     │
                                                                     ▼
                                      grove-consult-prod (DO App Platform, GHCR image)
                                                │  BFF verifies Cf-Access-Jwt-Assertion
                                                ▼
                                      Odoo /grove/api/v1/consult/* (headless API key)
```

| Piece | Repo / file | Token |
|---|---|---|
| Access application + staff policy, `consult_access_aud` output | **this repo** `infra/terraform/cloudflare-access-consult.tf` | `cloudflare_api_token` here (has Account→Access:Edit) |
| App Platform app, proxied CNAME, Spaces prefix `consult/` | odoocker `infra/terraform/environments/production/consult.tf` | odoocker prod tokens (zone-scoped CF, DO) |

Split on purpose: odoocker's prod Cloudflare token is zone-scoped and has no
Access permission, and the spec rules out new credentials. The Access app has
to be where the Access-capable token already is.

**Why the app verifies the JWT itself.** App Platform's default
`*.ondigitalocean.app` ingress is public and has no origin IP allowlist, so
edge Access alone is bypassable by anyone who learns the ingress hostname. The
consult BFF must verify `Cf-Access-Jwt-Assertion` (issuer
`https://goldberrygrove.cloudflareaccess.com`, audience = the AUD below) on
every request and fail closed when `CF_ACCESS_AUD` is unset. That is an
app-side requirement on GOL-3576 (Iris); the infra hands it the two envs.

## First-time apply (Josh, from the Mac, same session shape as Paperclip's)

```bash
cd infra/terraform
terraform plan    # expect: +1 access_application, +1 access_policy (consult), nothing else
terraform apply
terraform output -raw consult_access_aud   # 64-char hex, NOT a secret
```

Then in odoocker, set `consult_access_aud` to that value (a committed default
in `variables.tf` is fine; the AUD is in every Access JWT) and follow
`docs/RUNBOOK-consult-host.md` there for the app side. Order does not matter:
the Access app can exist before the host resolves (it just guards nothing
yet), and the host can exist before the Access app (then it is reachable only
through the JWT-checking BFF, which denies everything until the AUD is set).

## Adding or removing a staff member

Edit `var.consult_staff_emails` (`variables.tf` default, or `terraform.tfvars`)
and apply. Never add an email in the Zero Trust dashboard by hand: the next
apply removes it. The validation only accepts addresses on a Grove brand
domain; clients are never on this list (spec: no client portal).

## Kill switch

Either half takes the consult app down on its own. **Neither touches the
nursery or any other app.**

| Switch | Where | Effect | Reverse |
|---|---|---|---|
| Remove the policy | here: delete/comment `cloudflare_zero_trust_access_policy.consult_allow_staff`, `terraform apply` | Access app stays, no allow policy ⇒ every request is denied at the edge | restore the block, apply |
| Remove the component | odoocker: `consult_enabled = false`, `terraform apply -target=digitalocean_app.consult -target=cloudflare_record.consult` | app + CNAME destroyed; host stops resolving | `consult_enabled = true`, same targeted apply, then `doctl apps create-deployment` |

Fastest in an incident: `terraform apply -target=cloudflare_zero_trust_access_policy.consult_allow_staff -destroy`
from this root (one resource, seconds, no DO involvement).

## Verify

```bash
curl -sSI https://consult.gatheringatthegrove.com/ | head -1
# 302 to https://goldberrygrove.cloudflareaccess.com/... = Access is in front
```

A browser session as an allowed email lands on the pipeline view. A session
as a non-listed Google account gets the Cloudflare "not authorised" page.
