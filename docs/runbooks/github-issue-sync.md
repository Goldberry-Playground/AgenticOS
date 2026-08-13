# Runbook — bidirectional GitHub ↔ Paperclip issue sync (Step 9)

Mirrors issues between GitHub repos and Paperclip projects, in both directions,
with loop prevention. One plugin instance carries **multiple bridges** (repo ↔
project pairs), which may span orgs — auth is via the gh-token-broker (GitHub App),
not a PAT.

```
Paperclip issue created/updated (in the synced project)
  └─ github-sync-plugin (events.subscribe) → create/update GitHub issue
       (labeled `synced-from-paperclip`, body marker `<!-- synced-from-paperclip: <id> -->`)

New GitHub issue opened
  ├─ PRIMARY (v2, PR #228): native GitHub App `issues` webhook — ONE webhook for every
  │    repo the App is installed on (selection: All repositories = self-extending)
  │    → POST /api/plugins/<id>/webhooks/github-app (CF Access: Bypass — HMAC is the auth)
  │    → onWebhook verifies X-Hub-Signature-256 (appWebhookSecret) → ctx.issues.create
  └─ LEGACY (v1): per-repo .github/workflows/issue-sync-to-paperclip.yml → HMAC webhook
       (via CF Access service token) → /webhooks/github-issue — kept as fallback
          (description marker `<!-- synced-from-github: <repo>#<n> -->`)
```

## The two legs

| Leg | Mechanism | Where |
|---|---|---|
| **Paperclip → GitHub** | `github-sync-plugin` subscribes company-wide to `issue.created`/`issue.updated`, routes by the issue's project to the matching bridge, and writes the GitHub issue via the broker token. Status maps to state (`done`/`cancelled` → `closed`), so closing a Paperclip issue closes its GitHub twin | `packages/github-sync-plugin` (worker/sync) |
| **GitHub → Paperclip (primary — App webhook)** | the "AgenticOS Developer" GitHub App subscribes to `issues` natively; GitHub POSTs every installed repo's issue events (HMAC `X-Hub-Signature-256` with `appWebhookSecret`) to `POST /api/plugins/:id/webhooks/github-app`; `onWebhook` verifies, then **creates** a mirror on `opened` and **propagates closure** on `closed`/`reopened` (agent-free, no per-repo setup) | `packages/github-sync-plugin` (inbound/onWebhook) + App settings |
| **GitHub → Paperclip (legacy — workflow)** | a per-repo Actions workflow POSTs the issue payload (HMAC + CF service token) to `/webhooks/github-issue` | `.github/workflows/issue-sync-to-paperclip.yml` |

## Activating the native App webhook (inbound v2) — the "always observing" checklist

The v2 path only works when ALL of these hold (each was found broken 2026-07-08):

1. **CF Access lets GitHub in.** GitHub cannot send CF service-token headers; the
   `…/webhooks/github-app` path needs its own MOST-SPECIFIC Access app with a
   **Bypass** policy (`cloudflare-qa-webhook.tf` →
   `paperclip_github_app_webhook`). The plugin's HMAC check is the auth.
   Symptom when broken: every delivery 403s with `cf-access-domain` header.
2. **The droplet's STORED manifest declares the `github-app` endpoint.** #228 added
   it WITHOUT bumping `version:` (still 0.5.0), so a pre-#228 install looks
   current but 404s the endpoint — reinstall via `scripts/deploy-plugin.sh
   github-sync-plugin`. (Always bump `version:` on manifest changes.)
3. **Plugin config carries `appWebhookSecret`** (generate high-entropy, store in
   1Password, set via config) — plus per-bridge `defaultAssigneeAgentId`
   (GOL-80; unassigned mirrors are never picked up by heartbeat) and optional
   `opsWebhookUrl` for a Discord ping per mirror.
4. **App settings** (github.com → Settings → Developer settings → GitHub Apps →
   AgenticOS Developer): Webhook **Active**, URL =
   `https://paperclip.gatheringatthegrove.com/api/plugins/<plugin-id>/webhooks/github-app`,
   Secret = the same `appWebhookSecret`, **Subscribe to events → Issues**.
   Symptom when broken: `gh api orgs/<org>/installations` shows `events=[]`.
5. **Installation coverage = All repositories on BOTH orgs**
   (`EngineeringMoonBear` + `Goldberry-Playground`) so new repos are observed
   automatically with zero setup.

**Verify end-to-end:** open an issue in a repo with NO per-repo workflow → it
mirrors into the bridge's project (or logs "repo not in a synced bridge" for
unbridged repos). **Ongoing:** App → Advanced → Recent Deliveries is ground
truth (redeliver failures; GitHub auto-disables webhooks that fail
persistently — a broken CF policy will eventually mute the App silently).

## Loop prevention (the contract — all pieces must agree)

- The **plugin** stamps GitHub issues it creates with the label `synced-from-paperclip` and a body marker `<!-- synced-from-paperclip: <paperclip-id> -->`.
- The plugin's **`onWebhook`** stamps the Paperclip issues it creates with a description marker `<!-- synced-from-github: <repo>#<number> -->` (and records the mapping with `origin=github` up front).
- The plugin's `issue.created` handler **skips outbound** when it sees the `synced-from-github` marker (records the mapping instead).
- The workflow's `if:` **skips inbound** for GitHub issues carrying the `synced-from-paperclip` label.
- A `github_sync_mapping` table in the plugin DB (`paperclip_issue_id ↔ repo#number`, with `origin`) is the durable source of truth — an already-mapped GitHub issue is never re-created (idempotent redelivery via `getByRepoNumber`).

Mirroring stays scoped to configured projects: the outbound handler drops issues whose project isn't a bridge, and `onWebhook` drops payloads whose `repo` isn't a bridge — so unrelated work (e.g. QA-triage issues in other projects) is never synced.

## Closure propagation — issues close as PRs merge (GOL-149)

The goal: an agent PR that merges with a `Closes #N` keyword closes the GitHub
issue natively, and the Paperclip mirror reflects `done` within one sync cycle,
with **no bounce**. Both directions of state are handled:

- **Paperclip → GitHub**: `issue.updated` → `statusToGithubState` (`done`/`cancelled` → `closed`, else `open`). Already the outbound leg.
- **GitHub → Paperclip**: the App webhook's `issues` `closed`/`reopened` action → `handleAppClosure`. It looks up the mirror via `getByRepoNumber`, then `resolveMirrorClosureStatus(action, currentStatus)` decides the write: `closed` → `done` (unless already terminal), `reopened` → `todo` (only if terminal). Unmapped issues are ignored — closure only touches issues that already have a mirror.

**Why it doesn't loop.** `resolveMirrorClosureStatus` returns `null` when the
mirror already matches, so the round trip settles in one cycle:

1. Paperclip issue → `done` ⟶ outbound pushes GitHub `closed`.
2. GitHub emits a `closed` App-webhook event ⟶ `handleAppClosure` finds the mirror already `done` ⟶ no update ⟶ no `issue.updated` ⟶ **stop**.

The inverse (GitHub-first close of a Paperclip-origin twin) is symmetric: the
mirror flips to `done` once; the redundant outbound PATCH to an already-`closed`
GitHub issue is a no-op that emits no state-changing webhook.

**Repo-name normalisation.** Outbound rows record `github_repo` as the bare
bridge name (`grove-sites`) while the App webhook reports `owner/repo`
(`Goldberry-Playground/grove-sites`). `getByRepoNumber` normalises both sides to
the bare name (`regexp_replace(github_repo, '^[^/]+/', '')`), so a `Closes #N` on
a Paperclip-origin twin still resolves to its mirror. Without this the closure
lookup silently misses every outbound-created issue.

**Agent contract.** Every agent PR body carries `Closes #<github-issue-number>`
(the GitHub twin, not `GOL-N`) plus a `Paperclip: GOL-N` trace line — see
`docs/agent-house-rules.md`.

## Setup

### 1. Deploy the plugin (automatic)
Merging this lands `packages/github-sync-plugin` + its compose mount; the
`deploy-droplet-plugins` workflow builds + hot-reloads it on the Droplet. It
starts **INACTIVE** (no `paperclipProjectId`) until configured below.

### 2. GitHub auth — via the gh-token-broker (no PAT)
The plugin does **not** use a stored token. It mints **repo-scoped GitHub App
installation tokens** from the `gh-token-broker` sidecar (the "AgenticOS Developer"
App) — the same path agents use to push/PR. Because the App is installed on **both
orgs**, one plugin can write to repos in `EngineeringMoonBear` *and*
`Goldberry-Playground` with no cross-org PAT.

Prerequisite: confirm the "AgenticOS Developer" GitHub App is **installed on both
orgs** with the synced repos selected and **Issues: read & write** granted. The
plugin reads the broker from `GH_TOKEN_BROKER_URL` (already in paperclip-server's
env); to avoid depending on env passthrough to plugin workers, set
`tokenBrokerUrl: "http://gh-token-broker:9099"` in the config below. (A static
`githubToken` is supported only as a fallback when no broker is reachable.)

### 3. Configure the plugin (Mac, tunnel up, board key)
**One** plugin instance carries **all** bridges — `pluginKey` is unique, so it
can't be installed twice. Set the bridges, the **company id** (needed for the
inbound leg — the public webhook has no actor), and an **inbound HMAC secret**
(shared with the workflow). Generate the secret once; it goes in BOTH the plugin
config and each repo's `PAPERCLIP_ISSUE_SYNC_SECRET`.
```bash
BK=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key")
BASE=http://localhost:3100
CID=6a74334e-9dd3-4491-8cd5-da418e970a2e
WHSEC=$(openssl rand -hex 32)   # inbound webhook secret — keep out of chat
gs_id=$(curl -sS "$BASE/api/plugins" -H "Authorization: Bearer $BK" \
  | jq -r '.[] | select(.pluginKey=="agenticos.github-sync-plugin") | .id')
cfg=$(jq -nc --arg cid "$CID" --arg sec "$WHSEC" \
  --arg p1 "<AGENTICOS_PROJECT_ID>" --arg p2 "<GOLDBERRY_PROJECT_ID>" \
  --arg fe "<FOUNDING_ENGINEER_AGENT_ID>" --arg ops "<DISCORD_OPS_WEBHOOK_URL>" \
  '{configJson:{
     companyId:$cid,
     inboundWebhookSecret:$sec,
     tokenBrokerUrl:"http://gh-token-broker:9099",
     opsWebhookUrl:$ops,
     bridges:[
       {githubOrg:"EngineeringMoonBear",  githubRepo:"AgenticOS",                paperclipProjectId:$p1, defaultAssigneeAgentId:$fe},
       {githubOrg:"Goldberry-Playground", githubRepo:"odoocker-goldberrygrove", paperclipProjectId:$p2, defaultAssigneeAgentId:$fe}
     ]
   }}')
# defaultAssigneeAgentId is REQUIRED to close the auto-pickup loop (GOL-80): a mirror
# created without an assignee is never picked up (agents don't take unassigned work).
# opsWebhookUrl is optional — a Discord webhook that gets a ping on each mirror creation.
curl -sS -X POST "$BASE/api/plugins/$gs_id/config" -H "Authorization: Bearer $BK" \
  -H "Content-Type: application/json" -d "$cfg" >/dev/null && echo "configured"
printf '%s' "$WHSEC" | pbcopy   # secret on clipboard for the repo secret; do NOT paste it into chat
# Config saves don't restart the worker → disable/enable so setup + webhook registration take effect:
curl -sS -X POST "$BASE/api/plugins/$gs_id/disable" -H "Authorization: Bearer $BK" >/dev/null
curl -sS -X POST "$BASE/api/plugins/$gs_id/enable"  -H "Authorization: Bearer $BK" | jq '{status}'
```
(Confirm the Goldberry repo name; `odoocker-goldberrygrove` is the example.)

### 3a. Scope-expiry REST fallback bearer — MUST be the board key (GOL-323 / GOL-781)
The inbound scope-expiry REST fallback (`paperclip-rest.ts`, GOL-323) retries a
dropped `ctx.issues.*` write against the public Paperclip REST API authenticated
with `paperclipApiToken`. That token's actor is subject to Paperclip's
**per-actor authorization boundary**: a PATCH/create/comment on an issue outside
the actor's boundary returns `403 "Issue is outside this actor's authorization
boundary"` and the inbound write is **lost**.

Because synced issues are continuously **reassigned to discipline owners** across
all four bridges, no narrow/per-project actor can cover them. Empirically
(GOL-781) both the old `github_sync_rest_bearer` and `paperclip_bridge_key`
service tokens **403** on reassigned issues; only the **company-scoped board key**
(`op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key`) returns
`200`. So:

> **`paperclipApiToken` MUST be set to the board key** (`paperclip_board_key`),
> the same credential §3 uses for the config POST. Do **not** point it at a
> per-agent or per-project token — the fallback will silently 403 (~195
> lost inbound writes/day, GOL-781).

Set it in the §3 config POST, e.g. add `paperclipApiToken:$BK` to the `configJson`
(where `BK` is the board key already loaded). Least-privilege note: the board key
carries plugin/agent admin beyond issue writes; it lives in the plugin config
store (non-`secret-ref`, plaintext — same as every other secret here) within the
paperclip-server trust boundary. If Paperclip later ships a scoped
company-wide-issue-write service token, mint one and repoint `paperclipApiToken`
at it (tracked as the GOL-781 least-privilege follow-up).

### 4. Inbound leg = the plugin's public webhook (NO routine)
There is **no routine**. A routine run always dispatches an agent (`Default agent
required`) — it can't just create a mirror issue, and on the Odoocker bridge it
would double-trigger the QA webhook. Instead the plugin declares a public,
board-auth-free webhook endpoint that creates the mirror issue directly:

```
POST https://paperclip.gatheringatthegrove.com/api/plugins/<gs_id>/webhooks/github-issue
```

`onWebhook` verifies `X-Hub-Signature-256` against `inboundWebhookSecret`, then
`ctx.issues.create`s the issue in the bridge whose repo matches the payload's
`repo` field, stamped with the `synced-from-github` marker (so the outbound
handler records the mapping and does **not** bounce it back). **One endpoint serves
both repos** — routing is by `repo`, so there's no per-repo endpoint or per-repo
routine.

### 5. Repo secrets + workflow (in EACH synced GitHub repo)
The inbound workflow `.github/workflows/issue-sync-to-paperclip.yml` lives in
AgenticOS already; **copy it into the Goldberry repo** too (it's generic — it just
POSTs the payload). Set these secrets in **each** repo (same values in both):

| Secret | Value |
| --- | --- |
| `PAPERCLIP_ISSUE_SYNC_WEBHOOK` | `https://paperclip.gatheringatthegrove.com/api/plugins/<gs_id>/webhooks/github-issue` |
| `PAPERCLIP_ISSUE_SYNC_SECRET` | the `inboundWebhookSecret` from §3 (identical in both repos + the plugin config) |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | reuse the QA service token — see the CF-Access gotcha below |

⚠️ **CF Access must be widened.** The QA service-token Access policy is path-scoped
to `/api/routine-triggers/public/*`. The plugin webhook lives under
`/api/plugins/*/webhooks/*`, so the workflow's service token will be **302'd to SSO
and fail** until the Access app/policy is extended to cover that path (update
`infra/terraform/cloudflare-qa-webhook.tf` to add the plugin-webhook path, or add a
second path-scoped policy for the same service token). Without this the inbound leg
can't be reached from GitHub Actions.

The workflow no-ops until these secrets exist.

## Verify
- **GitHub → Paperclip:** open a GitHub issue in the synced repo → within ~a minute a Paperclip issue appears in the synced project (description starts with the `synced-from-github` marker). It does **not** bounce back as a second GitHub issue.
- **Paperclip → GitHub:** create a native Paperclip issue in the synced project → a GitHub issue appears (label `synced-from-paperclip`). Closing the Paperclip issue (`done`/`cancelled`) closes the GitHub issue.
- **No loop:** the plugin-created GitHub issue (labeled `synced-from-paperclip`) does not trigger the inbound workflow; the `onWebhook`-created Paperclip issue (with the marker) does not trigger an outbound GitHub issue.

## Gotchas
- **One instance, many bridges, one inbound endpoint.** `pluginKey` is unique, so the plugin can't be installed twice — add bridges to the `bridges[]` config array. The **single** webhook endpoint `/api/plugins/:id/webhooks/github-issue` serves all repos (routing is by the payload's `repo`); each repo just needs the workflow + secrets pointing at it.
- **Cross-org auth = the GitHub App, not a PAT.** A fine-grained PAT is single-owner; the gh-token-broker mints repo-scoped App installation tokens for any org the App is installed on. Confirm the App is installed on **both** orgs with the synced repos selected.
- **QA double-trigger is avoided by scoping:** QA-triage issues live in a different project, so the plugin (filtered to each bridge's project) never mirrors them.

## Inbound id-drift protection (GOL-1394)

The inbound webhook URL embeds the github-sync plugin **id**, and a plugin
reinstall (delete+install — Paperclip's only update path) **rotates** that id.
The id lives in THREE places that must move together, or inbound silently severs:

1. the CF Access apps in `infra/terraform/cloudflare-qa-webhook.tf`
   (`var.github_sync_plugin_id`),
2. the **AgenticOS Developer** GitHub App webhook URL, and
3. the plugin install itself.

On 2026-08-12 only (3) moved for a window → GitHub deliveries `302`'d at the CF
edge and no GitHub-created issue reached the board. This failed **silently**:
the outbound hourly `mirror-reconcile` only covers board→GitHub. Two guards now
close that class:

- **Deploy-gate** — `scripts/deploy-plugin.sh` compares the live installed id
  against `var.github_sync_plugin_id` after a `github-sync-plugin` reinstall and
  **fails loudly** (default; `PLUGIN_ID_GATE=warn` downgrades) with the exact
  re-scope legs. So a sanctioned reinstall can't leave drift unnoticed.
- **Dead-man probe** — `scripts/inbound-deadman-probe.sh`, scheduled daily by
  `.github/workflows/inbound-webhook-deadman.yml`, replays a GitHub App `ping`
  (HMAC-signed, **no** CF service-token headers — exactly what GitHub sends) to
  the live webhook URL and asserts a plugin `200`. A `302` (edge severed) / `404`
  (id rotated) / timeout → alert to the Grove ops Discord. `ping` is ignored by
  the plugin (no board write, zero noise), so it's safe on a schedule.
  - Configure: repo **variable** `INBOUND_WEBHOOK_URL` (the URL set on the GitHub
    App) + secrets `GITHUB_APP_WEBHOOK_SECRET` (== the App webhook secret /
    plugin `appWebhookSecret`) and `DISCORD_WEBHOOK_URL` (already set). No-op
    until configured. Run with **Force fail** (workflow_dispatch input) to test
    the Discord alert path.
  - Limitation: a `200` proves the CF edge + host-accept are healthy for that id;
    it does not by itself prove async processing. The deploy-gate covers the
    "CF scoped to an id whose plugin was deleted" case. The durable elimination
    is the id-stable host route (GOL-1394 leg 1) — once that lands, point
    `INBOUND_WEBHOOK_URL` at the stable `/api/plugin-webhooks/github-sync/...`
    path and none of the three places ever need editing on a reinstall again.
