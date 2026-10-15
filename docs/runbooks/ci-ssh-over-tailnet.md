# CI SSH to the agent plane over the tailnet (GOL-3412)

**Status: code shipped, inert until the three secrets below exist.** Until then
every workflow that uses `.github/actions/configure-ssh` fails in `Configure SSH`
with `No host key from the droplet after 5 attempts`.

## Why

On 2026-10-15 ~09:03Z `grove-agent-plane-fw` (GOL-2569 / GOL-3392, Terraform in
`odoocker-goldberrygrove/infra/terraform/environments/production/agent-plane-fw.tf`)
was attached to `agenticos-droplet`. It admits tcp/22 on the droplet's public
address **only from `admin_ip_cidrs`**. That is the intended steady state: the
box holds the DO token, the broker key and the Paperclip key, and its public
:22 should not be reachable from the internet.

The fence design missed one inbound consumer: ten AgenticOS workflows SSH in as
`deploy@$DROPLET_HOST` from **GitHub-hosted runners**, which egress from ~7,000
Azure CIDRs (`api.github.com/meta` → `actions`). None of those are in
`admin_ip_cidrs`, so the keyscan and the ssh both time out.

| affected workflow | trigger |
|---|---|
| Deploy Droplet, Deploy Droplet Plugins, Deploy Host Scripts | push to `main` |
| Deploy paperclip-server, Recreate paperclip-server | `repository_dispatch` (agent-triggered deploys) |
| Inbound webhook dead-man probe | hourly + daily |
| Droplet Disk Reclaim | daily + dispatch |
| Company skill audit, OTel Collector Diagnostics, Paperclip Restart Forensics | weekly / dispatch |

## Why the tailnet and not a firewall hole

- **Static allow-list**: impossible — DO cloud firewalls cap rules well below
  7,000 sources, and the ranges rotate.
- **Ephemeral per-job rule** (add the runner's /32 via the DO API, remove it
  after): needs a firewall-mutating DO token in Actions secrets on the very box
  the fence protects, creates Terraform drift on a managed resource during every
  job (`prod-plan-guard` / nightly drift false positives), leaks a stray /32
  whenever a runner dies (composite actions have no `post:` step), and races
  when two jobs share a NAT egress IP.
- **Tailnet** (chosen): the runner joins as an **ephemeral `tag:ci` node** via
  `tailscale/github-action` and SSHes to the droplet's tailnet address. The
  public fence is untouched, no DO credential enters CI, nothing drifts, nothing
  leaks (ephemeral nodes are removed on job end), and the ACL grant is the
  single place the reach of CI is written down. The same action can later serve
  the odoocker provisioning workflows, which have the identical gap against
  `grove-prod-odoo-fw`.

## One-time setup (Josh — admin-console steps an agent cannot do)

1. **Confirm the droplet is on the tailnet and note its address.** On the box:
   `tailscale ip -4` (expect `100.x.y.z`) and `tailscale status`. If
   `tailscaled` is not running there, this path cannot work — say so on
   GOL-3412 and we fall back to option A.
2. **ACL** (Tailscale admin console → Access controls). Add the tag and the
   grant. With `agenticos-droplet` tagged `tag:agent-plane` (preferred; or use
   its tailnet IP as the `dst`):

   ```jsonc
   "tagOwners": {
     "tag:ci":          ["autogroup:admin"],
     "tag:agent-plane": ["autogroup:admin"],
   },
   "grants": [
     { "src": ["tag:ci"], "dst": ["tag:agent-plane"], "ip": ["tcp:22"] },
   ],
   ```

   `tag:ci` must own nothing else; it is the whole reach of CI.
3. **OAuth client** (admin console → Settings → OAuth clients → Generate):
   scope **`auth_keys` (write)**, tag **`tag:ci`**. Copy the client id and
   secret.
4. **Secrets.** Put the three values into 1Password → `Goldberry Grove - Admin`
   → `AgenticOS Infra` as `ts_oauth_client_id`, `ts_oauth_secret`,
   `droplet_tailnet_host`, then either add them to the AgenticOS repo yourself
   or comment on GOL-3412 — Terra can deliver repo secrets from 1Password:

   | repo secret | value |
   |---|---|
   | `TS_OAUTH_CLIENT_ID` | OAuth client id |
   | `TS_OAUTH_SECRET` | OAuth client secret |
   | `DROPLET_TAILNET_HOST` | the droplet's `100.x.y.z` (or MagicDNS name) |

   `DROPLET_HOST` stays the public IP: the action aliases it to the tailnet
   address in `~/.ssh/config`, so no workflow's `ssh "$USER@$HOST"` changes.
5. **Verify**: `gh workflow run disk-reclaim.yml` — a manual dispatch always
   prunes, so prefer `gh workflow run inbound-webhook-deadman.yml` for a
   read-only proof. The `Configure SSH` step should print
   `Routing ssh to … over the tailnet` and `Host key pinned on attempt 1/5`.
6. **Host firewall sanity**: `sudo ufw status` on the droplet must allow 22/tcp
   from the tailnet (it allowed it from anywhere before the cloud fence, so no
   change is expected). The DO fence blocks inbound UDP 41641, so direct
   Tailscale paths may fall back to DERP relays — fine for SSH.

## Rollback

Delete the three repo secrets. The action is byte-for-byte the previous
behaviour when any of them is empty (and then fails exactly as before, because
the public :22 is fenced). Revoking the OAuth client in the admin console cuts
CI off instantly without touching the repo.

## Related

- GOL-2569 (`agent-plane-fw.tf`, runbook `RUNBOOK-agent-plane-firewall-GOL-2569.md` in odoocker)
- GOL-3392 (defaults → `true`, odoocker PR #904)
- GOL-3412 (this incident: Droplet Disk Reclaim RED 2026-10-15)
