# AgenticOS Infrastructure (Terraform + cloud-init)

This directory provisions the AgenticOS Foundation v2 MVP infrastructure end-to-end.
After a successful `terraform apply`, one manual step remains: SSH to the Droplet and
authenticate Paperclip's agent backends (the primary `claude_local` adapter logs in to a
Claude Max subscription; Codex/Ollama are optional) — see
"[The remaining manual step](#the-remaining-manual-step--agent-backend-auth)" below.

## What gets provisioned

- **DigitalOcean**
  - VPC `agenticos-vpc` (region `nyc1` by default)
  - SSH key `agenticos-droplet-key`
  - Droplet `agenticos-droplet` (Ubuntu 24.04, `s-2vcpu-4gb`, in the VPC)
  - App Platform app `agenticos-dashboard` tracking `EngineeringMoonBear/AgenticOS@main`
- **Tailscale**
  - Pre-authorized, single-use auth key tagged `tag:agenticos-droplet`
  - Droplet joins the tailnet automatically via cloud-init
- **Cloudflare**
  - Proxied A record `agenticos.gatheringatthegrove.com`
  - Zero Trust Access application + "Allow Josh" policy gating the hostname behind Google SSO
- **Droplet (via cloud-init)**
  - Hardened SSH, UFW baseline, unattended-upgrades, fail2ban
  - Docker Engine + Compose
  - Tailscale (joined with auth key, no browser interaction)
  - Syncthing (user-service for `deploy`, GUI exposed only on `tailscale0`)
  - Node 22, pnpm 9.15.4, OpenAI Codex CLI (the `codex_local` adapter can import the CLI's OAuth credentials from `~/.codex/auth.json` if present)
  - Filesystem layout: `/opt/agenticos/repo`, `/opt/vault`, `/opt/backups`, `/etc/agenticos`
  - Repo cloned to `/opt/agenticos/repo`
  - AgenticOS docker-compose stack started if `docker-compose.yml` exists in the repo. Services: Postgres (`agenticos-db`), Ollama, OpenViking (`:1933`, agent memory), vault-server (`:7779 → 7777`, human Obsidian vault API), **paperclip-server** (the Paperclip agent runtime + heartbeat scheduler + adapters), and **cloudflared** (tunnel publishing the Paperclip board UI behind Cloudflare Access). The VPC-bound services (Postgres `:5432`, OpenViking `:1933`, vault-server `:7779`) are gated by UFW to `10.116.16.0/20` — see "UFW rules for VPC-bound services" below.
  - Scheduled work (PR-triage, vault-ingest, digests) runs as **Paperclip routines** via the heartbeat scheduler — not host cron.

## Deploys

Two independent surfaces, two deploy paths:

- **Dashboard (App Platform)** — auto-deploys on every push to `main`. No action needed.
- **Droplet services (vault-server)** — auto-deployed by `.github/workflows/deploy-droplet.yml`.
  It triggers on push to `main` when `infra/vault-server/**`, `packages/vault-core/**`,
  or the root `docker-compose.yml` change. The workflow SSHes to the Droplet with a
  dedicated deploy key (`DROPLET_SSH_KEY` secret), ships the committed tree via
  `git archive | ssh tar` (additive — preserves Droplet-only files like `.env`),
  rebuilds + restarts the changed service, and runs a `/health` check against the VPC
  endpoint `10.116.16.2:7779`. Manual run: `gh workflow run deploy-droplet.yml`.

  Required GitHub secrets: `DROPLET_SSH_KEY` (private deploy key), `DROPLET_HOST`,
  `DROPLET_USER`. The deploy key is a dedicated, passwordless ed25519 key whose public
  half is in the Droplet's `deploy@` `authorized_keys` — separate from the operator's
  interactive key.

## Cost

- Droplet `s-2vcpu-4gb`: **$24/mo**
- App Platform `professional-xs`, horizontal autoscale 1–3 instances @70% CPU (GOL-256, board decision D1): **~$29/mo floor → up to ~$87/mo** at 3 instances under sustained load
- Tailscale free tier, Cloudflare Access free tier, Syncthing free → **$0/mo**
- **Total: ~$53/mo floor** (up to ~$111/mo under sustained dashboard load)

## Prerequisites

### 1. Install tooling

```bash
brew install terraform doctl   # doctl is optional, useful for CLI checks
terraform version              # require >= 1.6
```

### 2. Generate the SSH key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agenticos-droplet -C "agenticos-droplet"
```

### 3. Create three API tokens

**DigitalOcean** (DO Console → API → Tokens → Generate New Token):
- Scopes: full read+write
- Save as `do_token`

**Tailscale**:
- API key: <https://login.tailscale.com/admin/settings/keys> → Generate API key.
  Scope: `auth_keys:write`. Save as `tailscale_api_key`.
- Tailnet identifier (save as `tailscale_tailnet`): use one of:
  - **Your tailnet name** (recommended) — the domain-style or email-shaped string
    Tailscale assigned. For Goldberry Grove that's `goldberrygrove.farm`.
    Find it at <https://login.tailscale.com/admin/general> under "Tailnet name"
    (NOT "Tailnet ID" — that's a different value the REST API does not accept
    in URL paths, despite what the concepts doc implies).
  - **Literal `-`** — wildcard meaning "the tailnet of the API key." Works
    universally; less explicit in logs.
  - Verify either value works by running `bash infra/scripts/check-auth.sh`.

**Cloudflare** (Profile → API Tokens → Create Token → Custom token):
- Permissions:
  - Zone → DNS → Edit (on `gatheringatthegrove.com`)
  - Account → Access: Apps and Policies → Edit
- Save as `cloudflare_api_token`
- From the zone Overview page sidebar, copy the **Zone ID** and **Account ID**

### 3a. Store the tokens — pick ONE path

#### Path A: 1Password CLI (recommended)

The tokens live as a single 1Password item (`AgenticOS Infra`). Nothing on disk in plaintext; `terraform apply` reads them at runtime via `op read`.

```bash
# One-time setup
brew install --cask 1password-cli   # if not already installed
op signin                            # or biometric-unlock the app

# Create the item with placeholder fields
bash infra/scripts/setup-secrets-1password.sh

# Fill in real values — either via the 1Password app or via CLI:
op item edit "AgenticOS Infra" --vault "Goldberry Grove - Admin" \
    do_token="dop_v1_..." \
    tailscale_api_key="tskey-api-..." \
    tailscale_tailnet="goldberrygrove.farm" \
    cloudflare_api_token="..." \
    cloudflare_zone_id="..." \
    cloudflare_account_id="..."

# Verify the loader picks them up
source infra/scripts/load-secrets.sh
# Expected: "✓ Loaded AgenticOS infra secrets from 1Password (vault: Goldberry Grove - Admin)"
```

Default vault is `Goldberry Grove - Admin`. To use a different one: `export AGENTICOS_OP_VAULT="My Vault"` before running.

#### Path B: plaintext `.env` fallback

Use this only if 1Password CLI isn't an option (CI runner, fresh VM).

```bash
mkdir -p ~/.config/agenticos
cp infra/secrets.env.example ~/.config/agenticos/infra.env
chmod 600 ~/.config/agenticos/infra.env
# edit ~/.config/agenticos/infra.env with real values

# Verify the loader picks them up
source infra/scripts/load-secrets.sh
# Expected: "✓ Loaded AgenticOS infra secrets from /Users/.../.config/agenticos/infra.env"
```

The loader refuses to load this file if its permissions are not `600` or `400`.

#### Ergonomic glue: direnv (optional but nice)

```bash
brew install direnv
# Add to ~/.zshrc or ~/.bashrc: eval "$(direnv hook zsh)"  (or bash)

cd infra/terraform
direnv allow            # one-time approval
# From now on, cd-ing into infra/terraform auto-loads secrets via .envrc
```

Without direnv, you'll `source infra/scripts/load-secrets.sh` once per shell session before running `terraform`.

### 4. One-time Cloudflare prep (manual, can't be Terraformed)

Configure Google as an Identity Provider in Cloudflare Zero Trust. This is
a two-system setup (Google Cloud creates the OAuth client, Cloudflare uses it).

**4a. Find your Cloudflare team domain** (needed for the OAuth callback URL):
1. <https://dash.cloudflare.com/> → **Zero Trust** in the left sidebar
2. **Settings** (bottom of left sidebar) → **Team name and domain**
3. Your team domain is `<team-name>.cloudflareaccess.com`
4. The OAuth callback URL is `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`

**4b. Create a Google OAuth Client** (<https://console.cloud.google.com>):
1. Create or select a project (e.g., `AgenticOS Auth`)
2. **APIs & Services** → **OAuth consent screen**:
   - User type: **Internal** (if you have Google Workspace — recommended) or **External**
   - Fill in app name (`AgenticOS via Cloudflare`), support email, developer email
   - Default scopes are fine
3. **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth client ID**:
   - Application type: **Web application**
   - Name: `Cloudflare Zero Trust Access`
   - Authorized redirect URIs: paste the callback URL from §4a
4. Copy the **Client ID** and **Client Secret** that pop up

**4c. Add Google IdP in Cloudflare:**
1. <https://dash.cloudflare.com/> → **Zero Trust** → **Integrations** → **Identity providers**
2. **Add new identity provider** → select **Google**
3. Fill in:
   - **Name**: `Google` (exact, capital G — the Terraform `data` block looks it up by name)
   - **App ID**: paste Google Client ID
   - **Client secret**: paste Google Client Secret
4. **Save**
5. Test via the `…` menu on the new IdP row → "Test" → sign in with `josh@goldberrygrove.farm`

Docs: <https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/>

### 5. One-time Tailscale prep (manual)

Edit your tailnet ACL (admin console → Access Controls) and ensure the `tagOwners`
block includes:

```jsonc
"tagOwners": {
  "tag:agenticos-droplet": ["autogroup:admin"]
}
```

Save. Without this, `terraform apply` will fail with `tag not allowed`.

## Apply

If you set up secrets via Path A (1Password) or Path B (`.env`), Terraform reads them from `TF_VAR_*` env vars — no `terraform.tfvars` file needed.

```bash
cd infra/terraform

# Load secrets (skip this line if direnv is set up — it loads automatically)
source ../scripts/load-secrets.sh

terraform init
terraform plan      # review
terraform apply     # ~3-5 minutes; Droplet cloud-init continues for another ~3-5 min after
```

If you'd rather use a `terraform.tfvars` file (less secure — plaintext on disk):

```bash
cp terraform.tfvars.example terraform.tfvars
chmod 600 terraform.tfvars
# edit with values
terraform apply
```

`terraform.tfvars` is gitignored so it won't accidentally land in the repo.

Watch the Droplet finish bootstrapping:

```bash
ssh -i ~/.ssh/agenticos-droplet root@$(terraform output -raw droplet_public_ip) \
  'tail -f /var/log/cloud-init-output.log'
```

When you see `AgenticOS Droplet bootstrap complete.`, you're done with the automation.

## The remaining manual step — agent backend auth

The Droplet boots with the docker-compose stack running, but Paperclip's local agent
adapters need their CLI sessions authenticated. Terraform deliberately keeps these
credentials out of state. Full detail: [`docs/runbooks/paperclip-agent-backends.md`](../docs/runbooks/paperclip-agent-backends.md).

### Claude (`claude_local`, primary) — Max subscription, no API key

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@$(terraform output -raw droplet_public_ip)
cd /opt/agenticos

# Log in as the node user (the uid agents run as); creds persist on the
# paperclip-data volume via CLAUDE_CONFIG_DIR, so this is one-time.
docker compose exec -u node -it paperclip-server claude /login
# follow the device-code URL, sign in with your Claude Max account
```

There must be **no `ANTHROPIC_API_KEY`** in `/opt/agenticos/.env` — it would override the
subscription OAuth and silently switch Claude agents to per-token API billing. (For
deliberate per-agent API billing, set the key in Paperclip Secrets, not the env.)

### Codex (`codex_local`) — ChatGPT OAuth or API key

Uses the OpenAI Codex CLI: either OAuth via a ChatGPT Pro/Plus account, or `OPENAI_API_KEY`
in `/opt/agenticos/.env` (1Password → `AgenticOS Infra` → `openai_api_key`). Cloud-init
imports `~/.codex/auth.json` if present.

### Ollama (`opencode_local`) — local, free

```bash
docker compose exec ollama ollama pull qwen2.5-coder:7b   # or your pick
```

Then create an `opencode_local` agent with `model: ollama/<model>` and
`env: { OLLAMA_HOST: http://ollama:11434 }`.

### GitHub — agents push / open PRs via the "AgenticOS Developer" GitHub App

Per-org, repo-scoped installation tokens are minted by a git credential helper from the App
private key (`GITHUB_APP_PRIVATE_KEY_B64` in `/opt/agenticos/.env`). See
[`docs/agent-house-rules.md`](../docs/agent-house-rules.md) and `scripts/agent-git/`.

> **Hermes (`hermes_local`)** is a registered but **optional** adapter — not provisioned by
> default (no `hermes` CLI is installed). Use it only if you deliberately add the Hermes
> runtime for a specific persona; it is an agent backend Paperclip can dispatch to, not the
> orchestrator.

## Verify

```bash
# Dashboard gate
curl -I https://agenticos.gatheringatthegrove.com
# Expected: 302 to a Cloudflare Access login page

# Browser
open https://agenticos.gatheringatthegrove.com
# Expected: Google SSO prompt → only josh@goldberrygrove.farm allowed
```

## What Terraform can NOT do (manual one-time steps)

1. **Cloudflare Google IdP setup** — prereq §4 above. OAuth credentials require interactive consent.
2. **Tailscale tagOwners ACL** — prereq §5 above. The Tailscale provider doesn't manage ACLs.
3. **Agent backend auth** — kept out of Terraform state on purpose (subscription auth tokens and API secrets are long-running risks if persisted there). Log in the `claude_local` adapter to Claude Max (`docker compose exec -u node -it paperclip-server claude /login`), and optionally seed `OPENAI_API_KEY` into `/opt/agenticos/.env` for `codex_local`. See "The remaining manual step" above.
4. **Syncthing pairing on Mac** — needs interactive device-ID exchange.
5. **UFW rules for VPC-bound services** — the docker-compose stack binds
   Postgres (5432), OpenViking (1933), and vault-server (7779) on the
   agenticos VPC interface (`10.116.16.2`) so App Platform can reach them.
   UFW can't be set by Terraform on a running Droplet. Run once on the
   Droplet after the stack is up:
   ```bash
   sudo ufw allow from 10.116.16.0/20 to any port 5432 proto tcp comment 'Postgres from VPC'
   sudo ufw allow from 10.116.16.0/20 to any port 1933 proto tcp comment 'OpenViking from VPC'
   sudo ufw allow from 10.116.16.0/20 to any port 7779 proto tcp comment 'vault-server from VPC'
   sudo ufw status verbose | grep -E '5432|1933|7779'
   ```
   The VPC is private (`10.116.16.0/20`); these rules are defense-in-depth, not
   the only thing keeping the ports off the public internet.

(App Platform VPC attachment was previously manual but is now automated via
`digitalocean_app.spec.vpc.id` in `app-platform.tf` — DO provider 2.5x+ supports it.)

## Destroy

```bash
terraform destroy
```

⚠️ This will delete the Droplet and **its Docker volumes** (Postgres task ledger + cost rows, Ollama model cache). The vault on `/opt/vault` is also lost unless it has been Syncthing-replicated to the Mac.

Before destroying, pull the latest dump off-box (see "Backups" below), or take a fresh one on demand:

```bash
ssh deploy@$(terraform output -raw droplet_public_ip) \
  'docker compose -f /opt/agenticos/docker-compose.yml exec -T agenticos-db pg_dump -U agenticos agenticos' \
  > /tmp/agenticos-backup.sql
```

Memory itself lives in the vault as markdown, so as long as Syncthing has replicated `/opt/vault` to your Mac, the agent's accumulated knowledge survives the rebuild.

## Backups

> Full disaster-recovery plan for all three stores (vault, Postgres, OpenViking)
> — posture, procedures, restore drills — lives in
> [`docs/runbooks/backup-and-recovery.md`](../docs/runbooks/backup-and-recovery.md).
> This section covers the two automated dump timers.

Two systemd timers dump to `/opt/backups` nightly, each with a 14-item
retention window:

- **Postgres** — `infra/scripts/pg-backup.sh` `pg_dump`s the `agenticos` DB
  (cost rows + task/session ledger) from `agenticos-db`, gzip →
  `/opt/backups/agenticos-<UTC>.sql.gz`. `agenticos-pg-backup.timer`, daily
  **04:00**. `pipefail` + min-size + atomic `mv` so a failed dump never
  overwrites a good one.
- **OpenViking** — `infra/scripts/viking-backup.sh` calls the native
  `POST /api/v1/pack/backup` (`include_vectors:false`) and saves the streamed
  `.ovpack` ZIP → `/opt/backups/openviking-<UTC>.ovpack`.
  `agenticos-viking-backup.timer`, daily **04:30**. Integrity gates: HTTP-200,
  min-size, `PK` ZIP magic, and `unzip -t` CRC check.

Fresh Droplets get the timer from cloud-init. The `.service` / `.timer` bodies
live inline in the cloud-init template (single source of truth — same pattern as
the curator units). Installing the units needs **root** — on a running box the
`deploy` user can't write `/etc/systemd/system` (its sudo is `NOPASSWD` only for
`systemctl`/`ufw`, and the account password is locked). Get root via the
DigitalOcean web **Console**, or `ssh root@$DROPLET` (your Terraform SSH key is
on root). Then a one-liner does it:

```bash
# 1. Refresh the repo clone so the scripts are present (as deploy)
ssh deploy@$DROPLET 'cd /opt/agenticos/repo && git fetch origin && git checkout -B main origin/main'

# 2. As ROOT (console or ssh root@): install + enable both timers
bash /opt/agenticos/repo/infra/scripts/install-backup-timers.sh

# 3. Smoke-test as deploy (not root)
ssh deploy@$DROPLET '/opt/agenticos/repo/infra/scripts/pg-backup.sh && \
  /opt/agenticos/repo/infra/scripts/viking-backup.sh && ls -lh /opt/backups'
```

`install-backup-timers.sh` is idempotent (writes the four units, reloads,
enables) and keeps its unit definitions in sync with the inline copies in the
cloud-init template — fresh Droplets still get the units from cloud-init so a
provision never depends on the repo clone.

**Scope:** this protects against volume corruption, a bad migration, or an
accidental `docker compose down -v`. It is **on-box only** — surviving total
Droplet loss requires copying `/opt/backups` off the Droplet. The $0 path
(matching the no-paid-services rule) is to add `/opt/backups` to the existing
Syncthing share so dumps replicate to the Mac alongside the vault; that needs an
interactive Syncthing folder-add (operator step) and is the natural next
increment.

**Restore:**

```bash
gunzip < agenticos-<UTC>.sql.gz | \
  ssh deploy@$DROPLET 'docker compose -f /opt/agenticos/docker-compose.yml exec -T agenticos-db psql -U agenticos agenticos'
```

## Disk hygiene (GOL-131)

> Reclaim policy for the host-side accretion that filled the 77G Droplet to
> 87-89% (GOL-124). ~57G lived under `/var/lib/docker` — old image layers and
> BuildKit cache left behind by every CI `docker compose up -d --build`, with
> nothing reclaiming it.

Codified as host units (single source of truth: inline in the cloud-init
template, mirrored by `infra/scripts/install-disk-hygiene.sh` for running boxes
— same pattern as the backup timers):

- **Docker reclaim** — `infra/scripts/docker-prune.sh` runs
  `docker system prune -af` + `docker builder prune -af` (running containers +
  in-use images kept; **never `--volumes`** — named volumes hold live Postgres /
  OpenViking / vault state). `agenticos-docker-prune.timer`, weekly **Sun 02:30**.
- **disk-guard** — `infra/scripts/disk-guard.sh` checks root FS daily
  (`agenticos-disk-guard.timer`, **05:00**); at ≥80% it posts to the Discord ops
  webhook (`DISCORD_OPS_WEBHOOK_URL` in `/opt/agenticos/.env`) and runs the
  reclaim, catching disk pressure before the DO monitor fires at 85%. Runs as a
  host timer because in-container Paperclip agents can't read host disk or reach
  the host Docker socket.
- **paperclip-volume-guard** (GOL-1632) — `paperclip-volume-guard.sh`
  (`agenticos-paperclip-volume-guard.timer`, **hourly at :20**). disk-guard
  watches only the root FS; the `paperclip-data` docker volume (hourly DB dumps +
  `server.log`) is a **separate** filesystem, so its fill is invisible to it —
  exactly how the 2026-08-18 disk-full P0 hit 100% with no early warning. This
  guard checks that volume's headroom (≥80% → Discord) **and** backup freshness
  (newest completed `*.sql.gz` older than ~95m → Discord), the latter being the
  compensating control for silent backup failure until the server-side
  loud-failure + retention fix ships (in `/opt/paperclip`, out of this repo's
  write boundary). Alerts are throttled per reason (~6h) so a sustained
  condition doesn't spam. It never auto-deletes dumps — that volume holds live
  state; pruning is the Paperclip server's retention job.
- **journald cap** — `/etc/systemd/journald.conf.d/10-agenticos-cap.conf` sets
  `SystemMaxUse=200M` (+ per-file / retention ceilings); cloud-init also runs
  `journalctl --vacuum-size=200M` once to apply it immediately.
- **logrotate** — `/etc/logrotate.d/agenticos` rotates `/var/log/agenticos/*.log`,
  the Docker container `*-json.log` files (compose sets no per-container log
  limit in this deployment), and the paperclip `server.log` on the paperclip-data
  volume (GOL-1632; size-capped 200M, keep 7, `copytruncate` for the pino append
  stream).

Fresh Droplets get all of this from cloud-init. On an **already-running box**,
install as root (same access model as the backup timers):

```bash
# 1. Refresh the repo clone so the scripts are present (as deploy)
ssh deploy@$DROPLET 'cd /opt/agenticos/repo && git fetch origin && git checkout -B main origin/main'

# 2. As ROOT (console or ssh root@): install units + journald cap + logrotate
bash /opt/agenticos/repo/infra/scripts/install-disk-hygiene.sh

# 3. Smoke-test reclaim + confirm root FS under ~70%
ssh deploy@$DROPLET '/opt/agenticos/repo/infra/scripts/docker-prune.sh && df -h /'
```

`install-disk-hygiene.sh` is idempotent and keeps its unit/config bodies in sync
with the inline copies in the cloud-init template.

## Credentials hygiene

- `terraform.tfvars` is gitignored — never commit it
- `*.tfstate` is gitignored — never commit it
- If you'll work on this from multiple machines, switch to the DO Spaces backend
  (commented block in `main.tf`) so state is shared and encrypted at rest
- Rotate API tokens at least once a year; the Tailscale auth key auto-expires after 1 hour
  (it's only needed during the first `terraform apply` for cloud-init to consume)
