# Runbook — Inbound webhook alias cutover (GOL-1416)

**Owner:** DevOps (Terra) · **Epic:** GOL-1401 (github-sync reliability) · **Folds:** #504 · **Extends:** #506

## What this changes and why

The `github-sync-plugin` installed id used to appear in **two externally-visible
surfaces**:

1. the **GitHub App webhook URL** (`…/api/plugins/<id>/webhooks/github-app`), and
2. three **Cloudflare Access app paths** (service-token + two HMAC-bypass apps).

A plugin-id change (a delete+reinstall — Paperclip has no in-place update) therefore
forced editing the GitHub App settings **and** three Access-app paths in one fragile
change window. The id is also one naive `/api/plugins` search away from the WRONG
plugin (`agenticos.github-plugin`); that confusion 302'd **every** GitHub delivery at
the edge on 2026-08-13 (PR #503, reverted same day #507).

GOL-1416 removes the coupling:

- **`cloudflare-webhook-alias.tf`** adds a zone URL-Rewrite (Transform Rule) that
  translates a **stable, id-free** public path to the real plugin-id path *before*
  the request reaches Access/origin:
  - `POST …/api/gh-webhooks/github-app` → `…/api/plugins/<id>/webhooks/github-app`
  - `POST …/api/gh-webhooks/github-pr`  → `…/api/plugins/<id>/webhooks/github-pr`
- **`cloudflare-qa-webhook.tf`** Access apps now **wildcard the id segment**
  (`/api/plugins/*/webhooks/…`) instead of embedding the literal id.

**Result:** the plugin id survives in exactly **one** place — the rewrite `value`
targets in `cloudflare-webhook-alias.tf` (two lines), still covered by the #506
id-drift deploy-gate + dead-man probe. The GitHub App URL and every Access path are
now id-free.

### Why this ordering works

> **⚠️ CORRECTION (2026-08-14, verified live after the #550 apply).** The original
> assumption below — that URL Rewrite (`http_request_transform`) runs *before* Access
> so Access sees the rewritten `/api/plugins/<id>/…` path — is **empirically false**.
> Cloudflare **Access matches its applications on the ORIGINAL incoming path** (it
> builds the login redirect from the URL the client requested). Proof: after applying
> #550, a POST to the id-free alias `/api/gh-webhooks/github-app` still **302'd to the
> Access login** (`goldberrygrove.cloudflareaccess.com/.../login`, `redirect_url=
> /api/gh-webhooks/github-app`), while the literal `/api/plugins/f46075f1…/webhooks/
> github-app` returned **502** (Access bypassed → plugin rejects the unsigned ping).
> The rewrite only rewrites the **origin-bound** path; it does not change what Access
> matches. The wildcarded `/api/plugins/*/webhooks/…` bypass apps therefore cover only
> the **literal-path** App URL (still in use, so inbound stays healthy) — they do **not**
> cover the alias. **Fix (this branch): id-free bypass Access apps scoped to the alias
> paths `/api/gh-webhooks/github-app` and `/api/gh-webhooks/github-pr`** (see
> `cloudflare-webhook-alias.tf`). Access then lets the alias POST through on the
> original path; the Transform Rule still rewrites it to the plugin path for the
> origin. Do **not** perform Step 3 (App-URL cutover) until those bypass apps are
> applied and Step 2 shows a non-Access response on the alias.

Cloudflare Access precedence is by **path specificity** (most-specific path wins,
whether broader matches are exact or wildcard), so the deep `/api/gh-webhooks/github-*`
alias bypass apps win over the host-wide `paperclip` SSO app.

## Rollout is additive and reversible

Applying the Terraform changes nothing for the **current** GitHub App URL: it still
targets the literal `…/api/plugins/<id>/webhooks/…` path, which no rewrite touches and
the now-wildcarded Access apps still cover. The App-URL flip to `/api/gh-webhooks/*`
happens **only after** the edge is verified below. Rollback at any point = flip the
App URL back to the literal path; it never stopped working.

## Step 1 — Apply the Terraform (⚠️ production edge change — needs approval)

This touches the **production** `gatheringatthegrove.com` Cloudflare zone (a new
zone-level `http_request_transform` entrypoint ruleset + three Access-app path edits).
Per DevOps policy, get **CEO/board approval** before `apply`, and run `plan` first.

```bash
cd infra/terraform
terraform plan   -out=gol1416.plan          # review: 1 ruleset added, 3 Access apps' domain changed
terraform apply  gol1416.plan
```

Expected plan: `cloudflare_ruleset.webhook_alias` **created**; the three
`cloudflare_zero_trust_access_application.*` **updated in place** (domain only).
No `destroy`.

> **409 "ruleset already exists" for `http_request_transform`:** an entrypoint ruleset
> was created out-of-band. Import it and fold these rules in rather than creating a
> second — Cloudflare allows only ONE entrypoint ruleset per (zone, phase):
> `terraform import cloudflare_ruleset.webhook_alias zone/<zone_id>/<ruleset_id>`

## Step 2 — Verify the edge BEFORE cutting the App URL

A **non-Access** response (e.g. `400`/`401` from the plugin's HMAC check) proves both
the rewrite **and** the Access bypass fired. A `302`-to-Google or `403` `cf-access`
means the wiring is wrong — **do NOT cut over**; investigate.

```bash
# id-free alias path — must NOT return 302/403-cf-access
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  https://paperclip.gatheringatthegrove.com/api/gh-webhooks/github-app \
  -H 'X-GitHub-Event: ping' -d '{}'

curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  https://paperclip.gatheringatthegrove.com/api/gh-webhooks/github-pr \
  -H 'X-GitHub-Event: ping' -d '{}'
```

Convenience: the exact URLs are Terraform outputs —
`terraform output github_app_webhook_alias_url` / `github_pr_webhook_alias_url`.

## Step 3 — Cut the GitHub App webhook URL over to the alias

In the GitHub App settings (the App that delivers issue/PR events into github-sync),
set the **Webhook URL** to the id-free alias:

```
https://paperclip.gatheringatthegrove.com/api/gh-webhooks/github-app
```

(If `pull_request` is delivered to a distinct URL, use the `…/github-pr` alias.)
Save, then use GitHub's **"Redeliver"** on a recent ping/issue delivery and confirm a
`2xx`. Watch the github-sync worker logs / a live issue mirror to confirm a real
inbound event lands.

## Step 4 — Confirm and close

- A test issue event mirrors through end-to-end (github-sync creates/updates a mirror).
- The #506 inbound dead-man probe stays green.
- No `302`/`403 cf-access` in the App's recent deliveries tab.

## Rollback

1. **Fastest:** set the GitHub App webhook URL back to the literal path
   `https://paperclip.gatheringatthegrove.com/api/plugins/<id>/webhooks/github-app`.
   The literal path + wildcarded Access apps never stopped working.
2. If the Access-app wildcard edits are implicated, `terraform apply` a revert of
   `cloudflare-qa-webhook.tf` (restore the literal-id `domain` fields) — but note the
   App URL must then point at the literal path too.
3. The alias ruleset is inert once the App URL is off `/api/gh-webhooks/*`; it can be
   left in place or removed with `terraform destroy -target=cloudflare_ruleset.webhook_alias`.

## Post-rotation note (why this was worth doing)

After cutover, a legitimate plugin-id rotation (delete+reinstall) touches exactly ONE
place: `var.github_sync_plugin_id` (the two rewrite targets in
`cloudflare-webhook-alias.tf`). `terraform apply` re-points the rewrite; the GitHub App
URL and the wildcarded Access apps need **no** change. The #506 id-drift deploy-gate +
inbound dead-man probe still guard that single reference.
