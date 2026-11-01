# Runbook — Paperclip agent backends (adapters & auth)

Paperclip is the orchestrator ("mainframe"); each agent runs on a pluggable
**adapter** that shells out to a local CLI in the `paperclip-server` container.
The container ships four CLIs (`vendor/paperclip/Dockerfile`): `claude`,
`codex`, `opencode`, `gemini`.

| Adapter | Runtime CLI | Auth / cost | Notes |
| --- | --- | --- | --- |
| `claude_local` | `claude` | **Claude Max subscription (OAuth)** | Primary driver. Strong reasoning — best for technical *and* executive (CEO/CFO) personas. Memory is via plugins, not the adapter. |
| `codex_local` | `codex` | OpenAI **API key** | `OPENAI_API_KEY` — grant **per-agent** (Paperclip Secrets), not the shared env. See [Agent environment isolation](#agent-environment-isolation-secret-blast-radius). |
| `opencode_local` | `opencode` | depends on `model` | Route to **Ollama** for free local inference (see below). |
| `gemini_local` | `gemini` | Google API | Available; not in the primary plan. |
| `hermes_local` | `hermes` (Python) | — | **Vestigial.** Registered in the fork but the `hermes` CLI is NOT installed (Hermes retired, ADR 0006). Selectable in the UI but fails at runtime: `Hermes CLI "hermes" not found`. Don't use it. |

**Memory is not adapter-specific.** Long-term memory is OpenViking + the vault,
exposed as Paperclip *plugins* (`openviking-plugin`, `vault-plugin`) available to
every adapter equally. Any persona on any backend gets the same memory.

---

## Claude on the Max subscription (not API billing)

By default `claude` uses `ANTHROPIC_API_KEY` if present (pay-per-token), which
overrides subscription OAuth. To run Claude agents on your Max plan:

The server runs as the **`node`** user (entrypoint does `exec gosu node`), and
`CLAUDE_CONFIG_DIR=/paperclip/.claude` pins claude's creds onto the persistent
`paperclip-data` volume. Two rules that follow from this — both matter:
- **Log in as `node`** (`-u node`), not root. A root `exec` login writes creds
  root-owned and/or off-volume; the node-run agent then can't read them and
  reports "login required" even though login "succeeded".
- Recreate (not `docker restart`) after any compose change so `CLAUDE_CONFIG_DIR`
  is actually in the container env.

1. **Log in inside the container as `node`** (interactive; fine to do while the
   key is still present — login writes OAuth creds regardless):
   ```bash
   ssh deploy@<droplet>
   cd /opt/agenticos
   docker compose exec -u node -it paperclip-server claude /login
   # follow the device-code URL, sign in with the Max account
   # creds land in $CLAUDE_CONFIG_DIR = /paperclip/.claude (node-owned, on the volume)
   ```
2. **Remove `ANTHROPIC_API_KEY` from `/opt/agenticos/.env`** (env_file injects it
   directly, bypassing docker-compose.yml). Idempotent, preserves perms:
   ```bash
   cd /opt/agenticos
   umask 077
   grep -v '^ANTHROPIC_API_KEY=' .env > .env.tmp 2>/dev/null || true
   chmod 600 .env.tmp && mv .env.tmp .env
   grep -c '^ANTHROPIC_API_KEY=' .env   # expect 0
   ```
   (`docker-compose.yml` no longer passes it in `environment:` either — both
   paths must be clear.)
3. **Recreate paperclip-server** so it starts without the key (`up -d`, NOT
   `docker restart` — restart won't re-read env_file):
   ```bash
   docker compose up -d paperclip-server
   ```
4. **Verify** (run claude as `node`, the same user the agent uses):
   ```bash
   docker compose exec -u node paperclip-server claude -p "reply OK"
   ```
   A reply (no "login required") confirms it. Then create/run a `claude_local`
   agent — the probe warning ("ANTHROPIC_API_KEY is set … API-key auth") and the
   "login is required" warning should both be gone.

**Rollback / opt-in API billing:** don't put the key back in `.env`. Instead set
`ANTHROPIC_API_KEY` in **Paperclip Secrets** for the specific agent that should
bill per-token. Keeps subscription the default; API billing becomes explicit.

---

## Ollama-backed agents (free local inference)

There is **no Ollama adapter.** Ollama runs as its own service (`ollama:11434`
on the compose network) and is reached through `opencode_local`:

1. **Pull a model** into Ollama (Droplet):
   ```bash
   docker compose exec ollama ollama list
   docker compose exec ollama ollama pull qwen2.5-coder:7b   # example
   ```
2. **Create an `opencode_local` agent** with:
   - `model`: `ollama/qwen2.5-coder:7b`  (provider/model format)
   - `env`: `{ "OLLAMA_HOST": "http://ollama:11434" }`

   Confirm OpenCode's exact Ollama env/provider knob against current OpenCode
   docs before first run (`OLLAMA_HOST` vs a provider-config entry).

⚠️ Local Ollama models are far weaker than Claude/Codex — use for cheap,
background, or simple agents, not your main driver.

---

## GitHub App token broker (key isolation)

Agents authenticate to GitHub via a **GitHub App** ("AgenticOS Developer"), but
the App **private key never sits in `paperclip-server`'s env** — if it did, an
agent subprocess could `printenv` and exfiltrate the root credential. Instead:

- **`gh-token-broker`** (compose service) is the only container with the key. It
  loads `GITHUB_APP_PRIVATE_KEY_B64` from `/opt/agenticos/secrets/gh-app.env`
  (chmod 600) and runs `github-app-token.mjs serve` — an internal HTTP endpoint
  that mints **repo-scoped** installation tokens. No published ports.
- **`paperclip-server`** has only `GH_TOKEN_BROKER_URL=http://gh-token-broker:9099`.
  The git credential helper asks the broker for a token per repo; agents can
  request scoped tokens (their job) but cannot get the key.

### One-time migration (move the key out of the shared `.env`)

On the Droplet, after this change is deployed:

```bash
cd /opt/agenticos
umask 077
mkdir -p secrets
# move the key from the shared .env into the broker-only secret file
grep '^GITHUB_APP_PRIVATE_KEY_B64=' .env > secrets/gh-app.env
chmod 600 secrets/gh-app.env
# remove it from the shared .env so paperclip-server no longer inherits it
grep -v '^GITHUB_APP_PRIVATE_KEY_B64=' .env > .env.tmp && chmod 600 .env.tmp && mv .env.tmp .env
echo "broker secret lines: $(grep -c '^GITHUB_APP_PRIVATE_KEY_B64=' secrets/gh-app.env) | .env key removed: $(grep -c '^GITHUB_APP_PRIVATE_KEY_B64=' .env)"   # want: 1 | 0
# bring up the broker, then recreate paperclip-server (now keyless)
docker compose up -d gh-token-broker
docker compose up -d --force-recreate paperclip-server
# verify: agents still mint (through the broker)
docker compose exec -u node paperclip-server node /paperclip/agent-git/github-app-token.mjs token Goldberry-Playground/AgenticOS   # → ghs_…
docker compose exec -u node paperclip-server sh -c 'printenv GITHUB_APP_PRIVATE_KEY_B64 >/dev/null && echo LEAK || echo "key absent ✓"'
```

The credential helper auto-detects `GH_TOKEN_BROKER_URL`, so `git`/`gh` usage is
unchanged. (If `GH_TOKEN_BROKER_URL` is unset, the helper falls back to minting
locally — the pre-broker behaviour.)

---

## Agent environment isolation (secret blast radius)

Each agent runs as a **subprocess of `paperclip-server`**, so by default it
inherits the server's whole environment — and `paperclip-server` loads the
shared `/opt/agenticos/.env` **wholesale** via `env_file`. A prompt-injected
agent can `printenv`, so anything in that env is exfiltratable. Two layers keep
the blast radius small:

### 1. The runtime sanitizer (`sanitizeRuntimeServiceBaseEnv`)

Paperclip builds every adapter/runtime subprocess env as
`{ ...sanitize(process.env), ...adapterEnv, ...perAgentSecrets }` — per-agent
secrets merge **after** the sanitized base. As of fork tag **`agenticos-v0.1.1`**
(PR [Paperclip-AgenticOS#2](https://github.com/Goldberry-Playground/Paperclip-AgenticOS/pull/2))
the sanitizer strips, from the base env handed to agents:

- `PAPERCLIP_*` and `DATABASE_URL` (original behaviour)
- `BETTER_AUTH_SECRET`, `AGENTICOS_DB_PASSWORD`, `SYNCTHING_API_KEY`
- anything ending in `_SECRET` or `_PASSWORD`

These are **server-only** — the server process holds them, agents never need
them. The server's own env still has them (that's expected); only the **child**
env is scrubbed.

> It does **not** strip LLM `*_API_KEY` vars — adapters that authenticate by key
> (codex→`OPENAI_API_KEY`, deepseek→`DEEPSEEK_API_KEY`) would break. Manage those
> per-agent instead (below).

### 2. LLM API keys — grant per-agent, never in the shared `.env`

`OPENAI_API_KEY` / `DEEPSEEK_API_KEY` must **not** live in `/opt/agenticos/.env`
(the `env_file` dump would hand them to *every* agent, including ones that never
use that backend — same trap as `ANTHROPIC_API_KEY`). Instead grant them as
**per-agent Paperclip Secrets**, which Paperclip resolves into that one agent's
`adapterEnv` (merged after the sanitized base).

**Safe ordering — do NOT remove the key from `.env` before granting it
per-agent, or any live codex/deepseek agent loses auth mid-run:**

```bash
# 1. For EACH codex_local / deepseek agent, set the key in Paperclip Secrets and
#    reference it from the agent's env config (OPENAI_API_KEY / DEEPSEEK_API_KEY).
#    (Paperclip UI → agent → Secrets/Env, or the secrets API.) If you run NO such
#    agents today, skip to step 2 — there's nothing to break.

# 2. Remove the keys from the shared env so they stop inheriting into every agent:
cd /opt/agenticos
umask 077
grep -vE '^(OPENAI_API_KEY|DEEPSEEK_API_KEY)=' .env > .env.tmp && chmod 600 .env.tmp && mv .env.tmp .env
grep -cE '^(OPENAI_API_KEY|DEEPSEEK_API_KEY)=' .env   # expect 0

# 3. Recreate so the container re-reads env_file (no image rebuild needed):
docker compose up -d --force-recreate paperclip-server
```

`docker-compose.yml` no longer lists these in `environment:` either, so both
paths are clear (mirrors the `ANTHROPIC_API_KEY` treatment above).

### Verifying a spawned agent's env is clean

Check the **child** env, not the server's. Run any agent with a prompt like
*"run `env | cut -d= -f1 | sort` and report the output"*, then confirm
`BETTER_AUTH_SECRET`, `AGENTICOS_DB_PASSWORD`, `SYNCTHING_API_KEY` (and, once
moved per-agent, `OPENAI_API_KEY` on agents not granted it) are **absent**. That
prints variable *names* only — never values, safe to paste back.
