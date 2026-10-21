# CI SSH through the agent-plane fence (GOL-3412)

**Status:** live on merge. No new repo secret; the only credential involved is
the one CI already holds (`OP_SERVICE_ACCOUNT_TOKEN`).

## What broke

On 2026-10-15 ~09:03Z `grove-agent-plane-fw` was attached to `agenticos-droplet`
(odoocker `infra/terraform/environments/production/agent-plane-fw.tf`, GOL-2569,
made permanent by GOL-3392 / odoocker PR #904). It admits tcp/22 on the droplet's
public address **only from `admin_ip_cidrs`** (two operator IPs). That is the
intended steady state for a box holding the DO token, the broker key and the
Paperclip key.

The fence missed one inbound consumer: ten AgenticOS workflows SSH in as
`deploy@$DROPLET_HOST` from **GitHub-hosted runners**, which egress from ~7,000
rotating Azure CIDRs (`api.github.com/meta` → `actions`). None are admitted, so
`Configure SSH` timed out 5× with empty stderr ("No host key from the droplet
after 5 attempts") on every run since the fence:

| workflow | trigger | first red |
|---|---|---|
| Droplet Disk Reclaim | daily | 2026-10-15 (#892) |
| Inbound webhook dead-man probe | hourly | 2026-10-15 |
| OTel Collector Diagnostics | dispatch | 2026-10-15 |
| Deploy Droplet Plugins ×2, Deploy Droplet (cancelled by the shared lock) | push to `main` | 2026-10-21 |
| Deploy Host Scripts, Deploy / Recreate paperclip-server, Company skill audit, Restart forensics | push / dispatch | next trigger |

## How it works now

`.github/actions/configure-ssh` takes an optional `op-service-account-token`.
When set, before the keyscan it calls `.github/actions/agent-plane-fence` with
`mode: admit`, which:

1. reads the DigitalOcean token from 1Password at run time
   (`op://Goldberry Grove - Admin/Grove Infra/do_token`), masks it, keeps it in
   the step environment only (GOL-313 pattern, same as `resize-droplet.yml`);
2. finds (or on first use **creates**) `grove-agent-plane-ci-fw`, a second DO
   cloud firewall attached to `agenticos-droplet` with no inbound rules and the
   same wide-open outbound as the main fence;
3. adds `<runner public ip>/32 → tcp/22` to **that** firewall, waits for DO to
   report it applied, probes `$DROPLET_HOST:22`, and exports
   `AGENT_PLANE_CI_FW_ID` / `AGENT_PLANE_CI_RUNNER_CIDR` to the job env.

Every caller ends with an `if: always()` step that runs the same action with
`mode: revoke`, which deletes exactly that rule and verifies it is gone. With
nothing recorded (the job failed before admit, or the input was empty) revoke
is a no-op.

DO **unions** every firewall attached to a droplet, so the runner is admitted
while `grove-agent-plane-fw` is untouched: no Terraform drift on the managed
fence, and anything a killed runner leaves behind is confined to a firewall
whose name says who owns it. The admit step warns when the CI firewall already
carries 5+ rules (stray /32s).

### Why not the alternatives

- **Static allow-list of GitHub's ranges** — 7,038 CIDRs today, rotating; far
  over a DO rule's source limit, and it would re-open :22 to every Actions
  tenant.
- **Ephemeral rule on `grove-agent-plane-fw` itself** — Terraform owns that
  resource; a rule CI adds shows as drift on every plan during a job and is
  reverted by any apply mid-deploy.
- **Tailnet (#893, option B on GOL-3412)** — cleanest network story, but needs a
  new Tailscale OAuth client, an ACL edit and three new repo secrets, all
  console steps. This path ships with zero new credentials; the two are not
  exclusive, and #893 can land later on top of it.
- **Self-hosted runner on the box** — the repo is public; GitHub advises against
  self-hosted runners on public repos.

## Credential exposure (honest accounting)

`do_token` is the account-wide DigitalOcean token. CI already holds
`OP_SERVICE_ACCOUNT_TOKEN`, whose service account can read that vault item, so
reading it at run time adds **no** reach CI did not already have. To tighten,
mint a token scoped to `firewall:read` + `firewall:update` (+ `firewall:create`
until the firewall is codified), store it on the same 1Password item, and change
the `do-token-ref` default in `.github/actions/agent-plane-fence/action.yml`.
Nothing else changes.

Side finding during this incident: `do_token_scoped` on the same 1Password item
(consumed by `resize-droplet.yml`) answers **401** on every endpoint — it is
revoked or expired, and that workflow is silently broken. Tracked separately.

## Follow-up: codify the CI firewall (odoocker)

`grove-agent-plane-ci-fw` is created by the first admit, out of band. Codify it
in `odoocker-goldberrygrove/infra/terraform/environments/production/agent-plane-fw.tf`
as `digitalocean_firewall.agent_plane_ci` with an `import` block for its id,
`droplet_ids = [data.digitalocean_droplet.agent_plane[0].id]`, the same three
outbound rules, **no** inbound rules, and
`lifecycle { ignore_changes = [inbound_rule] }` so CI's transient /32s never
plan as drift. The nightly membership check then covers it like the others.

## Verify

Dispatch a read-only caller and read the `Configure SSH` step:

```bash
gh workflow run otel-collector-diag.yml --repo Goldberry-Playground/AgenticOS
```

Expected: `Admitting <ip>/32 on tcp/22 via grove-agent-plane-ci-fw`,
`tcp/22 on <host> reachable from this runner`, `Host key pinned on attempt 1/5`,
and at the end `Revoked.`

Local dry run of the script against the real account, with a non-routable
TEST-NET address so nothing is actually admitted:

```bash
export DO_TOKEN="$(op read 'op://Goldberry Grove - Admin/Grove Infra/do_token')" RUNNER_CIDR=192.0.2.1/32 GITHUB_ENV=/tmp/fence.env && bash .github/actions/agent-plane-fence/fence.sh admit && set -a && . /tmp/fence.env && set +a && bash .github/actions/agent-plane-fence/fence.sh revoke
```

## Rollback

Drop the `op-service-account-token:` line from a caller and it is the legacy
keyscan-only path (which times out against the fence). Deleting
`grove-agent-plane-ci-fw` in the DO console removes every CI admission at once;
the next admit recreates it empty.

## Related

- GOL-2569 (`agent-plane-fw.tf`, odoocker `docs/RUNBOOK-agent-plane-firewall-GOL-2569.md`)
- GOL-3392 (fence made permanent, odoocker PR #904)
- GOL-3412 / #892 (Droplet Disk Reclaim RED 2026-10-15), #893 (tailnet alternative)
