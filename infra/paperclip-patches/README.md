# Paperclip fork patches

Patches applied to the **Paperclip fork build context** (`/opt/paperclip`) before
`docker compose build paperclip-server`.

## Why this exists

`paperclip-server` builds its image from a separate clone of
[`Goldberry-Playground/Paperclip-AgenticOS`](https://github.com/Goldberry-Playground/Paperclip-AgenticOS)
at `/opt/paperclip`. The pin lives in `infra/cloud-init/droplet-bootstrap.yaml.tpl`
and is moved by `.github/workflows/deploy-paperclip-server.yml`. (The fork moved from
`EngineeringMoonBear` into the org on 2026-08-03; the old URL only redirects.)

**The normal path for a core-server fix is upstream, not this directory.** The
`agenticos-developer` App can mint a token for the fork
(`github-app-token.mjs token Goldberry-Playground/Paperclip-AgenticOS`), so agents
open PRs there directly. Josh merges them and cuts an `agenticos-v*` tag. Then an
AgenticOS PR bumps the pin. See fork PRs #6 (`agenticos-v0.2.1`) and #8
(`agenticos-v0.2.2`).

Use this directory only when a fix has to reach the live box **before** it can be
merged and tagged upstream (an outage, for example). The patch lands here as a
reviewed artifact, and the deploy applies it to the pinned ref on the way to the
image build. That keeps the fix reproducible (a fresh provision applies the same
patches) and auditable, which a hand-edit on the box would not be.

## This is a staging area, not a home

Every patch here is **debt**. Open the upstream fork PR in the same heartbeat you
add the patch. When it is merged and tagged, bump the pin in
`infra/cloud-init/droplet-bootstrap.yaml.tpl` and in the
`deploy-paperclip-server.yml` default `ref`, and **delete the patch** in the same
PR. A patch that outlives its upstream fix will fail `git apply` and break the
deploy, loudly and on purpose.

## Convention

- One file per logical change, `NNNN-<slug>.patch`, applied in **sorted order**.
- Produce patches with `git format-patch`/`git diff` from a tree at the **pinned
  ref**, so paths are `a/`-prefixed and `git apply -p1` (the default) works.
- Put a header comment at the top of each patch: the issue id, what it fixes, and
  the upstream fork PR.
- `infra/scripts/apply-paperclip-patches.sh` applies them. It is all-or-nothing
  (every patch is `--check`ed before any is applied). It is idempotent (a patch
  that is already applied is detected by a reverse `--check` and skipped). It
  fails the deploy rather than build a partially patched image. An empty directory
  is a no-op.

## Current patches

None. When you add one, list it here as patch / issue / what it fixes / upstream fork PR.

## Retired

| Patch | Issue | Upstreamed as |
| --- | --- | --- |
| `0001-gol3005-sweep-leftover-run-process-groups.patch` | GOL-3005 | Fork PR #8 → `agenticos-v0.2.2`. Sweeps a run's leftover process group on exit (`packages/adapter-utils/src/leftover-process-group.ts`). |
