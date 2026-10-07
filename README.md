# AgenticOS

One pane of glass for an autonomous AI agent fleet — observability, memory, cost, scheduling — built for the agent-runtime ecosystem of 2026.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status](https://img.shields.io/badge/status-implementing--v1-blue)
![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%C2%B7%20pnpm%20%C2%B7%20Turborepo-black)

## What it is

AgenticOS is the orchestration dashboard for a single-developer agent fleet. It surfaces what your agents are doing, what they've learned about you, how much they're costing, and when they'll next run.

The architecture is intentionally a composition of best-in-class components rather than a monolith:

AgenticOS runs a **two-brain memory model** — a human brain and an agent brain, kept deliberately separate:

- **Human memory (the vault)** — an Obsidian-format vault on disk (`wiki/`, `+inbox/`, `+sources/`). Markdown files, wiki links, taxonomies. The vault is canonical human knowledge; Obsidian on the Mac is a read/write view of it via Syncthing — the Droplet never runs Obsidian itself. On the Droplet the vault lives at `/opt/vault` and is served by **vault-server** (Fastify, VPC `10.116.16.2:7779 → 7777`); the dashboard's **Memory tab** is a vault-driven three-pane browser reading it through `/api/vault/*`. This is the only memory surfaced in the Memory tab.
- **Agent memory / observability (OpenViking)** — [OpenViking](https://github.com/volcengine/OpenViking) (open-source context database by Volcengine / ByteDance) with filesystem-paradigm URIs (`viking://resources/…`, `viking://user/memories`, `viking://agent/skills`), L0/L1/L2 tiered loading, hybrid directory + semantic retrieval, and automatic memory extraction into 6 categories on session commit. OpenViking is exposed to Paperclip agents via the **openviking-plugin** (`@agenticos/openviking-plugin`), which wires the memory tools (`viking_remember`, `viking_recall`, `find`, `abstract`, …) natively. Viking runs on the Droplet (VPC `:1933`) and uses local Ollama for its own embedding + summarization pipelines. **OpenViking is the agent's working memory — it belongs to observability, not the Memory tab, and is not the vault.**
- **Agent runtime** — [Paperclip](https://github.com/paperclipai/paperclip) (MIT, open-source multi-agent runtime) is the **conductor**: heartbeat scheduling, issue→agent assignment, an adapter registry for multi-model switching, org charts, budget policies, approvals, and a plugin SDK. Agents run through **pluggable adapters** — `claude_local` (Claude, on the Max subscription), `codex_local` (OpenAI Codex), `opencode_local` (OpenCode, incl. local Ollama models via `ollama:11434`), and `gemini_local`. [**Hermes Agent**](https://github.com/NousResearch/hermes-agent) remains available as **one such adapter option** (`hermes_local`) — an agent backend Paperclip can dispatch to for personas that suit it, **not** the orchestrator. (Earlier versions of AgenticOS used Hermes as the runtime itself; ADR 0006 moved orchestration to Paperclip — see `docs/adr/`.)
- **Vault tools** — an MCP-to-vault server (in this repo, `apps/dashboard/lib/mcp-vault/`) exposing the vault to any MCP-capable agent.
- **Dashboard** — Next.js 16 + shadcn/ui, deployed on DigitalOcean App Platform with auto-deploy on `push to main`.
- **Auth** — Cloudflare Access (Google SSO) in front of the public dashboard URL.
- **Private networking** — two coexisting private paths. The **DO VPC** (`10.116.16.0/20`; Droplet at `10.116.16.2`) is the private path from the App Platform dashboard to the Droplet's stateful services (UFW gates Postgres `:5432`, OpenViking `:1933`, and vault-server `:7779` to the VPC range). **Tailscale** is the admin mesh — SSH, the Syncthing GUI on `tailscale0`, and future LAN-resident devices.

## Architecture (v1)

```
                  Browser (anywhere)
                         │
                         │ HTTPS → agenticos.gatheringatthegrove.com
                         ▼
                ┌──────────────────────────────┐
                │  Cloudflare Access           │
                │  (Google SSO gate)           │
                └────────────┬─────────────────┘
                             ▼
                ┌──────────────────────────────┐
                │  DO App Platform             │ ← auto-deploy on push to main
                │  AgenticOS dashboard         │
                └────────────┬─────────────────┘
                             │ DO VPC private network
                             ▼
                ┌─────────────────────────────────────────────┐
                │  DO Droplet                                 │
                │  - paperclip-server (runtime + heartbeat +  │
                │    adapters: claude_local / codex_local /   │
                │    opencode_local / gemini_local; hermes_   │
                │    local available as an option)            │
                │  - cloudflared (tunnel → paperclip board UI)│
                │  - OpenViking :1933 (agent memory)          │
                │  - Ollama (embeddings + local models)       │
                │  - Postgres :5432 (Paperclip tables)        │
                │  - vault-server :7779 (human vault API)     │
                │  - Vault filesystem (/opt/vault)            │
                │  - Tailscale + Syncthing daemons            │
                └──────────────────────┬──────────────────────┘
                                       │ Tailscale mesh
                          ┌────────────┴────────────┐
                          ▼                         ▼
                  Mac (Obsidian,           Future Pi-on-LAN
                  browser, Syncthing)      (Phase 4+ connectors)
```

The full design lives in
[`docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md).

## Status

**Foundation v2 spec approved. v1 implementation in planning.**

Phases 1–2 (vault editor, lint, taxonomy, MCP-to-vault server) are merged. Phase 3 originally targeted Hermes Agent as runtime, then pivoted to Letta, then pivoted to the current composed stack. The full decision trail is preserved in [`docs/archive/`](docs/archive/) and [`docs/adr/`](docs/adr/).

**v1 (MVP) scope:**

- One Curator agent — nightly vault inbox triage, accumulating a user model as markdown in the Obsidian vault (served to the Memory tab by vault-server; the agent's own working memory lives in OpenViking)
- Dashboard observability — runs (live + scheduled + stuck-detection), costs (burndown + projection), agent-memory telemetry (OpenViking), system health, skills catalog; plus a vault-driven Memory tab
- GitHub Actions CI/CD — push to `main` deploys both App Platform and Droplet

**Deferred to v2 and beyond:**

- Multi-agent fleet
- Domain connectors (smart home / farm / networking / dev workflow)
- UI customization pass
- Local-burst Ollama for cheap parallel work on Mac

## Repository

```
apps/
└── dashboard/                  # Next.js 16 dashboard (App Platform target)

packages/
├── vault-core/                 # markdown parse, frontmatter, lint, taxonomy
└── config/                     # shared eslint + tsconfig

docs/
├── superpowers/specs/          # current design specs (start here)
├── adr/                        # architecture decision records
├── archive/                    # superseded designs preserved for history
├── brand.md                    # brand voice + visual identity
├── information-architecture.md # IA spec for the dashboard
└── phase-{4,5,6}-design-brief.md  # forward-looking briefs (to be re-scoped per v2+)
```

`packages/hermes-client/` is a legacy TypeScript client for the now-retired Hermes API — vestigial since the move to Paperclip, pending removal once confirmed unreferenced.

## Documentation

Start with the **[docs index](docs/README.md)** for a status table of every spec/plan (Current / Superseded / Archived).

- **Current authoritative specs**:
  - [`docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md) — vault-server + vault-driven Memory tab
  - [`docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md`](docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md) — inbox promote/discard write model
- **Runtime**: Paperclip is the agent runtime (see [ADR 0006](docs/adr/0006-hermes-to-paperclip-runtime.md)); the earlier [`docs/plans/spec1-orchestrator.md`](docs/plans/spec1-orchestrator.md) (Hermes-based) is superseded
- **ADR 0003**: [Scheduler ownership](docs/adr/0003-scheduler-ownership.md) — affirmed (executor changed)
- **ADR 0004**: [Hermes → Letta pivot](docs/archive/0004-pivot-hermes-to-letta.md) — superseded; archived as decision trail
- **ADR 0005**: [Letta → composed stack](docs/adr/0005-letta-to-composed-stack.md) — current; supersedes 0004
- **Archive**: [`docs/archive/`](docs/archive/) — Hermes-shaped and Letta-shaped Phase 3 designs

## Prerequisites for running v1

Once v1 is implemented, you'll need:

- DigitalOcean account (Droplet + App Platform — ~$29/mo marginal)
- ChatGPT Pro/Plus account for Codex OAuth (~$20/mo flat — no per-token billing in this mode)
- Tailscale account (free tier)
- Cloudflare account (free tier; Access requires only the free plan)
- A Mac with Obsidian for vault editing
- A custom domain for the dashboard

**Cost envelope: subscription-first.** The primary `claude_local` agents run on a **Claude Max subscription** (OAuth — flat, no per-token billing); `codex_local` is API-billed when used; `opencode_local` runs **Ollama** locally at zero marginal cost. Local Ollama also handles all embeddings + OpenViking's background pipelines (TreeBuilder, Compressor, IntentAnalyzer) against `nomic-embed-text` + `qwen2.5:3b` on the Droplet. The dashboard's Cost tab tracks any per-token spend.

**Model routing is per-agent in Paperclip** — each agent selects an adapter; budget thresholds and rate-limit cascades are Paperclip policies, not a single global config. Backends in use:

| Adapter | Backend | Auth | Notes |
|---|---|---|---|
| `claude_local` *(primary)* | Claude (`claude` CLI) | Claude **Max subscription** (OAuth) | No API key in the container; creds persist on the `paperclip-data` volume |
| `codex_local` | OpenAI Codex (`codex` CLI) | `OPENAI_API_KEY` | API-billed |
| `opencode_local` | OpenCode → **Ollama** | local, free | `model: ollama/…`, `OLLAMA_HOST=http://ollama:11434` |
| `gemini_local` | Google Gemini CLI | API key / OAuth | available |
| `hermes_local` | Hermes Agent | — | **optional** adapter; not provisioned by default |

Switching an agent's backend is a per-agent adapter change in Paperclip — no code in this repo needs to move. Agent auth, the internal API endpoint, and the GitHub App credential flow are documented in [`docs/agent-house-rules.md`](docs/agent-house-rules.md) and [`docs/runbooks/paperclip-agent-backends.md`](docs/runbooks/paperclip-agent-backends.md).

## Development

```bash
pnpm install
pnpm dev          # dashboard at http://localhost:3000
pnpm test         # vitest across all packages
pnpm typecheck
pnpm lint
```

Requires Node ≥20 and pnpm ≥9.

### Running a second instance on one host

The dashboard boots an auxiliary vault MCP bridge on `127.0.0.1:7610`. A second
instance on the same host would collide on that port, so give it its own:

```bash
AGENTICOS_MCP_PORT=7611 PORT=3001 pnpm --filter @agenticos/dashboard start
```

Without the override the second instance still **serves normally** — it logs a
single `MCP vault server DISABLED (degraded mode)` line and runs without vault
MCP tools. Set the override when that instance actually needs the bridge, and
point its config `mcpServerUrl` at the matching port.

⚠️ Next.js 16 has breaking changes from earlier versions. See `apps/dashboard/AGENTS.md` and `node_modules/next/dist/docs/` before assuming v15 patterns apply.

## Contributing

This is a single-developer project. Issues and discussion are welcome; PRs are not yet supported with review SLAs.

## License

MIT — see [LICENSE](LICENSE).

---

*Built with care by [Goldberry Grove](https://goldberrygrove.farm).*
