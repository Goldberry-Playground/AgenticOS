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

## Red CI / hanging deploy — check the vendor BEFORE you debug yourself

- `cat /paperclip/ops/vendor-status.json` — current GitHub, DigitalOcean,
  Cloudflare, Stripe and 1Password status, refreshed every 5 minutes. No
  credential, no vault, no 1Password item. `overall` and `headline` are the
  two-second answer; `degraded[]` names the component and the upstream incident.
- Prefer that over re-deriving it. On 2026-10-05 a GitHub `Actions`
  `degraded_performance` queued 13 runs, cancelled jobs before they ever got a
  runner, and blocked auto-merge — and several agents each burned a heartbeat
  diagnosing it independently.
- If the snapshot is missing or stale, get a live answer:
  `/opt/agenticos/repo/infra/scripts/vendor-status-guard.py read`.
- When Actions is degraded the snapshot carries the triage rule inline
  (`hints.github_actions`): `conclusion=cancelled` + **empty `runner_name`** +
  `BlobNotFound` on the job logs means the job never ran a step — incident
  debris, **not** a test failure. Do not "fix" the code. Your App token has no
  `actions: write`, so cancel/rerun are `403`; the only re-trigger lever is
  **close + reopen the PR**.
- If every vendor is `operational`, it's your change.
- Full detail: `docs/runbooks/vendor-status.md`.

## Telling a human something is broken — there IS an ops channel

- `DISCORD_OPS_WEBHOOK_URL` is in your environment and posts to Discord
  `#paperclip-ops`. You do **not** need a 1Password vault for this (the service
  account cannot read `Grove Infra`, which is where agents have historically
  given up).
- Use it for things a human needs to act on *now* — a third-party outage, a
  stuck deploy, a guard that cannot self-heal. Not for progress updates: those
  belong in the issue thread.
- Never echo the URL, and never commit it.

## Company skills — external git sources are markdown-only

- A skill imported from **`github` / `skills_sh` / `url` that ships a `scripts/`
  directory installs only `SKILL.md`** — silently, with no error and nothing in
  the API payload or UI saying so. Executables must come from **`local_path`**
  or **`catalog`**.
- So when a skill's documented script is "missing", **audit the install before
  you suspect your credentials**. GOL-2963 lost a heartbeat to that mis-diagnosis
  and filed a false regression against three closed tickets.
- Audit: `node scripts/ops/audit-company-skills.mjs`. Full lane rules, the
  authoring recipe, and current findings:
  [`docs/runbooks/company-skill-install-lanes.md`](runbooks/company-skill-install-lanes.md).

## Auth / billing

- Claude agents run on the **Claude Max subscription** (`claude_local`, OAuth) —
  there is no Anthropic API key in this environment, and that is intentional.

## Git identity — commit as yourself, not as your neighbour

Your git identity is **asserted at commit time**. If a commit would be attributed to
another agent, `git commit` stops with a message naming the mismatch, fixes the
identity for you, and asks you to re-run the commit. Re-running it is the whole fix —
there is nothing else to do.

Why it exists: agent runs share one checkout per repo and fan out into linked
worktrees, and `git config user.email` in a linked worktree writes the **common**
`.git/config` — repo-local config is per-repository, not per-worktree. With several
runs in flight, whoever set their identity last owns everybody's. A mis-attributed
author silently defeats the PR-review self-review skip (GOL-2720 / GOL-2976): PR #806
was written by Ada and committed as Terra, so Ada was handed her own code to review.
The mirror case is worse — a real, independent reviewer dropped as a false
self-review.

- **Claim your identity in a new worktree** (optional; the hook does it for you on the
  first commit):

  ```sh
  node /paperclip/agent-git/agent-identity.mjs claim
  ```

  It pins `user.name`/`user.email` to **this worktree** (`git config --worktree`,
  which outranks the shared `.git/config` the checkout step writes) and
  de-personalises a sibling agent's value left in the shared config.

- **For a non-git tool that needs the identity in the environment:**

  ```sh
  eval "$(node /paperclip/agent-git/agent-identity.mjs export)"
  ```

- **Never** `git config --local user.email …` in a shared checkout. That is the bleed.
  Use `claim`, or `git config --worktree …`.
- Commits also carry your own `Co-authored-by:` trailer automatically — a bleed-proof
  author signal written by your process, not read from `user.email`.
- The assertion **fails safe**: it never blocks a human or CI (no
  `$PAPERCLIP_AGENT_ID`), an agent missing from
  `scripts/agent-git/agent-identities.json`, or an in-progress
  merge/rebase/cherry-pick. Deliberately committing a patch authored by someone else?
  `AGENT_GIT_IDENTITY_ASSERT=off` for that one command.
- **New agent?** Add it to `scripts/agent-git/agent-identities.json`, and if it
  reviews PRs, add the same name + email to the github-sync plugin config field
  `prReviewAuthorIdentities` — an identity missing there defeats the self-review skip.

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

## After you open a PR on AgenticOS

`main` is governed by an **active** `main-branch-protection` ruleset. Two of its
settings routinely surprise agents — full detail in
[docs/pr-policy.md](./pr-policy.md):

- **`dismiss_stale_reviews_on_push: true`.** Any push after an approval —
  *including* a routine merge of `main` into your branch — silently dismisses
  that approval and re-blocks the PR, with nothing on the page saying so. Get
  the branch final, *then* ask for review.
- **`require_code_owner_review: true`.** `auto-approve.yml`'s
  `github-actions[bot]` approval satisfies the review *count*, but the bot is
  not a code owner, so a PR touching `.github/**`, `infra/**`, `scripts/ci/**`
  (etc.) needs a human CODEOWNER no matter what the bot does.

Read rulesets with `gh api repos/<owner>/<repo>/rulesets` — the classic
branch-protection endpoint answers "Branch not protected" and is misleading.

A green PR can still be `BLOCKED` because `auto-approve.yml` declined it on
policy (size caps, sensitive path). Since GOL-2815 it says so in a PR comment;
if there is no such comment, the block is not a policy decline.
