# Runbook: agent box disk pressure (`/paperclip`, `/dev/vda1`)

The Paperclip agent box runs on a single 77G `/dev/vda1` volume. `/` and
`/paperclip` are the *same* device, so `df -h /` is the number that matters.
At 100% the Paperclip server stops writing backups and origin logging freezes
(the GOL-1631 P0).

## Triage order

Run `df -h /` first, then attack in this order — cheapest and safest first.

| # | Target | Typical size | Risk |
|---|---|---|---|
| 1 | Abandoned agent worktrees `.wt-*` | 1GB each | none if clean |
| 2 | Workspaces of terminated agents | 2–5GB | low, archive first |
| 3 | `data/backups` orphaned partial `.sql` | GBs | none (pruned by nothing) |
| 4 | `data/run-logs` | GBs | **platform audit trail — escalate** |

Note only part of the volume is visible from inside an agent container.
`du -sh /paperclip` will under-report versus `df`; the remainder is host-side
(containerd snapshots, the DB volume, server backups).

## 1. Abandoned agent worktrees — the usual culprit

Agents create per-issue worktrees (`.wt-<issue>-<repo>`) inside the shared
project checkouts. Each gets its own `node_modules`, so one costs ~1GB. On
2026-09-30, 31 of them held 3.4GB.

```bash
scripts/ops/reap-stale-worktrees.sh            # dry run, prints what it would free
scripts/ops/reap-stale-worktrees.sh --apply    # actually reclaim
```

**Why this is safe:** removing a *clean* worktree loses nothing permanent. The
branch ref and every commit live in the parent repository's object store. The
work comes back with `git worktree add <path> <branch>`; the only cost to a
resuming agent is a re-run of `pnpm install`, which hardlinks from the shared
store. The reaper refuses to touch a worktree that is dirty, that a live
process is sitting in, that is on a detached HEAD, whose branch is missing from
the parent repo, or that was modified in the last 24h (tunable with
`--min-age-hours=`). It is idempotent and dry-run by default.

Verify afterwards that the branches survived:

```bash
git -C <parent-repo> rev-parse --verify refs/heads/<branch>
```

## 2. Workspace of a terminated agent

Check the agent really is terminated and nothing live references the path:

```sql
select id, name, status from agents where id::text like '<prefix>%';
```

```bash
for p in /proc/[0-9]*; do readlink $p/cwd; done | grep <workspace-id>
```

Open issues still assigned to a terminated agent are an orphan-assignment bug,
not a reason to keep the workspace — a reassigned issue gets a fresh workspace.
Archive real content before deleting; `node_modules` is usually >90% of the size,
so excluding it makes the safety net cheap:

```bash
tar --exclude='node_modules' --exclude='.next' --exclude='.turbo' \
    -czf /paperclip/work/archives/<agent>-workspace-$(date +%F).tar.gz <workspace-dir>
```

Then prove the archive is restorable *before* deleting: extract the `.git`
directories to a scratch dir and confirm the unpushed commits resolve with
`git cat-file -t <sha>`. A tarball you have not read back is not a backup.

## 3. Backups

`data/backups` retention **is** enforced (GFS policy in
`instance_settings.general.backupRetention`), but two gaps make it grow:

- `dailyDays` keeps *every* dump inside the window, not one per day.
- The pruner globs `*.sql.gz`, so a dump killed before gzip finishes leaves an
  orphaned `.sql` partial that **nothing ever prunes**.

A good dump ends with `COMMIT;`. Verify the keep-set before deleting anything:

```bash
gzip -t <dump>.sql.gz && zcat <dump>.sql.gz | tail -c 200
```

Deleting backups is board-gated — get CEO/Josh approval first.

## 4. What not to touch

- `agenticos-db-data` — the live database volume.
- The newest backup.
- `data/run-logs` — this is the platform's run history / audit trail. Retention
  here needs board approval, not a unilateral delete.

## Known gap

There is **no off-box copy of the backups**. Everything above is local-only
reclamation; a volume loss still loses the dumps. Off-siting to Spaces is the
outstanding priority item.
