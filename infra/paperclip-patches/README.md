# Paperclip fork patches

Patches applied to the **Paperclip fork build context** (`/opt/paperclip`) before
`docker compose build paperclip-server`.

## Why this exists

`paperclip-server` builds its image from a separate clone of
[`EngineeringMoonBear/Paperclip-AgenticOS`](https://github.com/EngineeringMoonBear/Paperclip-AgenticOS)
at `/opt/paperclip`, pinned by `infra/cloud-init/droplet-bootstrap.yaml.tpl` and
moved by `.github/workflows/deploy-paperclip-server.yml`. That repo lives under a
**different GitHub owner**, and the `agenticos-developer` App that brokers agent
git credentials is not installed there — minting a token for it fails
(`mint_failed`). So there is no self-service path for this repo's automation to
open a PR against the fork.

A patch directory closes that gap without click-ops: a core-server fix lands as a
reviewed, version-controlled artifact here, and the deploy applies it to the
pinned ref on the way to the image build. The fix stays reproducible (a fresh
provision applies the same patches) and auditable (the diff is in this repo's
history), which a hand-edit on the box would not be.

## This is a staging area, not a home

Every patch here is **debt**. The destination is the fork itself: upstream it,
cut a new `agenticos-v*` tag, bump the pin in
`infra/cloud-init/droplet-bootstrap.yaml.tpl` and in the
`deploy-paperclip-server.yml` default `ref`, then **delete the patch** in the
same PR. A patch that outlives its upstream fix will fail `git apply` and break
the deploy — loudly, by design.

Upstreaming needs fork write access, which the board owns. Ask the CEO to either
install the `agenticos-developer` App on `EngineeringMoonBear` (then agents can
PR the fork directly and this directory can be retired) or land the patch content
in the fork by hand.

## Convention

- One file per logical change, `NNNN-<slug>.patch`, applied in **sorted order**.
- Produce with `git format-patch`/`git diff` from a tree at the **pinned ref**, so
  paths are `a/`-prefixed and `git apply -p1` (the default) works.
- Header comment at the top of each patch: the issue id, what it fixes, and the
  upstream status.
- `infra/scripts/apply-paperclip-patches.sh` applies them. It is all-or-nothing
  (every patch is `--check`ed before any is applied), idempotent (an already
  applied patch is detected by a reverse `--check` and skipped), and it fails the
  deploy rather than build a partially patched image.

## Current patches

| Patch | Issue | What | Upstream status |
| --- | --- | --- | --- |
| `0001-gol3005-sweep-leftover-run-process-groups.patch` | GOL-3005 | Kill the run's process group when a run exits, so a descendant that outlives its leader (headless Chrome, a backgrounded MCP server) cannot survive the run and hold pids/RAM against `pids_limit: 2048` / `mem_limit: 3g`. | Not upstreamed — needs fork write access. |

### 0001 — leftover run process groups (GOL-3005)

Adds `packages/adapter-utils/src/leftover-process-group.ts` and calls it from the
`close`/`error` handlers of `runChildProcess`.

Run children are already spawned `detached: true`, so each run leads its own
process group, and the **timeout** and **cancel** paths already signal the group.
The gap was the ordinary exit paths: on `close` the server only dropped its
in-memory handle, so anything still running in the group stayed up forever.

Two details worth keeping in mind when reviewing or extending it:

- **`kill(pid, 0)` succeeds on a zombie.** A naive liveness probe therefore
  reports a leak for every clean run (descendants that exited normally reparent
  to PID 1 and stay zombies while PID 1 is the node server). The sweep uses
  `kill(-pgid, 0)` only as a cheap gate and then scans `/proc` for group members
  whose state is not `Z`, so a clean run sends no signals at all.
- **This does not by itself return the pid budget.** SIGKILLing a leftover turns
  it into a zombie, and a zombie still holds a pid. Pair it with the container
  init reaper (`init: true`, GOL-3002) to get the pid back; this patch is what
  returns the RAM and the threads, and stops the live processes accumulating.

Pgid reuse is not a hazard: the group id is always the leader's pid, and Linux
will not recycle a pid that is still in use as the pgid of a non-empty process
group. Once the leader is reaped, `kill(-pgid, …)` either hits `ESRCH` or hits
exactly that run's leftovers.
