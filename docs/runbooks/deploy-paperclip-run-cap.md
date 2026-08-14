# Runbook: fleet run-concurrency cap + deploying paperclip-server code

GOL-1506 (GOL-557 lever 1). How the company-wide run-concurrency cap works, how
to change it, and how to ship paperclip-server application code to the Droplet.

## The knob

| | |
| --- | --- |
| **Env var** | `PAPERCLIP_MAX_CONCURRENT_RUNS` |
| **Set in** | `docker-compose.yml` → `paperclip-server` → `environment:` (value `"5"`) |
| **Enforced by** | `server/src/services/heartbeat.ts` → `resolveGlobalMaxConcurrentRuns` (fork PR#6) — gates the sole queued→running transition in `startNextQueuedRunForAgent` |
| **Semantics** | Caps company-wide `heartbeat_runs.status='running'` at N. Excess runs stay `queued` and re-promote as slots free (`resumeQueuedRuns`). Unset / non-numeric / `<= 0` disables the gate (stock upstream). Clamped to `[1, 1000]`. |
| **Value rationale** | Box 572389418 is 4 vCPU / 8 GB. 6+ concurrent runs historically drove loadavg past core count and swapped (2026-07-19 GOL-520; 2026-08-14 deadlock/409 walls). 5 keeps one slot of headroom below the observed thrash threshold while not starving the fleet. |

To change the cap: edit the value in `docker-compose.yml`, merge, then run the
**deploy** below (a bare compose recreate is enough for an env-only change, but
use the workflow so the health check + assertion run).

## Deploy paperclip-server code (why a rebuild is required)

paperclip-server builds its image from a **pinned git clone at `/opt/paperclip`**
(cloud-init clones the fork at a tag; see
`infra/cloud-init/droplet-bootstrap.yaml.tpl`). `deploy-droplet.yml` ships the
`/opt/agenticos` compose tree and force-recreates the container, **but never
updates `/opt/paperclip` and never rebuilds the paperclip-server image.** So new
fork code (e.g. the GOL-1506 gate) does not reach the running server through the
routine droplet deploy — and setting `PAPERCLIP_MAX_CONCURRENT_RUNS` on the old
image is **inert** (the old code never reads it).

### Preferred: dispatch the workflow

`.github/workflows/deploy-paperclip-server.yml` (workflow_dispatch):

- Inputs: `ref` (fork ref to deploy, default `master`) and `confirm` (type
  `DEPLOY`).
- Ships the current `docker-compose.yml`, updates `/opt/paperclip` to `ref`,
  rebuilds + force-recreates paperclip-server, then health-checks `/api/health`
  and asserts the env var is present.
- **Dispatch-only** — recreating paperclip-server briefly interrupts every agent
  run; in-flight runs re-promote from `queued` on restart, but pick a low-traffic
  moment. Requires a token that can dispatch workflows (PAT / human via the
  GitHub UI Run-workflow button — the GitHub App installation token cannot
  dispatch).

### Manual fallback (SSH as the `deploy` user)

```bash
cd /opt/paperclip
git fetch --tags --force --depth 1 origin master
git checkout --detach FETCH_HEAD
git rev-parse --short HEAD                       # note the SHA
cd /opt/agenticos
docker compose build paperclip-server
docker compose up -d --force-recreate paperclip-server
docker compose exec -T paperclip-server printenv PAPERCLIP_MAX_CONCURRENT_RUNS   # expect: 5
```

## Verify the cap is live (GOL-1506 AC3)

From anywhere with the paperclip DB (`DATABASE_URL`) and host loadavg (the
sandbox shares the host net namespace, so `/proc/loadavg` reflects the Droplet):

```bash
# 1) excess runs QUEUE rather than co-execute: running count must not exceed the cap.
#    Under a burst, expect running == cap and a non-zero queued backlog.
select
  count(*) filter (where status='running') as running,
  count(*) filter (where status='queued')  as queued
from heartbeat_runs
where created_at > now() - interval '15 minutes';

# 2) loadavg stays within core count (4) under the burst:
cat /proc/loadavg    # 1-min figure should sit at/below ~4, not the ~8-11 seen when uncapped
```

Pass condition: `running <= 5` at all times during a burst (queued backlog
present when demand exceeds 5), and 1-min loadavg no longer exceeds core count.
