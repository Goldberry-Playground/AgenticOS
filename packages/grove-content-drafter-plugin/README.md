# @agenticos/grove-content-drafter-plugin

Paperclip plugin implementing the **grove-content-drafter** routine (GOL-2384/C,
GOL-2424).

The drafting LLM call runs inside a Paperclip **agent** (CMO - Sora) on the
Claude subscription — the plugin holds **no** metered Anthropic key (GOL-2424,
Option A). The plugin owns Odoo and the coordination; the agent writes the copy.

## How it works

**1. Request** (`content-draft-request`, every 15 min) — for each `product.template`
in Odoo whose `grove_draft_state = 'requested'` (up to `maxDraftsPerRun`), the
plugin opens one Paperclip issue assigned to the drafting agent. The issue body
carries the system + product brief and a strict JSON output contract. Idempotency
is two-layered: a product-scoped `originId` (`pt#<id>`) means never a second
*open* request per product, and a per-product drafted-version marker
(`product.template#<id>@<write_date>`) means never redoing a product+version
already drafted. Edit the product → new `write_date` → it is re-drafted.

**2. Receive** (`issue.comment.created` event, company-wide) — when the agent
replies with a fenced ```json block, the plugin validates + sanitises it and (unless
`dryRun`) writes back:

- `description_ecommerce` — 2–3 short storefront paragraphs
- `website_description` — a care guide (site & soil, planting, first-year care,
  pruning, harvest), stating mature spread / pollination / years-to-fruit when
  known (GOL-2544)
- any still-empty **required char facts** (`grove_soil`, `grove_spacing`,
  `grove_mature_size`, `grove_mature_spread`, `grove_pollination`,
  `grove_years_to_fruit`, `grove_chill_hours`) — only with a cited http(s)
  extension-service source, stamped in provenance as `{source: "agent", ref: url}`

It then posts the sources note, sets `grove_draft_state = 'drafted'`, leaves
`grove_facts_reviewed` **false** for human review, and closes the request issue.
An invalid/missing reply gets the exact validation error commented back (waking
the agent) up to a retry cap, then the request is marked blocked — **never**
partial content.

**2b. Sweep** (`content-draft-sweep`, every 20 min) — a reliability backstop:
events deliver deltas and can be missed, so the sweep re-applies any reply the
event dropped, re-pings an overdue request once, then gives up (blocks it).

### Host invocation-scope denials (GOL-2927 → GOL-3352)

A scheduled job dispatch carries no `companyId`, so the host registers **no**
invocation scope for it — and then fails *closed* on every company-scoped
worker→host call whenever any other scoped invocation for this same plugin is
registered. For this plugin that competitor is its own company-wide
`issue.comment.created` subscription — and (GOL-3352) the host delivers events
as fire-and-forget notifications whose scope is registered for a **fixed
15-minute TTL** (`MAX_RPC_TIMEOUT_MS`) with nothing to clear it on completion.
So every delivered comment event blocked *all* of the plugin's scheduled host
calls for 15 minutes, however fast the handler finished: ~18% of sweep ticks
lost over a week, 4-hour streaks on busy days. The GOL-2927 retry (~16 s over
7 attempts) could only win if a tick landed in the TTL's final seconds — 1
recovery in 563 ticks.

Fix (`src/worker.ts`, `src/sweep-gate.ts`, GOL-3352) — **event-driven sweep**:
the event handler is the one dispatch that *does* hold a valid scope (the SDK
runs it inside an `AsyncLocalStorage` carrying the invocation, so every host
call awaited from it is stamped with the event's id). After `processReply`, the
handler now runs the full sweep under that scope (`content-drafter: event sweep
complete` in the logs). The scheduled `content-draft-sweep` keeps running for
quiet windows; when its (now 2-attempt) scope retry is exhausted it logs
`content-draft-sweep skipped: invocation scope held by a concurrent event` and
returns normally — busy windows are by definition windows with events, each of
which sweeps, so nothing is lost. A `SweepGate` serialises the two entry points
(one running, at most one queued, extra requests coalesced). A per-issue scope
denial inside a scheduled sweep is counted as `SweepSummary.scopeDenied`, not
`errors`, for the same reason. Retrying is safe even for writes because the
denial is a pure pre-flight gate in the SDK's `gated()` wrapper, so a denied
call performed no work.

Acceptance check: `python3 -I scripts/ops/verify-drafter-scope-fix.py` (repo
root) must print `RESULT: PASS` over a busy window. The real fix is upstream in
closed-source `@paperclipai/server`: derive a scope for `runJob` and
`handleWebhook`, ack notification completion so the host can `clearInvocation`,
or stop failing closed for dispatches that never had a scope.

Typed/facet-driving facts (USDA zones, sun, layer) are **never** agent-filled —
they come from the USDA fetch step (GOL-2383/B) and human review. All Odoo writes
stay in the plugin; the agent gets no Odoo credentials. HTML output is restricted
to the grove-sites guide allow-list (`p, h2, h3, ul, ol, li, strong, em, a[href]`);
the storefront re-sanitises on render (defense in depth).

## Configuration (plugin instance config — never committed)

| key | required | notes |
| --- | --- | --- |
| `odooBaseUrl` | ✓ | e.g. `https://odoo.qa.gatheringatthegrove.com` (QA first) |
| `odooDb` | ✓ | default `odoo` |
| `odooUsername` | ✓ | the **Content Drafter** service user (group `grove_headless.group_content_drafter`) |
| `odooPassword` | ✓ | vaulted Content Drafter credential — plain field, set from 1Password, never committed |
| `companyId` | ✓ | UUID of the company owning the products + request issues |
| `groveProjectId` | ✓ | UUID of the project the request issues are filed under |
| `drafterAgentId` | ✓ | UUID of the drafting agent (default: CMO - Sora) |
| `houseRules` | | authoritative editorial rules from the vault (e.g. juglone stance) |
| `maxDraftsPerRun` | | default `5` — bounds shared subscription quota |
| `replyTimeoutHours` | | default `12` — before the sweep re-pings, then gives up |
| `dryRun` | | **defaults `true`** — validates + logs but does not write Odoo; Josh flips off to go live on QA |
| `unusedSecretRef` | | reserved; leave empty (scopes the config secret-ref extractor — see `manifest.ts`) |

The Content Drafter Odoo user is provisioned separately (GOL-2424 step 1). The
plugin instance config is set by Josh's Claude Code session from 1Password. Point
the routine at QA first; prod only after Josh's explicit go.

## Develop

```bash
pnpm --filter @agenticos/grove-content-drafter-plugin test       # vitest
pnpm --filter @agenticos/grove-content-drafter-plugin typecheck
pnpm --filter @agenticos/grove-content-drafter-plugin build      # rebuild dist/ (committed)
```

Rebuild `dist/` after editing `src/` — the committed bundle is what the Droplet
bind-mounts (plugins are not built on the Droplet).
