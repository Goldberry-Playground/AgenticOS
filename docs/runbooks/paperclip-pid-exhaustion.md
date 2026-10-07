# Runbook — paperclip-server pid exhaustion (zombie leak)

**Incident class:** every agent run on the box fails to spawn.
**First seen:** 2026-10-05 (GOL-3002). **Related:** GOL-2864 (restart forensics),
GOL-2045 (CPU containment), GOL-1632 / GOL-2858 (backup interval re-arm),
GOL-3005 (leftover headless Chrome).

## Symptom

Agent runs fail in bursts with `adapter_failed`:

```
Failed to start command claude … spawn /usr/local/bin/claude EAGAIN
Failed to parse claude JSON output          # SIGABRT, same root cause
```

`EAGAIN` on spawn is **not** memory — it is "no more pids". Agents are left in
`error`. On 2026-10-05 two storms (16:21–16:30Z, 18:03–18:08Z) failed 60+ runs.

## Diagnosis (60 seconds)

On the Droplet as `deploy`:

```bash
CID=$(docker inspect -f '{{.Id}}' paperclip-server)
CG=/sys/fs/cgroup/system.slice/docker-$CID.scope
cat $CG/pids.current $CG/pids.max      # e.g. 2043 / 2048  → cap exhausted
cat $CG/pids.events                    # "max 542" → cap has been hit 542×
docker inspect -f '{{.HostConfig.Init}}' paperclip-server   # MUST be true
```

Then split live threads from zombies — the whole point is that `pids.current`
being at the cap does **not** mean the box is busy:

```bash
P1=$(docker inspect -f '{{.State.Pid}}' paperclip-server)
# zombies adopted by the container's PID 1
awk '{s=$0; sub(/.*\) /,"",s); split(s,f," "); if (f[1]=="Z" && f[2]=='"$P1"') print FILENAME}' \
  /proc/[0-9]*/stat 2>/dev/null | wc -l
```

On 2026-10-05: 2043 pids, of which only **352** were live threads and **1,691
were zombies** — 989 bash, 225 git, 177 chrome-headless, 130 chrome, 84
chrome_crashpad, 35 node, 15 sleep, 8 python3. Oldest was 4.8 days old, i.e. the
container's entire uptime.

## Root cause

The image `ENTRYPOINT` ends in `exec gosu node node … server/dist/index.js`, so
**container PID 1 is the node server itself**. libuv reaps only the pids it
spawned (a `waitpid()` per known child), never `waitpid(-1)`. When an agent run's
`bash` exits, its own children (`git`, `chrome`, `sleep`, …) are **reparented to
PID 1** — and node never collects them. Each zombie holds a pid, so they accrue
against `pids_limit: 2048` until it is exhausted and *every* subsequent spawn
fails. Accumulation rate observed: ~350/day, so the cap returns ~5–6 days after
any restart.

`PAPERCLIP_MAX_CONCURRENT_RUNS` is **not** the lever here — it bounds how many
runs execute *at once*, not how many pids leak *cumulatively*. It was live and
working during both storms (verified in `server/dist/services/heartbeat.js`,
`resolveGlobalMaxConcurrentRuns`). Do not "fix" concurrency for this symptom.

## Fix (already shipped — verify, don't re-derive)

`init: true` on the `paperclip-server` service in `docker-compose.yml` interposes
docker's own init (tini, `/usr/bin/docker-init`) as PID 1. It loops on
`waitpid(-1)`, so it reaps any orphan reparented to it, and forwards signals to
the server (node moves to PID 2, keeping its graceful-shutdown path).

Chosen over an in-image tini `ENTRYPOINT` because the build context is
`/opt/paperclip` (a separate upstream clone) — the compose flag needs **no image
rebuild** and is the half of this we own.

It reaches the box through `deploy-droplet.yml`, whose path filter already
includes `docker-compose.yml`: that workflow tar-ships the committed tree to
`/opt/agenticos/` (so `/opt/agenticos/docker-compose.yml` is updated) and then
runs `docker compose up -d --force-recreate paperclip-server`. A pre-flight step
proves the engine supports `--init` on a throwaway container *before* the
recreate, so an engine without `docker-init` fails the deploy instead of leaving
the board down.

## Remediation when you find it already exhausted

```bash
cd /opt/agenticos && docker compose up -d --force-recreate paperclip-server
```

A restart clears the zombies (they die with PID 1) but **only resets the clock**
unless `init: true` is actually live — check `HostConfig.Init` first. If it reads
`false`, the box is on a stale `/opt/agenticos/docker-compose.yml`: re-run the
deploy-droplet workflow rather than hand-editing the file on the box.

⚠️ Recreating interrupts in-flight runs **and re-arms the DB backup interval**
(GOL-1632 / GOL-2858: the backup `setInterval` is anchored at process start, so
restarts closer together than the interval mean it never fires). Pick a quiet
moment, and confirm a backup lands afterwards.

## Guard

`infra/scripts/pid-pressure-guard.sh`, on the `agenticos-pid-pressure.timer`
(every 30 min, `User=deploy`). Read-only — it never kills or recreates anything,
because the recreate side effect above is not a timer's call to make. It alerts
the Grove ops Discord webhook on:

| signal | threshold | meaning |
| --- | --- | --- |
| `pids.events max > 0` | any | the cap has **already** been hit since container start — spawns are failing right now (critical) |
| `pids.current / pids.max` | ≥ 50% | pid-budget pressure from *any* cause, incl. live leftovers like GOL-3005 |
| zombies under PID 1 | ≥ 100 | regression signal: with `init: true` this sits near 0, so the reaper is not in effect |

Alerts are rate-limited to one per 6 h **per severity level**, so an escalation
from warning to critical is never swallowed by the cooldown. A healthy run is
silent but still writes its observation line to
`/var/log/agenticos/pid-pressure.log` — so a dead timer and a healthy box do not
look the same.

Install on an already-running box (as root, via the DO Console or
`ssh root@<droplet>`):

```bash
bash /opt/agenticos/repo/infra/scripts/install-pid-pressure-guard.sh
```

Fresh Droplets get the units from cloud-init
(`infra/cloud-init/droplet-bootstrap.yaml.tpl`); keep the two unit bodies in
sync. Branch coverage is pinned by `scripts/ci/pid-pressure-guard.test.sh`, which
also fails if `init: true` is ever dropped from the compose service.
