# Runbook — vendor status: "is this me, or is this GitHub?"

GOL-3021. We have decent observability of our own boxes (RUM, otel, beyla, DO
monitors, the disk and volume guards) and, before this, **none of our vendors**.

## TL;DR for an agent mid-incident

Your CI is red / your deploy hangs / the API you call is timing out. Before you
debug your own change, ask whether the vendor is broken:

```bash
/opt/agenticos/repo/infra/scripts/vendor-status-guard.py read   # on the host
cat /paperclip/ops/vendor-status.json                           # in an agent run
```

No credential, no vault, no 1Password item. If the snapshot is older than ten
minutes `read` re-polls live first, so the answer is never a stale lie — with or
without the timer installed.

If `overall` is `ok` and the vendors you depend on are `operational`, it is your
change. Go debug it.

## What the incident looked like without this

2026-10-05, 19:11:58Z: `githubstatus` component `Actions` →
`degraded_performance`. Thirteen workflow runs queued on `grove-odoo-modules`
alone; jobs were cancelled without ever getting a runner; the
`Auto-approve verified agent PRs` workflow was itself queued, so even fully
green agent PRs could not self-merge. Several agents each diagnosed it from
scratch, a heartbeat apiece, and the board heard about it third-hand.

The diagnosis is two API calls. The problem was never the diagnosis — it was
that nobody could tell anyone, and the next agent started over.

## The pieces

| Piece | Where |
| --- | --- |
| Poller | `infra/scripts/vendor-status-guard.py` (`poll` / `read`) |
| Tests | `infra/scripts/vendor-status-guard.test.sh` (offline, hermetic) |
| Schedule | `agenticos-vendor-status.timer`, every 5 min |
| Install on a live box | `infra/scripts/install-vendor-status.sh` (root) |
| Install on a fresh box | `infra/cloud-init/droplet-bootstrap.yaml.tpl` (automatic) |
| Snapshot (agent-readable) | `/paperclip/ops/vendor-status.json` |
| Dedupe state | `/paperclip/ops/vendor-status.state.json` |
| Ops channel | Discord `#paperclip-ops`, via `DISCORD_OPS_WEBHOOK_URL` |

The snapshot and the state file sit on the `paperclip-data` docker volume on
purpose. That volume is mounted at `/paperclip` inside `paperclip-server`, which
is where agents run — so the host timer (root) and an agent run read and write
**the same two files**, giving one dedupe stream and one answer. From the host
they are under `/var/lib/docker/volumes/*paperclip-data/_data/ops/`, globbed the
same way `/etc/logrotate.d/agenticos` already globs that volume.

## Install / refresh

The guard reaches the box by itself: `deploy-host-scripts.yml` resets
`/opt/agenticos/repo` to `origin/main` on any push touching `infra/scripts/**`.
The **systemd timer** needs one root install, because the deploy user's sudo is
NOPASSWD only for `systemctl`/`ufw` and cannot write `/etc/systemd/system`:

```bash
# DO web Console as root, or: ssh root@<agenticos-droplet>
bash /opt/agenticos/repo/infra/scripts/install-vendor-status.sh
```

Idempotent. Re-run after any change to the unit bodies. A fresh Droplet needs
none of this — cloud-init carries the same units inline.

Verify:

```bash
systemctl list-timers agenticos-vendor-status.timer --no-pager
journalctl -u agenticos-vendor-status.service -n 20 --no-pager
docker compose -f /opt/agenticos/docker-compose.yml exec paperclip-server \
  cat /paperclip/ops/vendor-status.json | head -20
```

## Alerting contract

One message per transition, never per poll:

| Edge | Alert |
| --- | --- |
| `ok`/`maintenance` → `degraded`/`down` | `DEGRADED` |
| `degraded` → `down` | `ESCALATED` |
| `down` → `degraded` | `EASED` |
| `degraded`/`down` → `ok`/`maintenance` | `RECOVERED` |
| unreadable status page, 3 polls running | `UNKNOWN`, once |
| anything else | silence |

`under_maintenance` is recorded in the snapshot but **never paged** — planned
work is not an incident, and DO and Cloudflare schedule it constantly.

A single poll batches all of its transitions into **one** Discord message. A
vendor-wide event hits several allowlisted components at once, and six pings for
one outage is how an ops channel gets muted.

A cold start (no state file) alerts for anything already degraded. That is
correct: nobody has been told yet.

`unknown` is not an outage. One flaky DNS lookup from our own box must not page
the channel and pin the blame on a vendor, so a blind spot has to persist three
consecutive polls (~15 min) before it speaks, and it speaks once.

## The component allowlist is load-bearing

Cloudflare publishes **479** components and DigitalOcean **256**. When this was
written Cloudflare had four unresolved incidents and eight degraded components —
Durable Objects, R2, API Shield, WARP, Containers, Workers Assets, Workflows,
Cloudflare One Client — and we use **none** of them. An "alert on any degraded
component" poller would have paged on all eight on day one, trained everyone to
ignore the channel, and been worse than no monitoring at all.

So each vendor in `VENDORS` declares only the components on a path we actually
depend on, by exact upstream `name`. Notable exclusions, all deliberate:

- **Cloudflare regional PoP groups** (North America, Europe, …) — they sit at
  `major_outage`/`degraded` for routine re-routing. Permanent noise.
- **DigitalOcean DNS** — our DNS is Cloudflare. DO DNS degradation is not ours.
- **GitHub Copilot / Codespaces / Pages / Packages** — not on any deploy or
  revenue path.

An allowlisted name that disappears upstream is reported as `unknown` with a
"allowlist may be stale" note rather than silently dropped. A vendor rename must
fail loudly, or the allowlist rots into a no-op that reports permanent health.

**Adding a vendor or component**: edit `VENDORS`, then
`bash infra/scripts/vendor-status-guard.test.sh`. Confirm the exact upstream
name first — `curl -s https://<status-host>/api/v2/components.json | python3 -c
"import json,sys; [print(c['status'], '|', c['name']) for c in
json.load(sys.stdin)['components']]"`.

## Stripe has no live public status API — do not "fix" this back to one

`status.stripe.com` is a React shell with no `/api/v2/*`. The one JSON endpoint
that answers, `https://status.stripe.com/current`, is a **frozen artifact**:

```
{"largestatus":"up","message":"All services are online.",
 "time":"February 09, 2024 @ 06:08PM +00:00"}
last-modified: Fri, 09 Feb 2024 18:08:57 GMT
```

Wiring it up would hard-code a permanent green lie about the one vendor that
touches money. Verified 2026-10-05.

Stripe is therefore probed **synthetically**: unauthenticated GETs to
`api.stripe.com/v1/charges` (healthy = `401`) and `js.stripe.com/v3/` (healthy =
`200`). A 401 means "Stripe is up and refused us", which is exactly the liveness
signal we want, with no credential in play. `5xx` → `down`; a reachable but
unexpected code → `degraded` (could be a vendor contract change, not an outage);
no response → `unknown`.

Odoo is **not** covered: `status.odoo.com` serves HTML at the Statuspage paths,
so there is nothing cheap to read. Our own prod Odoo is covered by the existing
uptime checks instead.

## CI incident debris vs. a real red check

This is the classification rule that made the GOL-2988 diagnosis a two-call job.
The guard ships it inline in the snapshot (`hints.github_actions`) whenever
Actions is degraded, so the next agent gets it from the same call that tells them
Actions is broken.

A check **never executed a step** — it is incident debris, not a test failure —
when all of:

- `conclusion` is `cancelled`, **and**
- `runner_name` is **empty**, **and**
- the job-logs endpoint 404s with `BlobNotFound`.

`started_at` → `completed_at` exceeding the job's own `timeout-minutes` is the
tell that the span is queue time, not run time.

**Do not "fix" the code.** Wait for recovery, then re-trigger.

### Re-triggering without `actions: write`

An agent App installation token has **no `actions: write`**, so
`/actions/runs/<id>/cancel`, `/rerun` and `/rerun-failed-jobs` are all `403`, and
so is the `workflow_dispatch` REST API. The one lever that works is **close +
reopen the PR**, which re-fires `on: pull_request` (default types include
`reopened`) on the same SHA.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Snapshot is hours stale | timer not installed / not running | `install-vendor-status.sh`; `systemctl list-timers` |
| Snapshot stale but `read` still right | expected — `read` re-polls past `--max-age` | nothing |
| Transitions logged, nothing in Discord | `DISCORD_OPS_WEBHOOK_URL` unset | place it in `/opt/agenticos/.env` (literal URL, never `op://`) |
| Every poll re-alerts | state file unwritable; the guard logs `ERROR could not write state` | fix ownership on `/paperclip/ops/` |
| An alert for something we don't use | allowlist too wide | narrow `VENDORS`, add a test case |
| A component reports `unknown` with "allowlist may be stale" | vendor renamed it | update the name in `VENDORS` |

## Scope note

This guard watches **vendors**, not us. Our own boxes and apps are covered by
the DO monitors, the RUM/otel/beyla pipeline, the uptime checks, and the
disk/volume guards. If `vendor-status read` says every vendor is healthy, the
problem is ours.
