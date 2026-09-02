# Agent-runtime CPU containment (GOL-2045)

Blast-radius half of GOL-2043. On 2026-09 a runaway agent command (`grep -r … /`)
burned **~128 CPU-hours** and starved **github-sync** inbound. The GOL-2043
prevention guard (`scripts/guards/bound-recursive-fs-search.mjs`, PR #661) denies
the common unbounded-search form at the Bash tool boundary, but string-matching
alone cannot stop an evasive runaway (`cd /; grep -r x .`), a non-search CPU hog,
or a command that backgrounds itself past the Bash tool's wall-clock timeout
(`grep -r x / &`). This runbook is the containment layer: no single agent run can
burn the box or starve github-sync again.

## The key architectural fact

**github-sync is not a separate container.** It is the `github-sync-plugin`
worker running **inside `paperclip-server`** — the same container that spawns
every agent subprocess (see the plugin mount in `docker-compose.yml`). So a
Docker `--cpus` cap on `paperclip-server` bounds it against its *siblings*
(agenticos-db, gh-token-broker, …) but does **not** stop a co-tenant agent from
starving the github-sync worker. Containment therefore needs two layers.

## What ships (all in `docker-compose.yml` + one mounted script)

### Layer 1 — cross-container bounds (kernel-enforced, cgroup v2)

On `paperclip-server`:

| Key | Value | Effect |
|-----|-------|--------|
| `cpus` | `"3.5"` | Hard cap at 3.5 of the box's 4 vCPUs (`cpu.max`). A runaway can never take every core; ~0.5 vCPU always remains for github-sync's sibling dependencies. |
| `cpu_shares` | `1024` | Default relative weight (`cpu.weight`); explicit for clarity. |
| `pids_limit` | `2048` | Fork/thread-storm cap for a non-search CPU hog. |
| `mem_limit` | `3g` | Pre-existing (GOL-53). |

On `agenticos-db` and `gh-token-broker` (github-sync's data + token path):

| Key | Value | Effect |
|-----|-------|--------|
| `cpu_shares` | `2048` | 2× the paperclip-server weight, so under 100% CPU contention the DB (issue↔PR mirror mappings) and the token minter keep scheduler priority. Only bites under contention; idle otherwise. |

### Layer 2 — in-container bounds on agent shells (`scripts/agent-shell-rlimits.sh`)

`paperclip-server` sets `BASH_ENV=/paperclip/agent-shell-rlimits.sh`. Non-interactive
bash sources this file at startup, so it runs for **every agent Bash command** and
**only** for agent bash shells — never for the node server or plugin workers (they
are not bash), so this can never CPU-kill the server itself. It does two things:

1. `renice -n 10 $$` — de-prioritises agent work vs the node server + github-sync
   worker (both nice 0). Under CPU contention the kernel favours the server, so
   github-sync stays responsive while an agent is busy. (Guarded — no-op if
   `renice` is absent from the image.)
2. `ulimit -S -t 1800` / `-H -t 3600` — a per-process **CPU-time** cap (RLIMIT_CPU):
   SIGXCPU at 30 CPU-min, SIGKILL backstop at 60 CPU-min. This is what catches the
   backgrounded runaway the wall-clock timeout misses — the limit is **inherited by
   every child** (including `cmd &`), each accounting its own CPU time. Bounds a 128
   CPU-hour runaway to ≤1 CPU-hour (>100× reduction) while leaving ample headroom
   for legitimate single-process builds/tests.

An unprivileged agent can only **lower** RLIMIT_CPU and only **raise** nice, so it
cannot undo either to escape the cap (verified below). Values are tunable at the
top of the script.

## Deploy

Auto-deploys via `.github/workflows/deploy-droplet.yml` on merge to `main`
(`docker-compose.yml` and `scripts/agent-shell-rlimits.sh` are trigger paths).
That workflow force-recreates `paperclip-server`, which applies the new
cgroup caps and re-resolves the read-only script mount. No manual step.

> Merging = applying to prod (it recreates `paperclip-server`, briefly bouncing
> running agents — OAuth/login state survives on the paperclip-data volume). Gate
> the merge on board/Josh approval like any prod-affecting AgenticOS change.

## Verify (on the live Droplet, after deploy)

The issue's acceptance test — "launch a CPU-bound loop inside an agent container
and confirm it is throttled and github-sync stays responsive":

```bash
# 1) Confirm the cross-container caps are live:
docker inspect paperclip-server \
  --format 'NanoCpus={{.HostConfig.NanoCpus}} CpuShares={{.HostConfig.CpuShares}} PidsLimit={{.HostConfig.PidsLimit}}'
# expect: NanoCpus=3500000000 CpuShares=1024 PidsLimit=2048
docker inspect agenticos-db gh-token-broker --format '{{.Name}} CpuShares={{.HostConfig.CpuShares}}'
# expect: /agenticos-db 2048  /gh-token-broker 2048

# 2) Confirm an agent bash command inherits nice + CPU-time cap:
docker compose exec -T paperclip-server \
  bash -lc 'echo "nice=$(awk "{print \$19}" /proc/$$/stat) soft=$(ulimit -S -t) hard=$(ulimit -H -t)"'
# expect: nice=10 soft=1800 hard=3600   (via BASH_ENV)

# 3) Runaway is reaped, github-sync stays responsive. In one shell start a
#    CPU hog INSIDE the container with a SHORT cap to see the kill quickly:
docker compose exec -T paperclip-server \
  bash -c 'ulimit -S -t 3; echo start; i=0; while :; do i=$((i+1)); done; echo "never reached"'
# expect: the process dies (SIGXCPU) after ~3 CPU-seconds, exit 152.
#    Meanwhile github-sync stays up — the token minter answers:
curl -fsS http://gh-token-broker:9099/health   # from inside the compose network
```

Local proof of the mechanism (run in CI/dev, not prod): sourcing the script via
`BASH_ENV` sets `soft=1800 hard=3600 nice=10`; a `while :; do :; done` loop under a
short `ulimit -S -t` exits **152 (SIGXCPU)**; a second source keeps the tighter
values; `ulimit -H -t 999999` fails with *"Operation not permitted"* (non-escapable).

## Residual / follow-up

True per-*worker* cgroup isolation — placing agent subprocesses in a child cgroup
so the github-sync worker has a guaranteed CPU reservation *inside* the container —
requires `paperclip-server` (the Paperclip platform) to move spawned children into
a delegated sub-cgroup. That is a **product concern** (Engineering - Alice), out of
scope for this infra change. Layers 1+2 make it unnecessary in practice (the runaway
is reaped in ≤1 CPU-hour and de-prioritised throughout); revisit only if the live
throttle test shows github-sync still starving under a bounded co-tenant load.
