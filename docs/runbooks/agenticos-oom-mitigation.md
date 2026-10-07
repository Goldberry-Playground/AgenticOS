# AgenticOS Droplet — OOM mitigation & resource alerting (GOL-53)

On 2026-07-04 the `agenticos-droplet` hit RAM ~103% and OOM-crashed the stack,
which took down the App Platform dashboard (it depends on the Droplet's
VPC-private OpenViking / Paperclip / Postgres). This runbook covers the
guardrails added to prevent recurrence and how to finish applying them.

## What this change ships

1. **Container memory limits** (`docker-compose.yml`) — every service now has a
   `mem_limit`/`mem_reservation`. A runaway agent/LLM run is now contained to a
   single container OOM-kill instead of taking the whole Droplet down.
   `paperclip-server` (which spawns every agent subprocess) is the primary
   source and is capped at 3g; `ollama` (elastic model cache) at 2g.
   **Deploys automatically** via `.github/workflows/deploy-droplet.yml` on merge
   to `main` (root `docker-compose.yml` is a trigger path) — no manual step.

2. **Swap file** (`infra/cloud-init/droplet-bootstrap.yaml.tpl`) — 4G swap,
   `vm.swappiness=10`, as an OOM safety net. Cloud-init only runs at first boot,
   so this covers **future** Droplets automatically. For the **existing** box,
   run the one-shot below once (needs root; cloud-init drift is intentionally
   ignored in `droplet.tf`).

3. **DO native alert policies** (`infra/terraform/monitor-alerts.tf`) — memory
   >80%/>90%, disk >85%, CPU >85%. The DO metrics agent is already running
   (`monitoring = true`), so this only adds the alerting that was missing.
   Applied on the next `terraform apply` (needs the DO token — the AgenticOS
   Infra 1Password item).

## Finish-up steps

### Existing Droplet swap (one-shot, root)

`ssh root@…` is **refused** on agenticos-droplet — root's `authorized_keys`
holds only the Terraform provisioning key, not an operator's (Josh,
2026-09-30). Use `sudo` over SSH with `-t` (a TTY, so `deploy`'s sudo password
prompt can be answered) or the DigitalOcean web Console. See
`infra/README.md` → "Getting root on a running box".

`-t` and a heredoc cannot be combined: with a pty allocated, the here-document
arrives on the same stream sudo reads the password from, so sudo eats the first
line of the script. Stage the script, then run it under `-t`:

```bash
ssh agenticos-droplet 'cat > /tmp/swap-setup.sh' <<'EOF'
set -euo pipefail
test -f /swapfile || (fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile)
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
free -h && swapon --show
EOF
ssh -t agenticos-droplet 'sudo bash /tmp/swap-setup.sh; rm -f /tmp/swap-setup.sh'
```

### Apply the alert policies
```bash
cd infra/terraform
source ../scripts/load-secrets.sh   # AgenticOS Infra tokens from 1Password
terraform plan   # review: 4 digitalocean_monitor_alert to add
terraform apply
```
To also route alerts to Discord, set `TF_VAR_alert_slack='{url="https://discord.com/api/webhooks/…/slack",channel="#alerts"}'`
(DO's Slack alert type posts to a Discord webhook when you append `/slack`).

## App-level run-dispatch concurrency cap (GOL-819)

Defense-in-depth on top of the idempotent-create guard (GOL-638) and the
droplet resize (GOL-657): a global FIFO semaphore bounds how many agent
subprocesses the **AgenticOS app itself** dispatches at once, so a future
runaway that is *not* the create-dup path (a wake/retry storm, a fan-out bug)
can't oversubscribe the box's practical ceiling (~8-10 runs post-resize).

- **Where:** `apps/dashboard/lib/agent/concurrency.ts`, wired into `spawnClaude`
  (`lib/agent/spawn.ts`) — every run this app spawns holds a slot for the
  child's lifetime. Excess demand **queues (FIFO)**, it is not dropped or errored.
- **Default:** `8` concurrent runs. Tune with the `AGENTICOS_MAX_CONCURRENT_RUNS`
  env var (positive integer; invalid values warn and fall back to `8`). Raising
  it caps more throughput to the box, lowering it protects shared-API latency —
  **confirm the value with the CEO before Phase-5 dispatch goes live**, since it
  bounds total agent throughput.
- **Observability:** crossing the cap emits a `console.warn` line prefixed
  `[run-dispatch] concurrency cap reached: …` (active/limit/queued). A Discord
  ops bridge can key off that prefix.

**Scope:** this bounds the app's *own* dispatch path (the Phase-5
scheduler/curator wiring, manual "Run Now", future fan-out). The **primary live
agent-run dispatcher is `paperclip-server`** (it spawns every agent subprocess,
per the `mem_limit` note above); a hard concurrency cap at *that* layer is a
Paperclip-platform concern, tracked separately from this repo.

## Right-sizing (separate decision)
The box is `s-2vcpu-4gb`. If the mem_limits above prove too tight under real
concurrency, bump `var.droplet_size` to `s-2vcpu-8gb` (+~$24/mo) and
`terraform apply` (brief power-off→resize→power-on; disk is NOT resized so it
stays reversible). This is a cost decision for the board, tracked separately —
not bundled into this mitigation PR.
