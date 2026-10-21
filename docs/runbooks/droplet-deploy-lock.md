# Droplet deploy lock: the `deploy-droplet` concurrency group

**Status:** live from the merge of the PR that added `queue: max`. No secret,
no on-box state, nothing to install.

## What it serializes

Seven workflows run `docker compose`, `git reset --hard` or a power-cycle on
`agenticos-droplet`, and none of them may overlap another. They all declare the
same workflow-level concurrency group:

```yaml
concurrency:
  group: deploy-droplet
  cancel-in-progress: false
  queue: max
```

| workflow | trigger | what it does on the box |
|---|---|---|
| `deploy-droplet.yml` | push to `main` (vault/plugins/compose paths), dispatch | `compose build vault-server`, force-recreate paperclip-server |
| `deploy-droplet-plugins.yml` | push to `main` (`packages/<plugin>/**`), dispatch | `git reset --hard` the clone, rebuild plugin dists |
| `deploy-host-scripts.yml` | push to `main` (`infra/scripts/**`, `scripts/**`), dispatch | `git reset --hard` the clone, rebuild moved dists |
| `disk-reclaim.yml` | daily schedule, dispatch, `repository_dispatch` | `docker system prune -af`, `docker builder prune -af` |
| `deploy-paperclip-server.yml` | dispatch, `repository_dispatch` | rebuild the paperclip-server image |
| `recreate-paperclip-server.yml` | dispatch, `repository_dispatch` | force-recreate paperclip-server |
| `resize-droplet.yml` | dispatch, `repository_dispatch` | power-cycle via the DigitalOcean API |

The group exists so that a prune never runs in the middle of a `compose build`
(it would delete the layers being created), a clone reset never races a dist
rebuild, and a resize never power-cycles the box under a deploy.

## The GitHub behaviour this works around

A concurrency group holds **at most one running run and, by default, at most one
pending run**. GitHub's docs ("Control the concurrency of workflows and jobs",
section "Using concurrency in different scenarios"):

> `single` (default): At most one job or workflow run can be `pending` in the
> concurrency group. When a new job or workflow run is queued, any existing
> `pending` job or workflow run in the same group is canceled and replaced.

`cancel-in-progress: false` only protects the **running** run. The pending slot
is still replaced, so with three or more siblings arriving while one is running,
every sibling except the newest is cancelled rather than queued.

That is what happened on 2026-10-21:

- 13:47:52Z: the merge of `cb5b1058` (AgenticOS #903) matched three path
  filters at once. `Deploy Droplet Plugins` (run 39611139119) took the group;
  `Deploy Droplet` ([run 39611139007](https://github.com/Goldberry-Playground/AgenticOS/actions/runs/39611139007))
  and `Deploy Host Scripts` (run 39611139013) were both **cancelled within one
  second**, so the vault-server deploy for that merge never ran.
- 13:51:15Z: a manual `Droplet Disk Reclaim` dispatch
  ([run 39611641378](https://github.com/Goldberry-Playground/AgenticOS/actions/runs/39611641378))
  was cancelled by a `Deploy Droplet Plugins` dispatch (run 39611644764) two
  seconds later.

Both were re-dispatched by hand afterwards. Nothing in the cancelled runs'
logs says why; the run page just shows "cancelled" with no step output.

## The fix: `queue: max`

GitHub added a `queue` setting to `concurrency` on 2026-05-07 (changelog:
"GitHub Actions concurrency groups now allow larger queues"). From the same
docs section:

> `max`: Up to 100 jobs or workflow runs can be `pending` in the concurrency
> group. When the queue is full, any additional jobs or workflow runs are
> canceled.

And on ordering, from the Note in the same section:

> Jobs or workflow runs in the same concurrency group are processed in
> first-in-first-out (FIFO) order according to the time each one started
> waiting on the concurrency group, not the time each workflow was dispatched.
> Since the actual start time of a job or run may vary, ordering is not
> guaranteed.

With `queue: max` every sibling waits its turn and the on-box exclusion is
unchanged, because the group is unchanged. `queue: max` cannot be combined with
`cancel-in-progress: true` (GitHub rejects the workflow), which is fine here:
deploys must never be cancelled mid-`compose build`.

Trade-offs accepted:

- **No same-workflow dedup.** Three quick merges that each touch
  `infra/vault-server/**` now run three vault deploys in turn instead of the
  newest replacing the older pending one. Every workflow in the group is
  idempotent, so the extra runs cost minutes, not correctness.
- **Order is FIFO by time entered, not guaranteed.** A `Deploy Host Scripts`
  run can legitimately go before the `Deploy Droplet` run of the same merge.
  That was already true before (whichever run won the group went first).

## actionlint

`concurrency.queue` is not yet in actionlint's syntax table: rhysd/actionlint
issue 657 is open and the fix (PR 654) is unmerged as of 2026-10-21, so every
release from 1.7.7 (the pin in `security.yml`) to 1.7.12 (latest) reports:

```text
unexpected key "queue" for "concurrency" section. expected one of "cancel-in-progress", "group"
```

`.github/actionlint.yaml` ignores exactly that message, and only on the seven
workflows above, via actionlint's `paths:` / `ignore:` config (available since
v1.7.4, so the 1.7.7 image honours it). Verified locally against both
`rhysd/actionlint:1.7.7` (the CI image) and the Homebrew 1.7.12.

**When an actionlint release accepts `queue`, delete `.github/actionlint.yaml`**
and bump the pin in `security.yml`. Nothing else references the file.

## Alternatives considered

- **Per-workflow groups plus an on-box lock** (`flock`, or a lease directory
  with a TTL). A `flock` cannot be held across the many separate `ssh`
  sessions one job makes, so it would need a lease file, a TTL to recover from
  a dead runner, and acquire/release steps in every workflow. It also cannot
  cover `resize-droplet.yml`, which never SSHes in: it power-cycles the box
  from the DigitalOcean API.
- **One orchestrating workflow with `needs:`.** Loses the per-path push
  triggers and the `repository_dispatch` entry points that in-container agents
  use (`disk-reclaim`, `recreate-paperclip-server`, `resize-droplet`).
- **A wait step polling `gh run list` for in-progress siblings.** Needs
  `actions: read`, and two runs starting within the same second both see an
  empty list and proceed together.

## How to check it is working

After a merge that touches several deploy path filters, every sibling run
should end `success` (or `queued` while waiting), never `cancelled`:

```bash
gh run list --repo Goldberry-Playground/AgenticOS --limit 30 \
  --json databaseId,workflowName,status,conclusion,createdAt \
  --jq '.[] | select(.workflowName | test("Droplet|Host Scripts|paperclip-server")) | "\(.databaseId) \(.createdAt) \(.workflowName) \(.status)/\(.conclusion)"'
```

A run that shows `cancelled` with no step output and a sibling in the same
group created within seconds of it is the pending-slot replacement again:
check that the workflow still carries `queue: max`.
