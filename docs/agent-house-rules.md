# Agent house rules — AgenticOS / Goldberry Grove

You are an agent running inside the Paperclip runtime on the AgenticOS Droplet.
These rules are about *where things are*. Follow them — they save you wasted
steps and failed requests.

## Reaching the Paperclip API — use the INTERNAL endpoint

- The Paperclip API is **local to you**: `http://localhost:3100`. You run in the
  same container as the server. Use this base URL for any board / issue / report
  / agent API calls.
- **Do NOT use the public URL `https://paperclip.gatheringatthegrove.com`.** It
  is behind Cloudflare Access (Google SSO) and exists for human browsers only.
  From inside here it just `302`-redirects to a login page and your request
  fails — that redirect is *not* a network/sandbox problem, it's the auth gate.
- Other services on the internal compose network, by name:
  - vault-server: `http://vault-server:7777`
  - ollama: `http://ollama:11434`

## Knowledge — the Obsidian vault is LOCAL, don't go hunting for it

- The team's knowledge base is an **Obsidian vault** that is already available to
  you locally. You do **not** need to search Google Drive, the web, or anywhere
  else to find it.
- **Preferred access: the Vault plugin tools** — `search`, `read`, `list`,
  `stats`. Use `search` to find notes, `read` to open them. This is ranked,
  structured access and the right default.
- The raw Markdown files are also mounted **read-only at `/opt/vault`** if you
  need direct filesystem access (e.g. globbing paths).
- Treat the vault as the **source of truth** for company/farm context, decisions
  (ADRs), runbooks, and notes. Check it *before* reaching for external sources.

## Auth / billing

- Claude agents run on the **Claude Max subscription** (`claude_local`, OAuth) —
  there is no Anthropic API key in this environment, and that is intentional.

## GitHub — push + PR via the AgenticOS Developer App

You authenticate to GitHub through a **GitHub App** (installation tokens), not a
personal token. It spans every org the App is installed on (EngineeringMoonBear,
Goldberry-Playground, …).

- **`git` just works.** `git clone`, `fetch`, and `push` over `https://github.com/…`
  are authed automatically by a credential helper that mints a short-lived token
  for that repo's owner. No setup, no token handling.
- **Always branch + PR — never push to `main`.** Open a PR for review.
- **Open PRs as drafts** (`gh pr create --draft …`, or `draft: true` on the API).
  A human reviews and marks the PR "ready for review" before it merges — you
  propose the fix; you do not ship it. Put your reasoning (what's wrong, why this
  fix) in the PR body so the diff can be reviewed in context.
- **Close your issue on merge — put `Closes #<github-issue-number>` in the PR
  body.** Issues must close automatically when the PR *merges* (GitHub's closing
  keywords fire on merge, never on PR open), so nothing is left open by hand.
  - The number is the PR repo's **GitHub** issue number — the twin of your
    Paperclip issue, not the `GOL-N` id. Every synced Paperclip issue has a
    GitHub mirror; the `github_sync_plugin` closure leg then flips the Paperclip
    mirror to `done` within one sync cycle. To find the twin, read the mapping
    (`github_sync_mapping`: `paperclip_issue_id ↔ repo#number`) or the mirror
    issue's `synced-from-github`/`synced-from-paperclip` marker.
  - **Keep the `GOL-N` id too**, on its own line, for the human trace — e.g.
    `Closes #142` plus `Paperclip: GOL-149`. The `Closes` line does the closing;
    the `GOL-N` line keeps the board legible.
  - Use `Closes`/`Fixes`/`Resolves` (all merge-time keywords). One per issue the
    PR fully resolves; list several if it closes more than one.
- **For `gh` or raw GitHub API calls**, mint a token for the **specific repo**
  first (pass `owner/repo`, not just `owner`, so the token is scoped to that one
  repo — least privilege):
  ```bash
  TOKEN=$(node /paperclip/agent-git/github-app-token.mjs token <owner>/<repo>)
  # then, e.g.:
  GH_TOKEN="$TOKEN" gh pr create --base main --head <branch> --title "…" --body "…"
  # or via the API directly:
  curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/<owner>/<repo>/pulls -d '{"title":"…","head":"<branch>","base":"main","body":"…"}'
  ```
  `<owner>` is the org/user in the repo path (e.g. `Goldberry-Playground`,
  `EngineeringMoonBear`). Only use the bare `token <owner>` form for org-wide
  operations. Tokens last ~1h and are cached, so re-running is cheap.
- **Scope:** the App grants Contents + Pull requests (+ Workflows). No admin, no
  secrets. If a push 404s/403s, the App likely isn't installed on that owner, or
  that repo wasn't selected in the installation — say so rather than retrying.
- **Think the token broker is down? Check it the right way first.** The broker
  is a separate container at `$GH_TOKEN_BROKER_URL` (`http://gh-token-broker:9099`),
  **not** `localhost` — `curl localhost:9099` is *always* connection-refused from
  your shell and does not mean an outage. Run
  `node /paperclip/agent-git/github-app-token.mjs health`; if that prints `200`,
  the broker is fine and you should just run the real `git push`. The helper
  already retries transient broker failures (restarts during deploys) with
  backoff, so only a push that still fails after that is a real blocker — quote
  its actual error when you escalate.
