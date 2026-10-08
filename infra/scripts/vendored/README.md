# `infra/scripts/vendored/` — verbatim copies of scripts owned by another repo

Files here are **byte-identical** copies of a script whose canonical home is a
different Goldberry repo. Do not edit them in place: the drift check that keeps
them honest is a plain `sha256sum` compare against the canonical file, so any
local edit — even a comment — reads as drift.

To change one: change it in the canonical repo, then re-vendor here and bump the
pin in the consuming wrapper.

## `merge-queue-arm-automerge.sh`

| | |
|---|---|
| Canonical | `Goldberry-Playground/grove-sites` → `scripts/ci/merge-queue-arm-automerge.sh` @ `main` |
| Vendored at | commit `70a01e5ed8f06e0b468ec821ca223929542349f0` (2026-10-06) |
| `sha256` | `66c23d2e4db717a123782baa0469435d2263d30d172a8da67f621447c69afbf1` |
| Consumer | `infra/scripts/merge-queue-arm-sweep.sh` (host wrapper, run by `agenticos-merge-queue-arm.timer`) |
| Ticket | GOL-3125 (vehicle) / GOL-3118 (the mechanism it implements) |

### Why vendored instead of fetched at run time

GOL-3125 had to pick one. Vendoring won on three counts:

1. **The code that runs on the host is reviewable in the repo that governs the
   host.** `/opt/agenticos/repo` is what every host timer executes out of, and
   `deploy-host-scripts.yml` is the only thing that refreshes it. A wrapper that
   `curl | bash`-ed grove-sites `main` would put unreviewed, unpinned code into a
   root systemd unit, and an AgenticOS rollback would not roll it back.
2. **A fetch-at-run-time sweep goes dead silently.** Any broker hiccup, GitHub
   blip, or repo rename and the timer has nothing to execute — the exact failure
   mode (nothing arms the PR) this ticket exists to delete.
3. **The obvious alternative — a CI drift test — cannot work here.** AgenticOS CI
   has only the repo-scoped `GITHUB_TOKEN`, which cannot read grove-sites, so no
   AgenticOS test can compare the two copies.

So the drift check is a **run-time** guard instead, on the
`host-clone-drift-guard.sh` model: the wrapper mints a broker token it already
needs, compares this file's `sha256` to grove-sites `main`, and posts to the ops
Discord webhook on mismatch — while continuing to run the vendored copy. Drift is
loud, and the timer never stops arming because of it.

### Why `vendored/` and not `vendor/`

`.gitignore` carries a repo-wide `vendor/` rule ("Vendored dependencies"), so a
directory named `vendor/` here is silently untracked. Since the systemd unit
`ExecStart`s out of `/opt/agenticos/repo` — a clone built by `git reset --hard
origin/main` — an untracked script would simply not exist on the box and the
timer would fail every tick. `scripts/ci/merge-queue-arm-sweep.test.sh` asserts
these files are tracked, so the trap cannot come back quietly.
