# Company skills: which lane can ship scripts, and how to catch a degraded install

**Owner:** DevOps - Terra · **Origin:** GOL-2994 (trap found via GOL-2963) · **Last verified:** 2026-10-05

## The one rule

> **External git sources are markdown-only. Executables must come from `local_path` or `catalog`.**

Importing a skill from `github`, `skills_sh`, or `url` that contains a `scripts/`
directory **succeeds, reports no error, and installs only `SKILL.md`**. Every
script and reference the skill documents is dropped.

| `sourceType` | `scripts/` installed? | Resulting `trustLevel` |
| --- | --- | --- |
| `local_path` | yes | `scripts_executables` |
| `catalog` | yes | `scripts_executables` |
| `github` | **no — silently dropped** | `markdown_only` |
| `skills_sh` | **no — silently dropped** | `markdown_only` |
| `url` | **no — silently dropped** | `markdown_only` |

The refusal is correct — pulling executables straight from an external git ref
into an agent runtime is a real supply-chain risk. The defect is that it is
quiet: the import falls back to the markdown-only path, stores
`file_inventory = [SKILL.md]`, and surfaces no warning in the API payload or the
UI. Upstream Paperclip code (`server/src/services/company-skills.ts`:
`classifyInventoryKind` → `deriveTrustLevel` → `assertImportedSkillSourceAllowed`,
reason `scripts_executables_blocked`). We do not own that path.

## Why this costs a cycle

The agent reads `SKILL.md`, runs `scripts/<entrypoint>`, and gets a missing-file
error. That looks exactly like a dropped credential or a broken environment, so
the agent measures its env, concludes its secrets were revoked, and files a
regression. GOL-2963 burned a heartbeat this way and filed a false regression
against three correctly-closed tickets (GOL-60 / GOL-62 / GOL-237).

**If a skill's documented script is "missing" — audit the install before you
suspect your credentials.**

## Authoring a script-bearing skill

1. Keep the skill source in its repo as usual (e.g. `skills/<name>/` in
   `odoocker-goldberrygrove`) — that stays the reviewable source of truth.
2. Install it as a **`local_path`** company skill, not a `github` one. The
   runtime materialiser (`materializeRuntimeSkillFiles`) writes every inventory
   entry for that lane.
3. Push file updates with `PATCH /api/companies/{companyId}/skills/{skillId}/files`.
   `github`-sourced skills return `editable: false` ("Remote GitHub skills are
   read-only. Fork or import locally to edit them.") — you cannot even annotate
   them in place.
4. **Uninstall the `github` twin.** Two installs sharing a `slug` means an agent
   asking for that slug can get the degraded one.

## Audit

```bash
# human report; exit 1 if anything is degraded or slugs collide
PAPERCLIP_API_URL=http://paperclip-server:3100 \
PAPERCLIP_API_HOST=paperclip.gatheringatthegrove.com \
  node scripts/ops/audit-company-skills.mjs

node scripts/ops/audit-company-skills.mjs --json    # machine report
```

Needs `PAPERCLIP_API_KEY` and `PAPERCLIP_COMPANY_ID`. Set `PAPERCLIP_API_HOST`
when hitting the container directly — without the public `Host` header that
route is a 403.

What it reds:

- `documented_files_missing` — `SKILL.md` points at a file that is not in
  `fileInventory`. This is the user-visible failure, whatever the cause.
- `scripts_executables_blocked` — the above, on an external source that was
  trust-downgraded to `markdown_only`. The fix is re-homing, not retrying.
- slug collisions — one slug, two installs.

Behaviour is pinned by `scripts/ci/audit-company-skills.test.mjs`, which CI runs
through the existing `scripts/ci/*.test.mjs` glob. The GOL-2963 install is a
fixture in there, so a refactor cannot silently stop catching it.

## Scheduled audit (so nobody has to remember)

A tool you have to remember to run is not a control. `scripts/ops/run-company-skill-audit.sh`
is the on-droplet runner: it resolves the board key + the VPC-bound
paperclip-server origin through `scripts/plugin-api-env.sh` (1Password via the
credential-broker OP service-account token — never a GitHub Actions secret),
enumerates every company from `GET /api/companies`, and audits each library in
one pass.

```bash
# on agenticos-droplet, as the deploy user
cd /opt/agenticos/repo && scripts/ops/run-company-skill-audit.sh
scripts/ops/run-company-skill-audit.sh <companyId> [<companyId>…]   # skip enumeration
```

Exit codes are deliberately distinct: **0** clean, **1** a degraded install or
slug collision, **2** the audit could not complete (auth, network, bad
payload). A red scheduled run gets routed to a human, so "we found a degraded
skill" must never look like "we could not look".

`.github/workflows/company-skill-audit.yml` runs it weekly over the existing
deploy SSH lane, and on `repository_dispatch` type `company-skill-audit` — the
on-demand button an in-container agent can press with a `contents:write`
gh-token-broker token and no `actions:write` (same pattern as
`disk-reclaim.yml`). Findings land as a red run plus a job summary;
`ci-failure-router` opens the issue.

Offline harness: `scripts/ci/run-company-skill-audit.test.sh` (stubbed `op`
container + a throwaway localhost paperclip-server), run by CI through the
existing `scripts/ci/*.test.sh` glob.

### Which pipeline puts the runner on the box

The workflow invokes the runner from **`/opt/agenticos/repo`** — the Droplet's
real git clone, not the `/opt/agenticos` tarball snapshot. Exactly one pipeline
refreshes that clone on a host-script change: **`deploy-host-scripts.yml`**,
whose path filter already globs `scripts/**` (GOL-1965). So merging a change to
`scripts/ops/run-company-skill-audit.sh` reaches production with **zero new
deploy wiring**.

`deploy-droplet.yml` deliberately does *not* `git pull` and never touches
`/opt/agenticos/repo`, so adding the runner to *its* path filter would only
re-ship the file to a directory the cron never reads. If the audit ever exits
`2` with the `FATAL: … absent from /opt/agenticos/repo` message, the recovery is
`deploy-host-scripts.yml` (`workflow_dispatch`) — running `deploy-droplet.yml`
yields the identical FATAL, which is precisely the burned-heartbeat loop this
feature exists to prevent.

## Known findings (2026-10-05)

- `goldberry-playground/odoocker-goldberrygrove/odoo-logistics` — the original
  trap. Re-homed as the `local_path` skill
  `company/<companyId>/odoo-logistics`, which carries all 7 files. The degraded
  `github` install is still in the library (0 agents attached) and still
  shadows the healthy twin by slug → **uninstall pending CEO sign-off**.
- `paperclipai/paperclip/paperclip` — the platform's own skill documents
  `scripts/paperclip-issue-update.sh` (the heredoc helper it tells every agent
  to use for multiline comments) but ships only
  `scripts/paperclip-upload-artifact.sh`. `GET …/files?path=scripts/paperclip-issue-update.sh`
  → **404**. Upstream packaging drift, not ours to patch; until it lands, build
  multiline comment bodies with a `jq --arg` / heredoc-from-file pattern rather
  than that script.
