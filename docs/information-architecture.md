# AgenticOS Information Architecture

A living reference for the **dashboard's** information architecture — the global
shell, the five tabs, their components and data sources, and the cross-view
patterns that hold them together. It is kept current with the shipped 5-tab +
vista-shell dashboard, and every section carries a status badge so you can tell
at a glance what is real, what is half-built, and what is only sketched.

> **Status-badge legend**
>
> - **✅ Shipped** — wired to a real data source (Postgres, vault-server,
>   OpenViking, the runs log, or a real config file) and in use.
> - **🚧 WIP** — the component exists but renders placeholder/stub data, is not
>   yet wired to its real source, or is untracked / not-yet-landed.
> - **📋 Planned** — described here but not built (no component, or a button that
>   only fires a "coming in Phase N" toast).

**Out of scope for this doc** (pointers, not duplicated here):

- **Agent runtime, model routing, and the cost-telemetry pipeline** →
  [`docs/plans/spec1-orchestrator.md`](plans/spec1-orchestrator.md). The dashboard
  *displays* cost/health/runs; how runs are routed to models and how cost is
  metered lives there.
- **Memory architecture (vault-server + the inbox write surface)** →
  [`docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md)
  and
  [`docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md`](superpowers/specs/2026-06-01-inbox-write-surface-design.md).

**Last verified:** 2026-06-02 against shipped `main`.

---

## 1. Global Shell & Navigation

The shell is mounted once in `app/layout.tsx`: a persistent `SharedHeader`
(`components/shell/SharedHeader.tsx`) wraps every tab, with the `<main>` slot
rendering the active route. The `CommandPalette`, `PaletteHotkey`, and toast
`Toaster` are siblings of `<main>`, so they survive tab navigation.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS                          [Filter: All ▾]  [⌘K]  ⚙            │  SharedHeader row 1
│ Runs 3 │ Architecture 11 │ Cost $2.41 │ Health 2 warn │ Memory 1,652      │  TabBar
└──────────────────────────────────────────────────────────────────────────┘
   (per-tab Vista hero renders below, inside the routed page)
```

### Header row — brand, filter, palette, settings · ✅ Shipped

`SharedHeader` renders a left-anchored brand mark (`LanternMushroom`, links to
`/`) and a right-anchored utility cluster: the **FilterChip**, the **⌘K palette
trigger**, and a **settings cog** linking to `/settings`. Status chips that used
to live here have moved out to the KpiVista banner; the header itself is shipped
and stable.

### TabBar — five tabs · ✅ Shipped (nav) / 🚧 WIP (count badges)

`components/shell/TabBar.tsx` is the real navigation. Five tabs, each a real
Next.js `<Link>`, active state derived from `usePathname()`:

| Tab | Route | Count badge |
|---|---|---|
| Runs | `/runs` | `3` |
| Architecture | `/architecture` | `11` |
| Cost | `/cost` | `$2.41` |
| Health | `/health` | `2 warn` |
| Memory | `/memory` | `1,652` |

- **Navigation is ✅ Shipped** — links and active-tab highlighting work.
- **Count badges are 🚧 WIP** — every count is a hardcoded string in the `TABS`
  array (`count: "3"`, etc.), annotated in-code as "Phase 3.5.3 — wired to live
  data in Task 3.5.4." They are not yet reading live data.

### Mobile tab dropdown · ✅ Shipped (PR #126)

The same `TabBar.tsx` ships the responsive behavior: at `<768px` the horizontal
tab row is replaced by a dropdown selector that shows the active tab and expands
to a popover list (closes on outside-click and `Esc`). This is the shipped
mobile nav — note it lives in `shell/TabBar.tsx`, **not** the orphaned
`components/layout/header-tabs.tsx` (an old, untracked 3-tab nav — see the
Legacy appendix).

### KpiVista persistent banner · ✅ Shipped

`components/shell/KpiVista.tsx` is the "dusk navigator's console" — a persistent
banner mounted in `app/layout.tsx` (between `SharedHeader` and `{children}`)
above every tab, with four readings, gold horizon rules, an `EkgSweep`
background, and a live-data indicator. All four tiles read **real data** via
`lib/hooks/use-kpi-data.ts`, which fans out four fetches with `Promise.allSettled`
so each tile degrades **independently** (a failed source renders `—` with no
delta or sublabel; the banner never blanks):

| Tile | Source | Delta / sublabel |
|---|---|---|
| runs today | `/api/agent/runs?limit=200` → Σ runs started since UTC midnight | sublabel `subscription · no metered cost` (agents run on the flat-rate Claude Max plan → no per-token spend; surfaces `$X metered` only when non-zero) |
| active runs | `/api/tasks/queue-depth` → Σ queued+running (Paperclip heartbeat runs) | `+N` vs in-flight 1h ago (`finishedAt` window); sublabel = running kinds |
| vault files | `/api/vault/stats` → vault-server page index `pageCount` | "wiki pages indexed" |
| memories indexed | `/api/viking/scopes` → OpenViking `/api/v1/stats/memories` | scope categories; reachable-but-empty renders a real 0 |

The two deltas derive from existing columns (`calls.cost_cents`,
`tasks.started_at`/`ended_at`) — **no sample-history table or sampler** — so
"full backing" added zero new infrastructure. See
`docs/superpowers/specs/2026-06-03-kpivista-wire-and-land-design.md`.

### Per-tab Vista hero — `VistaShell` · ✅ Shipped (chrome) / mixed data

Every tab renders its own hero at the top via `components/shell/VistaShell.tsx`:
a dusk-indigo console panel with a tinted accent, a
`Runs · live as of HH:MM:SS` freshness chip (`AsOfChip`), gold horizon rules,
an animated topic backdrop, and a 4-tile KPI grid (`KpiTile`). The leading
scope word is required: every route renders this hero *and* the layout's
`KpiVista` banner, fed by a different query on a different interval, so each
chip has to name the data it speaks for (GOL-3099). The chrome is shipped;
whether a given hero's tiles are real depends on the tab:

| Vista | Tile data source | Status |
|---|---|---|
| `RunsVista` | `/api/tasks/stats`, `/api/tasks/recent-events`, next-cron (Postgres) | ✅ Shipped |
| `CostVista` | `buildStubBurndown()` — synthetic series | 🚧 WIP |
| `ArchitectureVista` | hardcoded tile literals ("11", "25 +8", …) | 🚧 WIP |
| `HealthVista` | hardcoded tile literals ("4 / 4", "5ms", "99.94%") | 🚧 WIP |
| `MemoryVista` | hardcoded tile literals | 🚧 WIP |

### Global filter chip · ✅ Shipped (persistence) / 🚧 WIP (tag source)

`components/filter/filter-chip.tsx` is a multi-select popover: a tag search
box, tags grouped by Projects / Lanes / Domains, a "Clear all", and a "+ New
tag" affordance.

- **Persistence is ✅ Shipped** — `lib/filter/use-filter.ts` syncs the selection
  to the URL `?filter=` param via `nuqs` (`history: "push"`, `shallow: false`),
  comma-encoded by `lib/filter/codec.ts`. URL is the single source of truth;
  back/forward and deep links restore state. No localStorage.
- **Tag source is 🚧 WIP** — the tag list is a hardcoded `TAGS` array, not
  derived from the vault; **"+ New tag" is disabled** (`title="Available in
  Phase 2"`).

### Command palette (⌘K) · ✅ Shipped (shell) / mixed data

`components/palette/command-palette.tsx` opens via the header trigger or the
`⌘K`/`Ctrl+K` hotkey (`palette-hotkey.tsx`; `Esc` closes). Four groups, with
cmdk fuzzy-matching and auto-hidden empty groups:

| Group | Source | Status |
|---|---|---|
| **Skills** | `SKILL_FIXTURES` (stub); selecting fires a "wires up in Phase 4" toast | 🚧 WIP |
| **Wiki Pages** | `useVaultTree()` → `/api/vault/tree` (real); navigates to `/memory?page=…` | ✅ Shipped |
| **Recent Runs** | `useRunFeed()` → `/api/agent/runs` (real); navigates to a run detail route | ✅ Shipped |
| **Quick Actions** | Open Settings ✅, Clear filter ✅; **Toggle theme** is a "Phase 6" toast 🚧 | mixed |

### Keyboard shortcuts · ✅ Shipped (limited)

Only **`⌘K` / `Ctrl+K`** (toggle palette) and **`Esc`** (close palette) are
actually bound, in `palette-hotkey.tsx`. The wider shortcut map from the old IA
(`⌘1`/`⌘2`/`⌘3` tab jumps, `⌘/`, `⌘F`, `⌘.`) is **📋 Planned** — not implemented.

### Notifications · ✅ Shipped

Toasts via `sonner` (`<Toaster position="bottom-right" />` in the layout).
Components fire `toast.info` / `toast.success` / `toast.error` directly (e.g.
settings save, palette stub actions). There is no notification bell or
tab-badge notification surface today.

## 2. Runs

The default landing tab and the live-ops surface. It absorbs the "live runs +
schedules + recent activity" content that the old single `/observability` view
used to carry. `app/runs/page.tsx` composes a `RunsVista` hero over a 12-column
grid of panels. Most run/task panels read **Postgres** through `/api/tasks/*`
and `/api/agent/runs`; a couple of supporting panels are still stubbed.

```text
┌──────────────────────────── RunsVista (hero) ───────────────────────────┐
├──────────────────────────────────────────────────────────────────────────┤
│ [ Live runs strip — running tasks, live elapsed ]                         │
│ ┌ Vault ingest ┐  ┌ Live runs ┐  ┌ Scheduled runs ┐                       │
│ ┌ Recent errors ─────────────┐                                            │
│ ┌ Run feed (full history) ──────────────────────────────────────────────┐│
└──────────────────────────────────────────────────────────────────────────┘
```

### RunsVista hero · ✅ Shipped

`components/shell/RunsVista.tsx` over `VistaShell`. Its activity-strip backdrop
and four KPI tiles read real data: `useRecentRunEvents(60)` →
`/api/tasks/recent-events`, `useRunsStats()` → `/api/tasks/stats`, and
`useNextCron()`. Both task routes query Postgres.

### Live runs strip · ✅ Shipped

`components/observability/live-runs-strip.tsx` — `useRunFeed({ status:
"running" })` → `/api/agent/runs`, ticking a live elapsed counter every second.
The run feed source is the `runs.jsonl` log (`AGENTICOS_RUNS_PATH`, default
`/var/log/agenticos/runs.jsonl`); it returns `[]` cleanly when the log is
absent.

### Run feed · ✅ Shipped

`LiveRunFeedSection` (`app/runs/live-run-feed-section.tsx`) wraps
`components/observability/run-feed.tsx`, which calls `useRunFeed({ limit: 50 })`
→ `/api/agent/runs`. The feed renders run cards (agent, status, timing).
**Note:** the section currently passes `filterActive={false}` and empty filter
tags — i.e. the global filter chip does **not** yet shape the run feed (a known
gap, not a regression).

### Live runs panel · ✅ Shipped

`components/observability/LiveRunsPanel.tsx` — `/api/tasks/active` (Postgres),
refetched every 5s. Surfaces currently-running tasks with a live elapsed
counter and a "stuck" heuristic (>5m runtime or >60s without a heartbeat). The
cancel button issues `DELETE /api/tasks/{id}`.

### Recent errors panel · ✅ Shipped

`components/observability/RecentErrorsPanel.tsx` — `/api/tasks/recent-errors`
(Postgres: `SELECT … FROM tasks WHERE status = 'failed' … LIMIT 20`). Each row
has a retry button → `POST /api/tasks/{id}/retry`.

### Scheduled runs panel · 🚧 WIP

`components/observability/ScheduledRunsPanel.tsx` reads `/api/tasks/scheduled`,
but that route returns a **hardcoded** job list (`vault-ingest`, `cost-report`,
`daily-brief`) with a `TODO: wire to real scheduler (crontab / queue)`. The
"trigger now" button posts to a stub endpoint that returns `501`. The intended
real source is the Hermes cron schedule.

### Vault ingest panel · 🚧 WIP

`components/observability/VaultIngestPanel.tsx` reads `/api/ingest/recent`,
which returns **hardcoded** sample ingest runs (`TODO: wire to vault-ingest run
history`). (The sibling `/api/ingest/status` *is* Postgres-backed, but this
panel does not use it.)

### Run detail · ✅ Shipped (route)

Runs link to a detail route (`/observability/run/{id}` today; the command
palette and panels navigate there). The single-task API `/api/tasks/{id}` is
Postgres-backed. The richer logs/timeline/usage drawer described in the old IA
is not fully built out — treat the multi-tab drawer anatomy as **📋 Planned**.

## 3. Architecture

The skill catalog — "buttonize your workflows." `app/architecture/page.tsx`
renders an `ArchitectureVista` hero, a page header with a "+ New Skill" button,
a domain filter rail, and a responsive grid of `SkillCard`s.

```text
┌─────────────────────── ArchitectureVista (hero) ────────────────────────┐
├──────────────────────────────────────────────────────────────────────────┤
│ Architecture                                              [ + New Skill ] │
│ [All] [Farm] [Software] [Marketing] [Video] [Personal]                    │
│ ┌ SkillCard ┐ ┌ SkillCard ┐ ┌ SkillCard ┐                                 │
│ ┌ SkillCard ┐ ┌ SkillCard ┐ …                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

### ArchitectureVista hero · 🚧 WIP

`components/shell/ArchitectureVista.tsx` over `VistaShell`, with a
`SkillGalaxyBackdrop`. All four KPI tiles are **hardcoded literals**
("11 registered skills", "25 dispatched today", "Farm (5) top domain", …) — no
data hook. 🚧.

### Skill catalog (SkillCard grid) · 🚧 WIP

The grid maps over `SKILL_FIXTURES` (`lib/fixtures/skills.ts`), **not**
`/api/vault/skills`. So although a real, vault-server-backed skills endpoint
exists (and the **Memory** tab's Skills panel uses it — see §6), the
Architecture grid still renders static fixture data. Each `SkillCard` shows
icon/title, description, tags, "Last run · NN% success", and a Run button — but
the **Run button only fires a `toast.info("Dispatching wires up in Phase 4")`**.
So: card rendering 🚧 (fixtures), dispatch 📋 Planned.

> When this grid is repointed at `/api/vault/skills` (the
> `SkillEntry { name, description, triggers, usedBy, path }` shape from
> vault-server's `wiki/Skills`), it becomes ✅.

### Domain filter rail · ✅ Shipped (interaction) / 🚧 WIP (counts)

The `[All] [Farm] [Software] …` rail toggles the global `?filter=` tags via
`useFilter()`, and the grid filters fixtures by tag intersection in-memory —
that interaction works. The rail does not show real per-domain counts (the
fixture set is static).

### Empty state · ✅ Shipped

When the active filter matches no skills, the grid shows a centered "No skills
match this filter" with a "Clear filter" action. The richer "create your first
skill" onboarding empty state from the old IA is **📋 Planned**.

### New Skill creation · 📋 Planned

"+ New Skill" fires `toast.info("Skill creation available in Phase 2")`. The
three-step template/metadata/prompt flow from the old IA is not built.

## 4. Cost

Spend visibility. `app/cost/page.tsx` renders a `CostVista` hero over a grid of
panels: burndown, projection, rate limits, and the two provider panels (OpenAI
Codex, Ollama). The reasoning provider is **`openai-codex`** — the Codex panel
reflects that spend. **Only the burndown reads real cost telemetry today; the
rest are stubbed.** For how cost is actually metered and how runs are routed to
models, see the runtime spec (`docs/plans/spec1-orchestrator.md`) — that
pipeline is out of scope here.

### CostVista hero · 🚧 WIP

`components/shell/CostVista.tsx` uses a `BurndownProjectionBackdrop` driven by
`buildStubBurndown()` — a synthetic in-component series, not real spend. 🚧.

### Cost burndown chart · ✅ Shipped

`components/observability/CostBurndownChart.tsx` → `/api/cost/burndown`, which
runs a real Postgres aggregation over the `calls` table
(`SUM(cost_cents)` bucketed by hour/day for a `24h`/`30d` range). This is the
one Cost panel wired to real telemetry.

### Cost projection panel · 🚧 WIP

`components/observability/CostProjectionPanel.tsx` → `/api/cost/projection`,
which returns **hardcoded** figures (`spend_usd: 47.74`, `cap_usd: 200`, …) with
a `TODO: derive from real spend history + cap config`.

### OpenAI Codex panel · 🚧 WIP

`OpenAICodexPanel.tsx` → `/api/cost/models/openai` — **hardcoded** model usage
rows (`gpt-5-codex`, `gpt-4o-mini`) with a `TODO: wire to real OpenAI usage
telemetry`.

### Ollama panel · 🚧 WIP

`OllamaPanel.tsx` → `/api/cost/models/ollama` — **hardcoded** local-model rows
(`nomic-embed-text`, `qwen2.5:3b`) with a `TODO: wire to real Ollama metrics
endpoint`.

### Rate limits panel · 🚧 WIP

`RateLimitsPanel.tsx` → `/api/cost/rate-limits` — **hardcoded** TPM/RPM lines
with a `TODO: wire to real upstream rate-limit telemetry (OpenAI usage
headers)`.

## 5. Health

A tab the old IA didn't have — system and service health at a glance.
`app/health/page.tsx` renders a `HealthVista` hero over four panels: agent
health, system resources, external services, and backups. **All four panels
read stub routes today** — the Health tab is the least-wired tab.

### HealthVista hero · 🚧 WIP

`components/shell/HealthVista.tsx` — KPI tiles are hardcoded literals
("4 / 4 services up", "5ms avg latency", "99.94% uptime", "none last
incident"). No data hook. 🚧.

### Agent health panel · 🚧 WIP

`components/observability/AgentHealthPanel.tsx` → `/api/health/services`, which
returns a **hardcoded** service list (`Hermes Gateway`, `OpenViking`, `Ollama`,
`Postgres`, all `ok`) with a `TODO: wire to real backend`. Note real
reachability probes already exist elsewhere — `/api/agent/health` (Hermes) and
`/api/viking/health` (OpenViking, reads `OPENVIKING_URL`) — but this panel does
not consume them yet.

### System resources panel · 🚧 WIP

`SystemResourcesPanel.tsx` → `/api/health/resources` — **hardcoded** CPU/RAM/disk
percentages with a `TODO: wire to real backend (Droplet health endpoints)`.

### External services panel · 🚧 WIP

`ExternalServicesPanel.tsx` → `/api/health/external` — stub.

### Backups panel · 🚧 WIP

`BackupsPanel.tsx` → `/api/health/backups` — stub.

## 6. Memory

> **Two brains — and the Memory tab is only one of them.**
>
> - **The human brain** is the Obsidian vault, served by **vault-server on
>   :7779** and surfaced to the dashboard through `/api/vault/*`. **This is the
>   Memory tab.** Everything in this section reads that vault.
> - **The agent brain** is **OpenViking on :1933** (agent memory /
>   observability). It feeds the Runs/Cost/Health KPIs — it is **not** the Memory
>   tab. The Memory page comment makes this explicit: "OpenViking agent-obs
>   intentionally excluded here."
>
> For the vault-server contract and the inbox write surface, see the
> [corrective design](superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md)
> and the
> [inbox write-surface spec](superpowers/specs/2026-06-01-inbox-write-surface-design.md).

`app/memory/page.tsx` renders a `MemoryVista` hero, two vault summary panels,
and a three-pane browser. The three-pane and summary panels are wired to
vault-server and are ✅ Shipped; the **inbox processing UI** is the one 🚧 piece.

```text
┌─────────────────────── MemoryVista (hero) ──────────────────────────────┐
├──────────────────────────────────────────────────────────────────────────┤
│ ┌ Skills catalog (vault) ┐   ┌ Recent vault changes ┐                     │
├──────────────────────────────────────────────────────────────────────────┤
│  Memory                                              [ sync indicator ]   │
│ ┌ Tree + Inbox ┐ │  Reader  /  Graph              │ ┌ Rail ┐             │
│ │ wiki/ folders │ │  rendered markdown            │ │ backlinks          │
│ │ Inbox (n) 🚧  │ │  [Open in Obsidian ↗]         │ │ outgoing · tags    │
└──────────────────┴────────────────────────────────┴──────────────────────┘
```

### MemoryVista hero · 🚧 WIP

`components/shell/MemoryVista.tsx` — KPI tiles are hardcoded literals (no data
hook). 🚧.

### Summary panels · ✅ Shipped

- **Skills catalog** (`SkillsCatalogPanel.tsx`) → `useVaultSkills()` →
  `/api/vault/skills`, which proxies vault-server's `wiki/Skills`. This is the
  real skills source (contrast with the Architecture grid in §3, which still
  uses fixtures).
- **Recent vault changes** (`RecentVaultChangesPanel.tsx`) →
  `/api/vault/recent-changes`, which proxies vault-server (`source: syncthing`).

### Three-pane browser · ✅ Shipped

- **Tree** (`MemoryTree.tsx`) → `useVaultTree()` → `/api/vault/tree`. Mirrors the
  `wiki/` folder structure; collapsible folders, leaf pages, dims pages whose
  tags miss the active filter.
- **Reader** (`MemoryReader.tsx`) → `useVaultPage()` → `/api/vault/page`. Renders
  the page markdown with an **"Open in Obsidian"** deep link
  (`obsidian://open?path=…`). Editing is intentionally **not** in the dashboard —
  all wiki edits go through Obsidian (concurrent-write safety; the cloud mount
  is read-only for `wiki/`).
- **Rail** (`MemoryRail.tsx`) → `useVaultPage()` + `useVaultBacklinks()` →
  `/api/vault/backlinks`. Shows backlinks, outgoing links, and frontmatter tags
  (tags are clickable → update the global filter).
- **Graph** (`GraphCanvas.tsx`) — toggled from the reader; builds a node graph
  from real vault pages (`/api/vault/tree` + `/api/vault/page`). A navigation
  aid, not a full Obsidian-grade explorer.
- **Sync indicator** (`MemorySyncIndicator.tsx`) → `useVaultStats()` +
  `useVaultRevalidate()` (`/api/vault/stats`, `/api/vault/revalidate`).

### Full-text search · ✅ Shipped (route)

`/api/vault/search` is vault-server-backed (`store.search(q, { tags, limit })`)
and supports a tag filter. (The command palette's Wiki group is the most visible
consumer today; an in-pane search box is the natural next surface.)

### Inbox model — discard vs. promote · 🚧 WIP (UI), ✅ Shipped (API + components)

This is the heart of the write model, and it is **deliberately asymmetric**:

- **Discard is the one sanctioned dashboard write.** It archives
  `inbox/ → inbox/archived/` via `POST /api/vault/inbox/discard`
  (`store.discardInbox`, returns `204`). The cloud may write **only** under
  `inbox/`; `wiki/` is read-only.
- **Promote is human-applied in Obsidian — the dashboard never writes the
  wiki.** `POST /api/vault/inbox/promote` reads the inbox note, builds a vault
  flat-index + tag list, and calls Sonnet to **draft** a proposal
  (`{ destination, title, tags, body, confidence, reasoning }`). The
  `PromoteReviewDrawer` shows that draft and hands off via an
  `obsidian://open?vault=vault&file=inbox/…` deep link; **the human applies the
  promote inside Obsidian.** No server-side wiki write happens.

**Status nuance:** the inbox **API routes, hooks** (`use-discard-inbox`,
`use-promote-inbox`, `use-inbox-list`, `use-commit-inbox`) **and components**
(`InboxQueue.tsx`, `PromoteReviewDrawer.tsx`) are all shipped. But the live
Memory page does **not** mount them yet — the inbox section lives inside
`MemoryTree` and currently fires a `toast.info("Inbox queue coming in Phase E —
Promote and discard will be wired up")`. So the discard/promote *flow* is 🚧
until that wiring lands; the underlying surfaces are real.

### Vault vs. Obsidian — when to use which · ✅ (reference)

| Task | Use |
|---|---|
| Quick read / browse the wiki | Memory tab |
| Triage the inbox (discard) | Memory tab (once inbox UI lands) |
| Promote an inbox note into the wiki | Dashboard drafts → **apply in Obsidian** |
| Edit or create a wiki page | Obsidian |
| Full graph exploration | Obsidian |
| Quick backlinks / outgoing-link check | Memory tab |
| Deep search with complex queries | Obsidian |

## 7. Cross-View Patterns

### Two-brain separation · ✅ Shipped (architectural invariant)

The single most important cross-view rule (restated from §6): **OpenViking
(:1933) feeds the Runs / Cost / Health agent-observability surfaces; the
Obsidian vault (vault-server :7779) is the Memory tab.** They are different
brains with different stores and must not be conflated. The Memory page enforces
this by intentionally excluding OpenViking agent-obs from its panels.

### Filter persistence · ✅ Shipped

The global filter is URL state, not a store. `lib/filter/use-filter.ts` reads
and writes `?filter=` via `nuqs` (push history, non-shallow), encoded by
`lib/filter/codec.ts`. URL is the single source of truth — deep-linkable,
back/forward-correct, no localStorage. (The filter is consumed by the
Architecture grid and Memory tree/rail; it does **not** yet shape the Runs feed
— see §2.)

### Search semantics · ✅ Shipped (palette) / 🚧 WIP (in-pane)

The ⌘K palette searches skills (fixtures), wiki pages (real `/api/vault/tree`),
and recent runs (real `/api/agent/runs`) with cmdk fuzzy matching. A dedicated
vault search route (`/api/vault/search`, real) exists for a richer in-pane
Memory search; that surface is still to be wired (🚧).

### Notifications · ✅ Shipped

Bottom-right `sonner` toasts, fired directly by components. No bell, no
tab-badge notification count. Several toasts are intentionally "coming in Phase
N" placeholders (skill dispatch, theme toggle, inbox).

### Real-time updates · mixed

There is no single global event bus. The reality is two mechanisms:

- **Polling (the common case)** — panels and feeds use TanStack Query
  `refetchInterval` (e.g. live runs every 5s, scheduled/errors/ingest every
  30s, KPI 30s). ~26 query sites across the app.
- **SSE (run-detail only)** — `lib/hooks/use-run-events.ts` opens an
  `EventSource` against `/api/agent/runs/{id}/events` to stream a single run's
  events. This is the only Server-Sent-Events consumer; the broad
  `/api/events` stream described in the old IA does not exist.

## 8. Settings

`/settings` is a **full page** (`app/settings/page.tsx`), not a modal. It
server-reads the config via `readConfig()` (falling back to `DEFAULT_CONFIG`
with an inline error banner) and renders `components/settings/SettingsForm.tsx`.
Saving `POST`s the whole config to `/api/config`, with field-level validation
errors surfaced as toasts. Persistence is **✅ Shipped** (real config file).

The form exposes exactly four sections plus Save:

| Section | What it does | Status |
|---|---|---|
| **Project Roots** | Add/remove project roots, each with a path + tag list | ✅ Shipped |
| **Vault Path** | Single vault path field | ✅ Shipped |
| **Model Defaults** | Default model pick (Claude Haiku/Sonnet/Opus, plus GPT-5-mini / Kimi / GLM) | ✅ Shipped |
| **Connectors** | Per-connector enable toggle (farmOS, Odoo, Ghost, Asana, Slack, GitHub) | ✅ Shipped |

For *how* model selection actually drives routing and cost, see the runtime spec
(`docs/plans/spec1-orchestrator.md`) — the dashboard only persists the
preference.

**Removed from the old IA** (no longer in the settings UI): the local-daemon
settings block, the per-task model-routing table (now runtime-spec territory),
connector base-URL/auth detail panels, an appearance/theme section, and the
data/backups/export section. Theme toggling is a "Phase 6" palette placeholder
(§1).

## 9. Mobile

The dashboard is desktop-primary but the shell and the heaviest tab are
responsive today.

### Shipped

- **Tab dropdown** (✅, PR #126) — below 768px the `TabBar` collapses its
  horizontal tabs into a dropdown selector (active tab + count, expanding to a
  popover list; closes on outside-click / `Esc`). See §1.
- **Memory sidebar drawer** (✅) — on the Memory page the wiki tree becomes an
  off-canvas drawer toggled by a hamburger button, with a tap-to-dismiss
  backdrop (`memory-sidebar--open`). Selecting a page closes it.
- **Responsive vista + panel grids** (✅) — the `VistaShell` heroes and the
  12-column panel grids on Runs / Cost / Health reflow to single-column at
  narrow widths via their `col-span` breakpoints.

### Deferred / not mobile-tuned

- Settings editing, skill editing/creation, and graph exploration remain
  desktop/Obsidian workflows.
- Voice-capture-to-inbox (a mobile-first idea in the old IA) is **📋 Planned** —
  there is no capture endpoint or UI today.

## 10. ASCII Wireframes

Redrawn for the shipped 5-tab + per-tab Vista shell. (The persistent KpiVista
banner is omitted — it is not yet mounted; see §1.)

### Global shell + Runs tab

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS                              [Filter: All ▾]  [⌘K]  ⚙          │
│ [Runs 3] Architecture 11  Cost $2.41  Health 2 warn  Memory 1,652           │
├────────────────────────────────────────────────────────────────────────────┤
│ ░░ RunsVista — Runs · live as of 14:42:03 ░░  [tiles: real /api/tasks/*]   │
├────────────────────────────────────────────────────────────────────────────┤
│ LIVE  [▶ curator 2m12s] [▶ daily-brief 45s]              (live-runs-strip)  │
│ ┌ Vault ingest 🚧 ┐  ┌ Live runs ✅ ┐  ┌ Scheduled runs 🚧 ┐                 │
│ ┌ Recent errors ✅ ───────────────┐                                          │
│ ┌ Run feed ✅ (filter not yet applied) ──────────────────────────────────┐  │
│ │ ● curator        running   2m12s · …                                    │  │
│ │ ✅ daily-brief    done      4m12s · …                                    │  │
│ │ ❌ vault-ingest   failed    0m43s · …                  [Retry]           │  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Memory tab (three-pane)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS │ Runs Architecture Cost Health [Memory] │ [Filter ▾] [⌘K] ⚙   │
├────────────────────────────────────────────────────────────────────────────┤
│ ░░ MemoryVista 🚧 ░░     ┌ Skills (vault ✅) ┐  ┌ Recent changes ✅ ┐        │
├────────────────────────────────────────────────────────────────────────────┤
│ Memory                                                  [ sync ✅ ↻ ]        │
├──────────────────┬──────────────────────────────────┬──────────────────────┤
│ WIKI TREE ✅      │  PAGE READER ✅                  │ BACKLINKS ✅          │
│ ▼ wiki/          │  # Page Title                    │ ← N pages link here  │
│   ├ Farm         │  [rendered markdown]             │                      │
│   └ Software     │                                  │ OUTGOING LINKS ✅     │
│ ─────────────    │                                  │ → links              │
│ INBOX (n) 🚧     │                                  │ TAGS (→ filter) ✅    │
│  (discard/promote│  [Open in Obsidian ↗]            │                      │
│   wiring: Phase E)│                                 │                      │
└──────────────────┴──────────────────────────────────┴──────────────────────┘
```

## Appendix: Legacy / Removed

Recorded so the divergence between this doc and stray code/history is explicit.

### `/observability` route — dead landing page removed; subroutes retained

The dead top-level `app/observability/page.tsx` landing page has been
**removed**. Its old "live runs + schedules + metrics" responsibilities were
split into the **Runs**, **Cost**, and **Health** tabs, and nothing linked to
the landing page itself.

Two subroutes **remain as live destinations** (they are linked from the shipped
tabs, so they are *not* orphaned):

- `app/observability/run/[id]/` — the run-detail view, linked from the run feed
  (`run-card.tsx`, `live-runs-strip.tsx`) and the ⌘K command palette. Its
  back-link now points to `/runs` (was `/observability`).
- `app/observability/schedules/` — linked from `metrics-sidebar.tsx`.

Eventually rehoming these under `/runs/{id}` and `/runs/schedules` would let the
`/observability/` segment retire entirely, but that is a larger routing change
left for later.

The old, untracked 3-tab nav `components/layout/header-tabs.tsx` and
`components/layout/header.tsx` (superseded by `shell/TabBar.tsx` /
`shell/SharedHeader.tsx`) have also been **removed**.

### Removed Memory UI (OpenViking-premise)

An earlier Memory UI built around an agent-memory browsing premise
(category-browser / abstract-list / detail-view / retrieval-trajectory-graph
style components) was **deleted**. The shipped Memory tab is the vault-driven
three-pane in §6. The two-brain split (OpenViking = agent obs, *not* the Memory
tab) is the reason that UI was retired.

### Relocated: model-routing strategy

The old §7 "Model Routing Strategy" (task taxonomy, model tiers, routing table,
cost guardrails, telemetry feedback loop) was **agent-runtime configuration, not
dashboard IA**. It has been relocated to the runtime spec
(`docs/plans/spec1-orchestrator.md`). This doc keeps only the dashboard surfaces
that *display* the results (the Cost tab, the Settings "Model Defaults" pick).

### Retired front-matter banner

The previous "PARTIALLY STALE" holding banner at the top of this doc is gone —
this rewrite is the current reference, and status is now tracked per-section via
the badge legend rather than via a global warning.
