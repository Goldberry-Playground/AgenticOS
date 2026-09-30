# Runbook: finish a plugin manifest-change deploy

## When you need this

You pushed a **manifest change** to a plugin (new capability, config field,
`database:`, or `webhooks:` declaration in `packages/<plugin>/src/manifest.ts`)
and the `Deploy Droplet Plugins` GitHub Actions run posted a ⚠️ warning like:

> **github-sync-plugin** — worker code hot-reloaded, but the stored manifest is
> stale. Finish it (reinstall + config + enable).

CI hot-reloaded the worker **code** but cannot refresh the **stored manifest**
(that needs a reinstall) or reapply config (that needs the service tokens, which
live only in 1Password — never in CI).

A manifest finish is two jobs, and they are separable on purpose:

1. **Re-resolve the plugin bind mount** — force-recreate `paperclip-server` so
   `/paperclip/plugins/<plugin>` points at the current host inode (otherwise
   reinstall reads a stale mount → `Missing package.json`). This used to require
   a Mac (host root / SSH). **It no longer does** — see the primary path below.
2. **Reinstall + config + enable** — refresh the stored manifest and re-apply
   config. An in-runtime agent can do this over the board-key plugin API once
   the mount is resolved; a human does it with `scripts/deploy-plugin.sh`.

## Primary path — self-serve recreate (no Mac, no host root) ✅

Since [GOL-166] the recreate is a first-class GitHub Actions job:
[`.github/workflows/recreate-paperclip-server.yml`]. The CI runner holds droplet
deploy access, so it runs `docker compose up -d --force-recreate paperclip-server`
and verifies **every** plugin bind mount re-resolved inside the fresh container
before reporting success. State survives — plugin/OAuth data lives on the
`paperclip-data` volume, not the container layer. It shares the `deploy-droplet`
concurrency group, so it can never race a deploy or a disk-reclaim.

It has **two triggers**, and neither needs a Mac, `op`, or an SSH tunnel:

### (a) One-click for a human — `workflow_dispatch`

Anyone with repo access opens **Actions → "Recreate paperclip-server" → Run
workflow**. No `op`, no tunnel, no Mac toolchain. Use this if you're a board
member finishing a deploy by hand.

### (b) Fully agent-triggered — `repository_dispatch` (NO `actions: write`)

An in-container Paperclip agent (e.g. DevOps) fires it directly. The
gh-token-broker App deliberately does **not** carry `actions: write`, so the
`workflow_dispatch` REST API 403s for agents. `repository_dispatch` does **not**
need `actions: write` — only `contents: write`, which the broker already mints.
Same pattern as `disk-reclaim.yml` (GOL-141). No new standing credential, no key
injected:

```sh
# Mint a short-lived, repo-scoped broker token (contents: write) and fire the
# recreate. No actions:write needed.
TOKEN="$(node /paperclip/agent-git/github-app-token.mjs token EngineeringMoonBear/AgenticOS)"
curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/EngineeringMoonBear/AgenticOS/dispatches \
  -d '{"event_type":"recreate-paperclip-server"}'
# 204 No Content = accepted. Watch the run in Actions; it self-verifies mounts.
```

### Then finish the reinstall (agent, over the board-key API)

Once the recreate run is green (mounts re-resolved), an agent completes the
manifest finish **from the Paperclip runtime** — no Mac — using the board-key
plugin API (the same calls `deploy-plugin.sh` makes, minus the host SSH):

1. **reinstall** — snapshot config first (`GET /api/plugins/{id}/config`), then
   `DELETE /api/plugins/{id}` + `POST /api/plugins/install` to refresh the stored
   manifest (install is create-only; it won't update in place). **Do not blind-
   `DELETE` a live connector plugin** — a failed reinstall on a stale mount took
   github-sync down in [GOL-296]. Only delete after the recreate run confirmed
   the mount, and restore the snapshotted config after.
2. **config** — re-apply via `POST /api/plugins/{id}/config`. `github-plugin`
   and `openviking-plugin` take config; `vault-plugin` takes none;
   `github-sync-plugin` is configured via [github-issue-sync.md].
3. **disable → enable** — `POST /api/plugins/{id}/disable` then `…/enable` to
   force the worker `setup()` to re-run with the fresh config.

> **Why CI does not run `deploy-plugin.sh` end-to-end:** the reinstall+config
> step needs the Paperclip **board key** and plugin **service tokens**, which
> flow only from 1Password and are deliberately never placed in CI. Chaining the
> full script into the workflow would push the board key into the runner — a
> least-privilege regression. So the split is intentional: **CI resolves the
> mount; the agent finishes over the board API.** The workflow keeps zero
> Paperclip credentials.

## Fallback path — from a Mac (`scripts/deploy-plugin.sh`)

Use this only if the Actions path is unavailable (e.g. the runner can't reach
the droplet) or you want the one-shot script to do recreate-guard + reinstall +
config + enable in a single idempotent run.

### Prerequisites

- `op` (1Password CLI) signed in: `op signin`
- SSH tunnel to Paperclip open:
  ```sh
  ssh -fNL 3100:10.116.16.2:3100 deploy@<droplet>
  ```
- SSH access to the droplet as `deploy@agenticos-droplet` (for the recreate-guard).

### Do it

```sh
cd /path/to/AgenticOS
scripts/deploy-plugin.sh <plugin>        # e.g. github-sync-plugin
# multiple at once:
scripts/deploy-plugin.sh github-plugin openviking-plugin
```

The script is idempotent — re-run it freely. Per plugin it:

1. **recreate-guard** — force-recreates `paperclip-server` only if the plugin
   dir isn't yet visible in the container (a newly-added bind mount; the
   inode-pinning `"Missing package.json"` fix). Skips otherwise. This is the
   same recreate the primary path does — the workflow just does it without a Mac.
2. **reinstall** — `DELETE` + `POST /api/plugins/install` to refresh the stored
   manifest (install won't update in place).
3. **config** — pushes config from 1Password: `github-plugin` and
   `openviking-plugin` only. `vault-plugin` takes none. `github-sync-plugin` is
   configured via [github-issue-sync.md](github-issue-sync.md) (write-scoped
   token + synced project id) — this script reinstalls + enables it but does
   NOT set its config.
4. **disable → enable** — forces the worker `setup()` to re-run so it
   re-subscribes with the fresh config (saving config alone doesn't restart it).
5. **assert** — prints each plugin's status; exits non-zero on an error state.

## Verify

The recreate workflow self-verifies mounts; `deploy-plugin.sh` prints each
target's status at the end. This curl is an independent re-check.

```sh
BK="$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key')"
curl -fsS -H "Authorization: Bearer $BK" \
  http://localhost:3100/api/plugins | jq '(if type=="object" then .plugins else . end)[] | {pluginKey, status}'
```

All target plugins should be present and NOT `error`/`failed`.

## Stale-deploy trap: a drifted `packagePath` (GOL-804)

`POST /api/plugins/<id>/upgrade` re-reads the plugin registry entry's **stored
`packagePath`** and reloads the worker from it. It **cannot repoint** that path
(a `packageName` body is ignored). So if `packagePath` has drifted to a stale
source — e.g. an out-of-band `install` pinned it to
`/paperclip/staged-plugins/<plugin>-<version>` and that dir's `dist/` is old — a
CD `/upgrade` "succeeds" while shipping **old code**. GOL-804: the registry
served `0.11.3` from a `github-sync-plugin-0.11.4` staged dir (manifest said
`0.11.4`, dist was `0.11.3`) and the deploy went green.

Two guards now make this loud and self-healing:

1. **Deterministic recovery** — `scripts/finish-plugin-upgrade.sh` passes
   `REINSTALL_PATH=/paperclip/plugins/<plugin>` (the CD-rebuilt bind mount) to
   `finish-plugin-upgrade.mjs`. When `/upgrade` can't reach the built version,
   the finisher **reinstalls from that canonical source**, which repoints
   `packagePath` to fresh code, and re-asserts. Config survives a same-key
   reinstall; if it were dropped, the finisher fails RED (never ships an
   unconfigured worker). Prefer the canonical bind mount — do **not** pin the
   registry to a versioned `staged-plugins/<plugin>-<version>` dir.

2. **Post-deploy assertion (hard gate)** — `scripts/assert-plugin-versions.sh`
   runs after every plugin deploy, **unconditionally** (not gated on a manifest
   bump), and fails the workflow RED if any plugin's live registry version does
   not equal its freshly-built `dist/manifest.js` version. This is the backstop
   that catches staleness from *any* cause (drifted path, forgotten bump,
   out-of-band install), including deploys that never went through the finish
   step. Run it by hand any time to audit convergence:
   `bash scripts/assert-plugin-versions.sh` (on the droplet).

If you must recover manually: `bash scripts/deploy-plugin.sh <plugin>` reinstalls
from `/paperclip/plugins/<plugin>` and re-applies config, then verify with
`assert-plugin-versions.sh`.

## Adding a BRAND-NEW plugin (GOL-2423)

A new plugin is not auto-discovered. Everything it needs now hangs off ONE list:
`PLUGIN_DIRS` in [`scripts/plugin-registry.sh`]. The shell consumers
(`assert-plugin-versions.sh`, `finish-plugin-upgrade.sh`, `deploy-plugin.sh`,
`sync-paperclip-secrets.sh`) source it. The YAML and compose files cannot source
shell, so they still carry literal lists — and
`scripts/ci/plugin-registry-drift.test.mjs` fails the PR if any of them disagree
with `PLUGIN_DIRS`. That gate exists because these lists had already drifted:
`discord-plugin` was in the deploy workflow's build loop but missing from
`detect-manifest-bumps.sh` and `finish-plugin-upgrade.sh`.

**Wiring (one PR):**

1. `scripts/plugin-registry.sh` — add the dir to `PLUGIN_DIRS`, and to
   `PLUGIN_PENDING_INSTALL` until the first install actually happens.
2. `docker-compose.yml` — add
   `./packages/<p>:/paperclip/plugins/<p>:ro`. **Without this the install fails
   with `Missing package.json` no matter how many times you recreate the
   container** — there is no mount to re-resolve.
3. `.github/workflows/deploy-droplet-plugins.yml` — `paths:` trigger, both
   `pnpm --filter` lists, and the dist-completeness loop.
4. `.github/workflows/recreate-paperclip-server.yml` — the `plugins="…"` verify
   list.
5. Run `node scripts/ci/plugin-registry-drift.test.mjs` and
   `bash scripts/ci/plugin-registry.test.sh` locally; both run in CI's
   **CI scripts** job.

`.github/workflows/**` edits need Josh's review per the standing rules.

**First install (after the wiring PR is on `main`):**

1. Run **Actions → "Recreate paperclip-server"** so the NEW bind mount resolves.
   Verify the run's mount check lists your plugin.
2. `POST /api/plugins/install` with
   `{"packageName":"/paperclip/plugins/<p>","isLocalPath":true}`, then confirm
   `status=ready` (or `error` with a *config missing* `lastError`, which is the
   expected installed-but-unconfigured state).
3. Set config **separately**, from 1Password — never inline, never in a diff.
4. Remove the dir from `PLUGIN_PENDING_INSTALL`. You cannot forget this:
   `assert-plugin-versions.mjs` fails the next deploy RED with
   *"listed in PLUGIN_PENDING_INSTALL but IS INSTALLED"*.

**Note on plugin keys.** The pluginKey is the manifest's declared `id:`, which is
**not** always `agenticos.<dir>` — `grove-content-drafter-plugin` declares
`agenticos.grove-content-drafter`. `plugin_key()` reads the manifest, so never
hand-concatenate the key.

## Why each step is necessary

See `memory/paperclip-plugin-db-and-activation-contract.md` (the install/
activation lifecycle + bind-mount inode pinning sections). The short version:
manifest is read by the host before worker init, so a code hot-reload can't
touch it; install is create-only; config save doesn't restart the worker.

## Related

- [`.github/workflows/recreate-paperclip-server.yml`] — the primary,
  self-serve recreate (one-click + agent `repository_dispatch`).
- `.github/workflows/deploy-droplet-plugins.yml` — emits the warning that sends
  you here (and hot-reloads worker code on every plugin push).
- `.github/workflows/disk-reclaim.yml` — the sibling `repository_dispatch`
  agent-trigger pattern the recreate workflow mirrors.
- `scripts/deploy-plugin.sh` / `scripts/paperclip-lib.sh` — the fallback
  implementation.
- `scripts/sync-paperclip-secrets.sh` — the "sync ALL plugins from 1Password"
  entrypoint (same lib); use it after a full rebuild rather than per-plugin. It
  SKIPS `PLUGIN_PENDING_INSTALL` plugins unless you pass `INSTALL_PENDING=1`, so
  a routine secret-sync can't perform a gated first install by accident.
- [`scripts/plugin-registry.sh`] — `PLUGIN_DIRS` / `PLUGIN_PENDING_INSTALL` /
  `plugin_key()`; the single source of truth for the deploy-managed plugin set.
- `scripts/ci/plugin-registry-drift.test.mjs`, `scripts/ci/plugin-registry.test.sh`
  — the CI gates that keep the literal YAML/compose lists in lockstep.

[GOL-166]: https://github.com/EngineeringMoonBear/AgenticOS/pull/281
[GOL-296]: https://github.com/EngineeringMoonBear/AgenticOS/pull/255
[`.github/workflows/recreate-paperclip-server.yml`]: ../../.github/workflows/recreate-paperclip-server.yml
[github-issue-sync.md]: github-issue-sync.md
[`scripts/plugin-registry.sh`]: ../../scripts/plugin-registry.sh
