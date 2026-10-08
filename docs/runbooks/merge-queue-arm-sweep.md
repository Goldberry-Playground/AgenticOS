# Runbook — merge-queue arming sweep (`agenticos-merge-queue-arm.timer`)

**Ticket:** GOL-3125 (this timer) · GOL-3118 (the mechanism) · GOL-2524 (the wedge)
**Box:** `agenticos-droplet` (DO `572389418`, nyc1) · **Log:** `/var/log/agenticos/merge-queue-arm.log`

## What it does and why it has to be a timer

GitHub never creates workflow runs for events triggered by the default
`GITHUB_TOKEN`. With a merge queue on `main`, `auto-approve.yml`'s
`gh pr merge --squash` is an **enqueue**, so an enqueue made on `GITHUB_TOKEN`
builds a merge group that no `merge_group` workflow ever runs on: no required
check reports, and GitHub ejects the PR unmerged ~30 minutes later. The queue is
**sequential**, so that one dead entry stalls every healthy entry behind it.

GOL-3118 measured the fix: **auto-merge inherits the identity of whoever armed
it.** Arm a PR as the agent App and the enqueue GitHub performs later — even
20 minutes later, once checks go green — carries the App identity and creates
runs normally. It shipped `merge-queue-arm-automerge.sh`, but **nothing called
it**: a PR was armed only if an agent remembered. This timer removes the
remembering.

It cannot be a GitHub Actions workflow, by the exact rule above: a workflow has
only `GITHUB_TOKEN`, and arming as `github-actions` rebuilds the same dead
group. Minting another identity inside Actions would need the App private key in
Actions secrets, which **ADR-0001 declines**. The arming identity must come from
outside Actions — and `gh-token-broker` already runs on this box, so the sweep
mints a short-lived, repo-scoped App installation token per run. **No new secret
exists because of this timer.**

## Moving parts

| Path | Role |
|---|---|
| `infra/scripts/merge-queue-arm-sweep.sh` | host wrapper: resolves the broker, sweeps the three repos, drift-checks the vendor, alerts Discord |
| `infra/scripts/vendored/merge-queue-arm-automerge.sh` | byte-identical vendored copy of the grove-sites sweep (see `infra/scripts/vendored/README.md` for why vendored) |
| `infra/scripts/install-merge-queue-arm-sweep.sh` | installer for an already-running box — **needs no root**, run by `deploy-host-scripts.yml` |
| `infra/cloud-init/droplet-bootstrap.yaml.tpl` | the same unit bodies inline, so a rebuilt droplet keeps the timer |
| `scripts/ci/merge-queue-arm-sweep.test.sh` | offline harness (79 assertions); test 7 pins installer==cloud-init unit bodies, tests 11/12 pin the no-root install |

Cadence `OnCalendar=*:0/5` (every 5 min), `Persistent=true`,
`RandomizedDelaySec=60`. The sweep is idempotent — it skips PRs already armed by
the App — so a tick on a quiet queue costs one broker mint plus one GraphQL read
per repo.

Delivery: `infra/scripts/**` and `scripts/**` both trigger
`deploy-host-scripts.yml`, which is the **only** pipeline that `git reset --hard
origin/main`s `/opt/agenticos/repo` — the clone the unit's `ExecStart` runs out
of. `deploy-droplet.yml` does not touch that clone.

## Settings that are not negotiable

- `ARM_UNAPPROVED=1` — always. The conservative default (arm only APPROVED PRs)
  is structurally too late to be the steady state: by the time
  `auto-approve.yml` has approved a PR it has already performed the enqueue on
  `GITHUB_TOKEN`, which *is* the wedge. Useful arming happens before approval.
  Per grove-sites #993 this skips unapproved protected-path PRs against each
  **target** repo's own base-branch `scripts/ci/protected-paths-carveout.mjs`,
  so it carries **no board decision**.
- `ARM_PROTECTED=0` — always. Setting it would pre-arm an unapproved
  protected-path PR, making a human reviewer's approval *be* the merge. That
  needs an explicit board decision, not a cron job. The wrapper **exits 2** if
  anything tries to set it; `scripts/ci/merge-queue-arm-sweep.test.sh` test 1
  pins that.
- `User=root` **on the unit** (not on the install — see below) — a deliberate
  deviation from `host-clone-drift-guard.sh`'s
  `User=deploy`. The sweep reads `/opt/agenticos/secrets/gh-broker-client.key`,
  a chmod-600 secret kept out of `/opt/agenticos/.env` precisely so
  paperclip-server and its agent subprocesses never see it. Group-reading it to
  `deploy` would permanently widen who can mint App tokens on this box — a
  bigger standing privilege change than a oneshot timer running as root. Nothing
  in the sweep touches the clone's git objects, so the dubious-ownership reason
  that puts the drift-guard on `deploy` does not apply.

## Install — nothing to paste, and no root

**There is no manual install step.** `deploy-host-scripts.yml` runs the
installer over the deploy key as its final step, so merging a change under
`infra/scripts/**` both refreshes the clone and converges the timer. The install
is idempotent, so that step is a no-op on every run after the first.

### Why this needed no root after all

The first version of this runbook ended with "paste exactly this one line, as
root", and that parked GOL-3125 on a human for hours. The reasoning was: the
installer writes `/etc/systemd/system`, the `deploy` user's sudo is NOPASSWD
only for `systemctl`/`ufw`, and no agent has root SSH to this box
(`~/.ssh/agenticos-droplet.pub` is the public half only, and no private
counterpart exists in any readable 1Password vault — probed, not assumed).

Every one of those facts is true. The conclusion was still wrong, because of two
things that were not checked:

1. The sudoers rule cloud-init grants is
   `ALL=(ALL) NOPASSWD: /bin/systemctl, /usr/sbin/ufw` —
   with **no argument restriction**. `deploy` may run *any* `systemctl` verb
   unattended.
2. `systemctl link <absolute-path>` is the documented way to install a unit from
   outside the unit search path. **systemd** performs the `/etc/systemd/system`
   write, as a symlink. Nothing needs write access to that directory.

So the installer is privilege-adaptive: as root it writes the unit files
directly (what cloud-init effectively does); otherwise it stages the identical
bodies under `/opt/agenticos/units/` and `systemctl link`s them. Both paths end
at the same `systemctl enable --now`.

`/opt/agenticos/units/` is deliberately **outside** the git clone: a linked
unit's symlink target has to survive `git reset --hard origin/main`, and
anything under `/opt/agenticos/repo` is one host-script deploy away from moving
underneath systemd.

**The generalisable lesson:** before handing a step to a human because an agent
"cannot write that path", check whether a tool the agent *can* already run will
write it for you. `systemctl link`, `ufw`, `docker` and `systemd-run` all take
arguments that reach well past what the sudoers line looks like it permits.
That cuts both ways — it is also why `NOPASSWD: /bin/systemctl` with
unrestricted arguments is close to root on this box, and why the key the sweep
reads is kept out of `deploy`'s reach.

### Manual install (only if the workflow is unavailable)

From anywhere with the deploy key — no root:

```bash
ssh deploy@<droplet> 'bash -lc "cd /opt/agenticos/repo && bash infra/scripts/install-merge-queue-arm-sweep.sh"'
```

It refuses safely if the clone is not current yet (below), and it ends by
running one `--dry-run` tick itself, so the output *is* the verification. A
fresh droplet needs none of it: cloud-init carries the units inline and enables
the timer.

### The one case that does still need root

If `/etc/systemd/system/agenticos-merge-queue-arm.{service,timer}` already
exists as a **regular file** (cloud-init's `write_files` on a fresh droplet) and
its body **differs** from what the installer would install, a non-root run
cannot replace it. The installer refuses with that message rather than guessing,
and root is the escalation. An identical body is a no-op — which is the normal
fresh-droplet case, and test 11b pins it.

### ⚠️ Do NOT `git reset` the clone by hand to make the script appear

The merge of the host scripts and the arrival of those scripts on the box are
two separate events. `deploy-host-scripts.yml` fires on the push to `main` and
refreshes `/opt/agenticos/repo`; until it has run, the installer is not there.
The obvious fix is the wrong one:

```bash
# ❌ never
cd /opt/agenticos/repo && git fetch origin main && git reset --hard origin/main
```

That clone bind-mounts `packages/<plugin>` straight into `paperclip-server`, so
a bare reset reverts every live plugin bundle to whatever `dist/` happens to be
committed — silently, with nothing red anywhere. It happened on 2026-09-29
(GOL-2591) and knocked out the github-sync liveness heartbeat 14 minutes after
it armed. `deploy-host-scripts.yml` is the only refresh that pairs the reset
with `rebuild-plugin-dists.sh` and a registry convergence.

So if the installer says the clone predates the merge, re-run that workflow —
its final step is the installer, so one run does both:

> Actions ▸ **Deploy Host Scripts** ▸ Run workflow (branch `main`)
> <https://github.com/Goldberry-Playground/AgenticOS/actions/workflows/deploy-host-scripts.yml>

The installer's pre-flight checks this for you and refuses with that remedy
rather than installing a unit that would fail on a missing file every five
minutes forever. It also warns — without refusing — if
`/opt/agenticos/secrets/gh-broker-client.key` is unreadable or the
`gh-token-broker` container is down: a missing key never fixes itself, a down
broker does, and neither is worth leaving the queue unguarded over.

### Manual verification, if you want more than the self-check

```bash
sudo systemctl list-timers agenticos-merge-queue-arm.timer --no-pager
sudo systemctl start agenticos-merge-queue-arm.service   # force one real tick
tail -n 80 /var/log/agenticos/merge-queue-arm.log
```

`sudo` with no password: the same `NOPASSWD: /bin/systemctl` rule the install
relies on. Reading the log needs no privilege at all.

## Reading the log

One block per repo. `skip` lines name the guardrail that fired:

| skip reason | meaning |
|---|---|
| `draft` | explicit "not yet" from the author |
| `authored by X, not agenticos-developer` | `auto-approve.yml` approves maintainer PRs but never enqueues them; arming would take that control away |
| `already armed by agenticos-developer` | the idempotency path — the steady state on a quiet queue |
| `armed by <someone else>` | re-arming would mean disabling theirs first |
| `already in the merge queue` | arming cannot fix an existing entry → `merge-queue-rescue.sh` |
| `conflicting` | resolve the conflict first |
| `unapproved and protected path(s) touched` | the `ARM_PROTECTED` boundary, working |
| `unapproved and … carve-out unavailable` / `changed-file list` | **fail-closed** — a lookup it could not trust, not a finding |

Last line is the summary: `done: mode=apply armed=N failed_repos=M`.

## Alerts (ops Discord webhook, `DISCORD_OPS_WEBHOOK_URL` from `/opt/agenticos/.env`)

| Alert | Cause | Action |
|---|---|---|
| `could not reach gh-token-broker` / `/health failed` | broker container down or recreated mid-run | `docker compose up -d gh-token-broker`; the next tick self-heals |
| `merge-queue arm sweep had failures in: <repos>` | a repo's sweep exited non-zero | read the log block for that repo; a single PR GitHub refuses to arm is already non-fatal to the others |
| `vendor drift: … is now <sha> but AgenticOS vendors <sha>` | grove-sites changed the canonical sweep | re-vendor into `infra/scripts/vendored/` and bump `CANONICAL_SHA256` in the wrapper + `vendored/README.md` |
| `no longer matches its pin … edited in place` | someone edited the vendored copy | revert the edit, or re-vendor and bump the pin |
| `… is back in sync with …@main` | the drift above resolved | none: this is the all-clear |

Both drift alerts are **advisory**: the timer keeps arming with the vendored
copy. A drift check that could stop the timer would reintroduce the exact
"nothing arms the PR" failure this ticket exists to delete.

Drift alerts fire on **transitions**, not on every tick (GOL-3226). The wrapper
records the last state it posted in
`/var/lib/agenticos/merge-queue-arm/drift.state`, and posts once on entering
drift, once more if grove-sites `main` moves again while still drifted, once on
an in-place edit, and once as an all-clear when it is back in sync. Unresolved
drift gets a reminder every 24h (`DRIFT_REALERT_SECONDS`, `0` = never). Every
tick still logs its drift line to `merge-queue-arm.log`. `--dry-run` never posts
or records drift. To force a re-alert, delete the state file.

## Turning it off

```bash
systemctl disable --now agenticos-merge-queue-arm.timer   # deploy can do this (sudo systemctl)
```

Nothing else depends on it. Disabling it does not un-arm already-armed PRs — it
only stops new ones from being armed, which returns the queue to the GOL-3118
state where an agent has to remember.
