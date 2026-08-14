import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.github-sync-plugin",
  apiVersion: 1,
  // Bump on ANY manifest change — a stale stored manifest silently masks changes
  // (spec gotcha; see #228). 0.6.0 = discipline label routing (GOL-150).
  // 0.7.0 = agent PR review pipeline (GOL-158, Phase 2): `github-pr` webhook.
  // 0.7.1 = plugin-side agent-review sign-off completion (GOL-186): an
  //   issue.updated dispatch completes the `agent-review/*` check-run to success
  //   when the review issue closes `done` (Phase 3 prerequisite). No new
  //   capabilities/webhooks — reuses issues.read + http.outbound (checks:write is
  //   an App-side grant, GOL-175), so the manifest surface is unchanged bar version.
  // 0.8.0 = swallowed-failure observability (GOL-296): caught exceptions in
  //   onWebhook / event dispatch now write a queryable `github_sync_error` row
  //   (migrations/003) AND fire a 🚨 ops-webhook alert, instead of vanishing into
  //   host server.log. No new capabilities — reuses database.namespace.write +
  //   http.outbound; a new migration ships under the existing `database` block.
  // 0.9.0 = CI → Paperclip fix-issue loop (GOL-305, from the GOL-303 audit). The App's
  //   native `check_suite`/`workflow_run` **completed** events land on the same
  //   `github-app` webhook URL and are fanned out by X-GitHub-Event: a failing CI
  //   check on an agent-authored PR opens/updates an author-assigned fix issue, and a
  //   green suite auto-closes it (loop-guarded per (repo, PR#) via github_ci_failure,
  //   migrations/004). No new capabilities/webhook endpoints — reuses issues.create/
  //   update + issue.comments.create + http.outbound; needs the App subscribed to
  //   `check_suite`/`workflow_run` and granted `checks:read` (GOL-304 / T1).
  // 0.9.1 = inbound invocation-scope fix (GOL-300/GOL-295): the mirror-create and
  //   closure paths now re-enter the captured host scope (runInScope), matching the
  //   PR-path fix (GOL-179). Bugfix only — manifest surface unchanged bar version.
  // 0.10.0 = inbound scope-expiry REST-bypass fallback (GOL-323, board-authorized
  //   interim mitigation for GOL-295/GOL-300). runInScope alone does not fully close
  //   the drop: the host still expires the per-delivery scope before some awaited
  //   ctx.issues.* writes land. On that error ONLY, the mirror-create / closure
  //   paths retry via the Paperclip REST API. The internal loopback (127.0.0.1) is
  //   NOT reachable — the host's plugin http.outbound SSRF filter blocks private
  //   IPs — so the fallback targets the CF-Access-gated public host and carries a
  //   Cloudflare Access service token. Four new optional config fields:
  //   paperclipApiBaseUrl + paperclipApiToken + paperclipCfAccessClientId +
  //   paperclipCfAccessClientSecret. Catch-fallback only — zero-risk to the working
  //   scope path. No new capabilities (reuses http.outbound); the new config fields
  //   deliberately do NOT use format:"secret-ref" (see the field comments).
  // 0.11.0 = gh-token-broker bearer auth (GOL-666, fixes the M3/PR #356 regression).
  //   Since PR #356 the broker REQUIRES `Authorization: Bearer <GH_BROKER_API_KEY>`
  //   and rejects unauthenticated mints with HTTP 401 — but the plugin's broker
  //   client never sent it, so every repo-scoped token mint 401'd and the PR-review
  //   pipeline died at "failed to fetch PR changed files" (seen on grove-odoo-modules).
  //   Sandboxed plugin workers can't read GH_BROKER_API_KEY(_FILE) from env, so the
  //   key arrives via one new config field, tokenBrokerApiKey (NOT secret-ref — same
  //   host-strips-secret-ref reasoning as the GOL-323 fields). No new capabilities.
  // 0.11.1 = PR-review pipeline-error observability + alert hygiene (GOL-724). The
  //   `🔥 PR review pipeline error` pings for HMAC-reject / broker-401 changed-file
  //   fetch fail / CI check-run fetch fail were fire-and-forget: invisible to DB triage
  //   AND un-deduped, so one worker-crash window + GitHub webhook redelivery spammed N
  //   identical lines at ops. Now every such error persists a queryable `github_sync_error`
  //   row (reuses migrations/003) and all error-class ops alerts pass through an in-memory
  //   per-content throttle that collapses a burst to one ping per window with a
  //   `(+N suppressed)` note. Bugfix only — manifest surface unchanged bar version.
  // 0.11.2 = complete the 0.11.1 throttle: OpsPingThrottle.prune() was defined+tested
  //   but never called, so the per-content window Map grew unbounded over the long-lived
  //   worker (contradicting its own "can't grow unbounded" docstring) — GOL-728. decide()
  //   now prunes stale keys opportunistically after refreshing the current key, so the
  //   Map is bounded by the count of distinct alert keys seen within one window. Bugfix
  //   only — manifest surface unchanged bar version.
  // 0.11.3 = post-merge sign-off no longer false-alarms (GOL-781). handleReviewSignoff
  //   posted a green `agent-review/*` check-run on the reviewed head SHA even after the
  //   PR merged; GitHub's Checks API rejects a completion on a merged/superseded head
  //   ("No commit found for SHA"), firing a false `🔥 sign-off check-run failed` alert on
  //   every post-merge sign-off (grove-odoo-modules#44/47/48). postSignoffCheck now
  //   short-circuits merged/closed PRs before the doomed post and re-derives PR state on
  //   failure to mute the alert when the PR is no longer an open merge gate. Bugfix only —
  //   manifest surface unchanged bar version.
  // 0.11.5 = stranded `agent-review/*` sign-off checks now complete (green) instead of
  //   hanging `in_progress` forever on merged/closed heads (GOL-798). postSignoffCheck
  //   always attempts the completion post; GitHub records a completed check-run on the
  //   merged head. Bugfix only — manifest surface unchanged bar version.
  // 0.11.6 = sign-off check-runs no longer fail with 401 "Bad credentials" (GOL-799).
  //   The broker keeps its own disk cache and serves a token with as little as 5 min of
  //   life left, but the client cached every token for a flat 50 min — so a token could be
  //   held ~44 min PAST its real expiry, and every check-run write with it got GitHub's
  //   401 (stranded `agent-review/*` checks). The broker now returns `expires_at` and the
  //   client caches until that real expiry minus a 2-min skew, capped at the 50-min TTL.
  //   Bugfix only — manifest surface unchanged bar version.
  // 0.11.7 = sign-off failure observability + transient-blip muting (GOL-802). A ~4-min
  //   broker-token 401 window fired 59 `🔥 sign-off check-run failed` pings across 5 open
  //   PRs (each retry re-alerted) yet logged an EMPTY error — the HTTP status was dropped:
  //   github-client `request()` awaited `res.json()` before the `res.ok` check, so a
  //   bodyless/non-JSON 4xx/5xx threw and lost the status. Root causes (1) broker lacks
  //   checks:write and (2) a payload bug were both RULED OUT (seeds + an out-of-band
  //   completion POST via the broker token both 201). `request()` now reads text-first
  //   (always keeps status + a non-empty error), and postSignoffCheck classifies transient
  //   failures (401/408/429/5xx/no-status) as retryable — warn + NO 🔥, since the
  //   event-driven retry self-heals — while a 403 (checks:write revoked) or unexpected 422
  //   on a live open PR still fires 🔥 with the status + GitHub errors[]. Bugfix only —
  //   manifest surface unchanged bar version.
  // 0.12.0 = mirror reconcile sweep + plugin-operational-issue guard. The outbound
  //   mirror was purely event-driven, so issues created BEFORE a bridge was applied
  //   (or during a drop window) never got a GitHub twin (~78 active issues across the
  //   three bridged projects). A new hourly `mirror-reconcile` job (jobs.schedule +
  //   jobs[] — manifest surface CHANGED) sweeps bridged projects and mirrors active
  //   unmapped issues through the idempotent handleIssueCreated path, capped per run.
  //   Also fixes mirror NOISE: handleIssueCreated now skips the plugin's own
  //   operational issues (pr-review/ci-fix markers) — 202 "Review PR …" junk twins
  //   had accumulated in bridged repos (existing ones need one-time GitHub cleanup).
  // 0.12.1 = ops-channel noise policy (the "4 pings per PR" complaint, 2026-08-01).
  //   New `opsPingMode` config ("outcomes" default | "verbose" | "errors"): the
  //   default drops 🔍 review-created / 🔁 re-review lifecycle chatter and routine
  //   assigned-mirror pings, keeping ✅/❌/CI-fix/🧹 outcomes; error-class pings
  //   (🔥/🚨/unassigned-mirror) pass EVERY mode. Sign-off ✅ collapsed to ONE ping
  //   per green event listing all checks (was one per reviewer). Manifest surface
  //   changed: +opsPingMode config field.
  // 0.13.0 = Layer 1 merge automation: `synchronize` deliveries whose new head is
  //   a GitHub-generated base-sync merge ("Update branch") short-circuit before the
  //   review pipeline runs, instead of reopening the review issue and re-pinging for
  //   unchanged code (the ~202 junk "Review PR" twins). One `getCommit` fetch +
  //   `classifyHeadChange` decide it; manifest surface unchanged bar version.
  // 0.13.1 = sign-off reconcile sweep (GOL-1160). handleReviewSignoff mutes a transient
  //   check-run completion failure (broker 401 / timeout / 5xx) expecting "the next
  //   issue.updated re-fires the retry" — but a `done` sign-off is TERMINAL, so a blip at
  //   that instant strands the REQUIRED `agent-review/*` check `in_progress` forever and
  //   the Phase-3 gate blocks the merge until an admin bypass (observed 2026-08-03 on
  //   grove-sites#407 / odoocker#387 / grove-odoo-modules#68 — all signed off `done`, checks
  //   stuck pending; a manual App-token check POST returned 201, ruling out permissions).
  //   New hourly `signoff-reconcile` job (jobs.schedule + jobs[] — manifest surface CHANGED,
  //   fires at :38) re-drives handleReviewSignoff for any signed-off review issue whose check
  //   is not yet green, bounded to a 3-day window + 200 rows, one check-run read per head.
  // 0.13.2 = mirror-reconcile survives scope expiry (GOL-1163). A scheduled job has
  //   NO ambient invocation scope to inherit — unlike a webhook delivery or event
  //   dispatch — so the sweep's `ctx.issues.list` is the most scope-fragile call in
  //   the plugin. Bare, it threw "referenced a missing, expired, or unknown
  //   invocation scope" (2026-08-03 21:23Z) and the twin backfill stopped dead with
  //   38 issues still unmapped. The read now goes through the same withRestFallback
  //   the inbound mirror path uses (GOL-323); PaperclipRestClient gains listIssues,
  //   its first READ mirror. Worker-code + REST-client only — manifest surface
  //   unchanged bar version (bumped so the dev-watcher actually hot-reloads it:
  //   it only fires on dist/manifest.js changes, so a worker-only fix would
  //   otherwise sit on disk unused).
  // 0.14.0 = inbound-close reconcile sweep (GOL-1206 / GOL-289). Closure propagation
  //   (GitHub close → Paperclip mirror `done`) works event-driven on AgenticOS, where
  //   the GitHub App delivers the `issues` `closed`/`reopened` event. But the App is
  //   installed ONLY on AgenticOS, so the Goldberry-Playground bridged repos
  //   (grove-sites, odoocker-goldberrygrove, grove-odoo-modules) receive NO such event —
  //   a merged `Closes #N` PR closes the twin, but nothing brings that close back into
  //   Paperclip (mirror-reconcile is outbound-only, skips terminal issues). CEO chose
  //   the polling fix (Option B) over installing the App org-wide. New hourly
  //   `inbound-close-reconcile` job (jobs.schedule + jobs[] — manifest surface CHANGED,
  //   fires at :51) lists each bridged repo's recently-updated issues and re-drives the
  //   SAME handleAppClosure code path per issue: identical mapping lookup, the existing
  //   resolveMirrorClosureStatus matrix, the identical loop guard, and the scope-safe
  //   REST-fallback write — so the polling leg can never diverge from the event leg.
  //   AgenticOS stays a no-op (its closes reach the mirror before the sweep → loop-guard
  //   skip). Bounded to a 14-day window + 5 pages/repo; idempotent, safe every cycle.
  // 0.14.1 = mirror-reconcile actually REACHES the backlog (follow-up to 0.13.2).
  //   With the scope crash fixed the sweep ran clean but created ~nothing: the
  //   host serves ONE 100-row page per query (a second page is empty regardless
  //   of offset), so an unfiltered scan saw 300 of 733 issues — 273 already
  //   done — and never reached the 36 lacking a twin. It now queries each ACTIVE
  //   status separately (backlog/todo/in_progress/in_review/blocked), giving the
  //   backlog its own window per status instead of competing with closed work.
  //   isTerminalStatus still guards each row, so a host ignoring the filter
  //   cannot make us mirror closed issues. Worker-code only — surface unchanged
  //   bar version (bumped so the dev-watcher reloads it; see 0.13.2).
  // 0.14.2 = inbound-close-reconcile self-heals orphaned mappings (GOL-1274, follow-up
  //   to GOL-1273). When a Paperclip issue with a GitHub twin is hard-deleted, its
  //   github_sync_mapping row is orphaned: every hourly sweep re-found the closed twin,
  //   read the mirror as not-found, counted it `failed`, and paged ops Discord FOREVER
  //   (the false alarm behind GOL-1273, failed:2). handleAppClosure now distinguishes a
  //   PERMANENT delete (withRestFallback returns null only on a positive 404 — a
  //   5xx/timeout throws and is still tallied `failed`) from a transient blip: it prunes
  //   the orphaned row (new mapping.deleteByPaperclipIssueId) and returns a new `pruned`
  //   outcome. The sweep counts it in a `pruned` bucket (observable, one-time) instead of
  //   `failed`, so the next sweep sees the twin as `unmapped` and stops paging. `failed`
  //   is now purely actionable. Worker-code + mapping helper (reuses the existing table,
  //   no migration) — manifest surface unchanged bar version.
  // 0.16.0 = inbound-CREATE reconcile sweep (GOL-1413). The inbound mirror-CREATE was
  //   event-driven only: a GitHub-native issue got a Paperclip twin solely if its
  //   webhook was delivered AND its handler survived — no feedback loop revisited one
  //   born during an inbound-webhook outage (mirror-reconcile is outbound-only;
  //   inbound-close-reconcile acts only on already-mapped issues). New hourly
  //   `inbound-create-reconcile` job (jobs.schedule + jobs[] — manifest surface CHANGED,
  //   MINOR bump) lists each bridged repo's recently-OPEN issues and re-drives the SAME
  //   createMirrorIssue path the webhook uses for any open, non-Paperclip-origin,
  //   unmapped issue — so a deliberately-induced inbound-webhook outage self-heals
  //   within an hour (the DoD self-heal net; absorbs grove-sites#473 / GOL-1300).
  //   Idempotent (pre-checks the mapping), capped per run (20 attempts), 14-day/5-page
  //   window. Reuses issues.create + jobs.schedule — no new capability, no migration.
  // 0.15.1 = token-layer hardening (GOL-1425, folds #457). A cached installation token
  //   can be revoked BEFORE its `expires_at` (App suspended, key rotated, install/perm
  //   change), and the stacked caches (broker disk cache → client in-memory cache) then
  //   keep serving the dead token for the rest of its TTL — every write 401s "Bad
  //   credentials" through a ~45-min self-healing window. Three defences, all fail-open:
  //   (1) MINT-TIME VALIDATION — the broker probes each token against `/rate_limit` (free,
  //   no quota) before serving/caching; a rejected fresh mint means the App itself is
  //   broken and throws instead of caching a dead credential (folds #457). (2) 401
  //   CACHE-EVICTION — TokenProvider gains an optional `invalidate(repo)`; GitHubClient
  //   evicts and re-mints ONCE on a 401 so a token revoked mid-TTL self-corrects on first
  //   use instead of stranding the whole window. (3) BROKER CANARY — optional periodic
  //   mint+validate (GH_BROKER_CANARY_OWNER) surfaced on /health + ops Discord, plus a
  //   one-shot `canary` CLI mode for CI/cron, flagging a dead App key BEFORE a real write.
  //   Broker-script + worker-code (broker.ts/github-client.ts bundled) — manifest surface
  //   unchanged bar version.
  // 0.16.1 = receiver honesty (GOL-1411 / W2). Before this, the webhook receiver
  //   returned HTTP 200 {status:"success"} for EVERY delivery — including unsigned
  //   garbage and deliveries whose downstream write failed — so GitHub's delivery
  //   log showed green checkmarks while inbound mirroring was dead, which is why the
  //   2026-08-12 outage stayed invisible for ~20h. Every inbound handler now VERIFIES
  //   the HMAC BEFORE any enqueue/write and THROWS a WebhookRejection on a missing
  //   secret / bad signature / (custom-endpoint) bad payload; onWebhook records a
  //   per-delivery outcome to the new github_sync_delivery table (migration 006),
  //   fires the Discord ops alert ONLY on a genuine failed_processing (not on an
  //   unauthenticated probe), and RE-THROWS so the host returns a non-2xx and GitHub's
  //   delivery turns red. Retries stay safe: inbound create still dedupes on
  //   repo+number before writing (getByRepoNumber), preserving the GOL-352/GOL-323
  //   REST fallback. Adds migration 006 (new table) — surface otherwise unchanged.
  version: "0.16.1",
  displayName: "GitHub Sync",
  description:
    "Bidirectional issue sync between Paperclip and GitHub. Paperclip → GitHub mirrors issue changes via the gh-token-broker (GitHub App, no PAT); GitHub → Paperclip creates mirror issues from an inbound HMAC webhook (agent-free). Multiple repo↔project bridges across orgs.",
  author: "AgenticOS",
  categories: ["connector"],
  // events.subscribe: the worker subscribes to core "issue.created" / "issue.updated".
  // http.outbound: the github-client writes issues to the GitHub REST API.
  // database.namespace.{read,write,migrate}: a "github_sync_mapping" table in the
  //   plugin DB namespace links paperclip_issue_id <-> github repo#number and records
  //   sync origin for loop prevention. The table is created by migrations/001_init.sql
  //   (runtime DDL via ctx.db.execute is forbidden), and runtime reads/writes are
  //   namespace-qualified via ctx.db.namespace (gated behind these capabilities).
  // issues.read: REQUIRED and added beyond the original spec list. The plugin event
  //   payload for issue.created/issue.updated is delta-based (the activity-log
  //   `details` blob — title/identifier/changed-fields), NOT the full Issue object,
  //   and notably does NOT carry the description on create. To build the GitHub
  //   issue body (title + description + status) the handler reads the full issue
  //   back via ctx.issues.get(event.entityId, event.companyId), which the host
  //   gates behind issues.read. See vendor/paperclip/server/src/services/activity-log.ts.
  // issues.create + webhooks.receive: the inbound leg. The host exposes a public
  //   (board-auth-free) endpoint POST /api/plugins/:id/webhooks/github-issue for the
  //   GitHub Actions workflow; onWebhook verifies the HMAC and creates the mirror
  //   issue directly via ctx.issues.create. Routines can't do this — every routine
  //   run requires an agent ("Default agent required"), so they dispatch work rather
  //   than mirror. The plugin webhook auth-route mode is disabled on this host, but
  //   manifest-declared webhooks (webhooks.receive) are the supported public path.
  // issues.update + issue.comments.create: the PR review pipeline (GOL-158) reopens
  //   (`todo`) an existing review issue on `synchronize` and posts a "new commits"
  //   note comment. Both are gated behind these capabilities.
  capabilities: [
    "events.subscribe",
    "http.outbound",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "webhooks.receive",
    "database.namespace.read",
    "database.namespace.write",
    "database.namespace.migrate",
    // jobs.schedule (0.12.0): the hourly mirror-reconcile sweep — the event-driven
    // mirror's missing feedback loop for pre-bridge / dropped-event issues.
    "jobs.schedule",
  ],
  jobs: [
    {
      jobKey: "mirror-reconcile",
      displayName: "Mirror reconcile",
      description:
        "Hourly sweep of bridged projects: mirrors active Paperclip issues that have no GitHub twin (created before the bridge existed, or whose issue.created event dropped). Idempotent, capped per run.",
      // Minute 23 — offset from the top of the hour so it never stacks on other
      // hourly jobs (openviking vault-ingest runs at :00).
      schedule: "23 * * * *",
    },
    {
      jobKey: "signoff-reconcile",
      displayName: "Sign-off reconcile",
      description:
        "Hourly sweep that re-drives stranded agent-review sign-off check-runs: a signed-off (`done`) review issue whose required `agent-review/*` check never completed to success — e.g. a transient broker-token blip at the terminal sign-off left the event-driven retry with no event to re-fire (GOL-1160). Idempotent; bounded per run.",
      // Minute 38 — offset from mirror-reconcile (:23) and the top of the hour so the
      // two sweeps never stack.
      schedule: "38 * * * *",
    },
    {
      jobKey: "inbound-close-reconcile",
      displayName: "Inbound-close reconcile",
      description:
        "Hourly sweep that mirrors GitHub-side issue closes back onto their Paperclip twins for org bridges the GitHub App does not deliver `issues` events to (Goldberry-Playground). Lists each bridged repo's recently-updated issues and re-drives the event-path closure handler — same mapping lookup, status matrix, and loop guard — so a merged `Closes #N` PR reaches the mirror without an App installation (GOL-1206). Idempotent; bounded per run.",
      // Minute 51 — offset from mirror-reconcile (:23) and signoff-reconcile (:38) and
      // the top of the hour so no two hourly sweeps ever stack.
      schedule: "51 * * * *",
    },
    {
      jobKey: "inbound-create-reconcile",
      displayName: "Inbound-create reconcile",
      description:
        "Hourly sweep that creates missing Paperclip twins for GitHub issues whose inbound webhook never landed (disabled / mis-delivered / dropped handler). Lists each bridged repo's recently-open issues and re-drives the event-path mirror-create handler — same dedupe, label routing, and REST-fallback write — so a GitHub issue born during an inbound-webhook outage self-heals within an hour (GOL-1413). Idempotent; capped per run.",
      // Minute 9 — offset from mirror-reconcile (:23), signoff-reconcile (:38),
      // inbound-close-reconcile (:51) and the top of the hour so no two sweeps stack.
      schedule: "9 * * * *",
    },
  ],
  // Inbound endpoint. The workflow POSTs the GitHub issue-opened payload here;
  // signature verification is the plugin's responsibility (see onWebhook).
  webhooks: [
    {
      endpointKey: "github-issue",
      displayName: "GitHub issue opened → Paperclip mirror (custom Actions workflow)",
      description:
        "Receives a GitHub issue-opened payload {repo,number,title,body,url} (HMAC-signed with inboundWebhookSecret) and creates the mirror Paperclip issue in the matching bridge's project. Requires a per-repo Actions workflow + repo secret.",
    },
    {
      endpointKey: "github-app",
      displayName: "GitHub App issues / pull_request / check_suite / workflow_run → Paperclip (no per-repo setup)",
      description:
        "Point the AgenticOS Developer GitHub App's single webhook here. Subscribe it to `issues` (mirror opened issues + closure propagation), `pull_request` (agent review pipeline, GOL-158), and — for the CI→Paperclip fix loop (GOL-305) — `check_suite`/`workflow_run`. All arrive on this one URL and are fanned out by X-GitHub-Event. On a failing CI check on an agent-authored PR the plugin opens/updates a fix issue assigned to the code owner, and auto-closes it when the suite goes green. Verified with appWebhookSecret; the CI loop needs the App granted `checks:read` (+ the two event subscriptions, GOL-304). No per-repo Actions workflow or repo secret needed.",
    },
    {
      endpointKey: "github-pr",
      displayName: "GitHub App pull_request event → agent review pipeline (GOL-158)",
      description:
        "Subscribe the AgenticOS Developer GitHub App to `pull_request` events and point them here. For each non-draft PR (opened/reopened/ready_for_review/synchronize) the plugin creates review issue(s) in the matching bridge's project — Ada always, Iris when a changed path matches `prReviewFrontendPaths` — and seeds a pending `agent-review/*` check-run on the head SHA. Verified with appWebhookSecret (same as `github-app`). Needs the App's `checks:write` permission for check-runs.",
    },
  ],
  // Declaring `database` is REQUIRED for the host to provision + activate the
  // plugin's Postgres namespace (without it, ensureNamespace returns null and the
  // worker fails with "namespace is not active"). migrationsDir → migrations/001_init.sql
  // creates the github_sync_mapping table (runtime DDL via ctx.db.execute is
  // forbidden by the host contract, so the table MUST come from a migration).
  database: {
    namespaceSlug: "github_sync",
    migrationsDir: "migrations",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      bridges: {
        type: "array",
        title: "Repo ↔ Project bridges",
        description:
          "Each entry mirrors one GitHub repo to one Paperclip project. ONLY issues in a bridge's project are mirrored to its repo — the worker refuses to subscribe company-wide, so unrelated work (e.g. QA-triage issues in other projects) is never mirrored. Add one entry per repo you want synced; they may span multiple orgs (the gh-token-broker mints a token per repo).",
        items: {
          type: "object",
          properties: {
            githubOrg: {
              type: "string",
              title: "GitHub Org/Owner",
              description: "Owner of the target repository.",
              default: "EngineeringMoonBear",
            },
            githubRepo: {
              type: "string",
              title: "GitHub Repo (no owner)",
              description: "Target repository name. Native Paperclip issues are mirrored here.",
            },
            paperclipProjectId: {
              type: "string",
              title: "Paperclip Project ID",
              description: "The project that bridges to githubRepo. Must equal the inbound routine's projectId.",
            },
            syncLabelPaperclip: {
              type: "string",
              title: "Paperclip → GitHub label",
              description: "Label applied to GitHub issues created from Paperclip issues.",
              default: "synced-from-paperclip",
            },
            syncMarkerGithub: {
              type: "string",
              title: "GitHub → Paperclip marker label",
              description: "Label marking issues that originated in GitHub (set by the inbound routine).",
              default: "synced-from-github",
            },
            defaultAssigneeAgentId: {
              type: "string",
              title: "Default assignee agent ID (inbound routing)",
              description:
                "Agent UUID that inbound mirror issues from this repo are assigned to. Backward-compatible last resort: used only when no labelRouting label matches AND no fallbackAssigneeAgentId is set. Paperclip agents never pick up unassigned work, so leaving all three empty means mirrors sit unowned forever.",
            },
            labelRouting: {
              type: "object",
              title: "Discipline label routing (v0.6.0)",
              description:
                "Map of GitHub label name → assignee agent UUID. An inbound issue is assigned to the owner of its highest-precedence matching label. Fixed precedence: infra = bug = alert > frontend > feature (first match by precedence wins). Example: {\"frontend\":\"<Iris>\",\"feature\":\"<Ada>\",\"bug\":\"<Terra>\",\"infra\":\"<Terra>\",\"alert\":\"<Terra>\"}. No match → fallbackAssigneeAgentId → defaultAssigneeAgentId.",
              additionalProperties: { type: "string" },
            },
            fallbackAssigneeAgentId: {
              type: "string",
              title: "Fallback assignee agent ID (unlabeled triage)",
              description:
                "Agent UUID assigned when no labelRouting label matches — the triage owner (e.g. the CEO). Takes precedence over defaultAssigneeAgentId for the no-label case so unlabeled GitHub issues still enter a heartbeat instead of piling up unowned.",
            },
            defaultPriority: {
              type: "string",
              title: "Default mirror priority",
              description: "Priority for mirror issues created from this repo. Defaults to \"medium\" if unset or invalid.",
              enum: ["critical", "high", "medium", "low"],
            },
          },
          required: ["githubOrg", "githubRepo", "paperclipProjectId"],
        },
      },
      tokenBrokerUrl: {
        type: "string",
        title: "Token Broker URL",
        description:
          "gh-token-broker endpoint that mints repo-scoped GitHub App installation tokens. Defaults to the GH_TOKEN_BROKER_URL env var; set to http://gh-token-broker:9099 if the env is not passed to plugin workers.",
      },
      tokenBrokerApiKey: {
        type: "string",
        // NOT format:"secret-ref" — same reasoning as paperclipApiToken below
        // (this host strips secret-ref fields from saved config, so marking it
        // would leave the worker with NO bearer and every broker mint would 401).
        // Since M3 (PR #356) the broker REQUIRES this bearer; plugin workers are
        // sandboxed away from GH_BROKER_API_KEY(_FILE), so it MUST arrive here.
        title: "Token Broker API key (bearer, M3/GOL-666)",
        description:
          "Bearer presented to gh-token-broker (matches GH_BROKER_API_KEY on the broker side). REQUIRED whenever the broker is used — since PR #356 the broker rejects unauthenticated mints with HTTP 401, which surfaces as the PR-review pipeline 'failed to fetch PR changed files'. Set to the same value as /opt/agenticos/secrets/gh-broker-client.key.",
      },
      githubToken: {
        type: "string",
        // format: "secret-ref" marks this as the (only) secret-bearing field.
        // Beyond its semantic meaning, it's load-bearing: the host's config
        // secret-ref extractor falls back to flagging ANY UUID-looking string as a
        // secret reference when NO field declares format:"secret-ref". Our
        // bridges[].paperclipProjectId values ARE UUIDs, so without this the whole
        // config is rejected ("secret references are disabled"). Declaring one
        // secret-ref field scopes the extractor to this path only.
        format: "secret-ref",
        title: "GitHub Token (fallback)",
        description:
          "Optional static PAT used only when no token broker is configured. Normally unset — auth uses the GitHub App via the broker, which works across orgs and needs no stored secret.",
      },
      companyId: {
        type: "string",
        title: "Company ID (inbound)",
        description:
          "UUID of the company owning the synced projects. Required for the inbound leg — the public webhook has no actor, so ctx.issues.create needs the company explicitly.",
      },
      inboundWebhookSecret: {
        type: "string",
        // Deliberately NOT format:"secret-ref": this host strips secret-ref
        // fields from saved config (ref resolution is disabled until
        // company-scoped plugin config lands), so marking it meant the worker
        // saw NO secret and rejected every inbound delivery (verified live
        // 2026-07-08). The raw hex value is not UUID-shaped, so it passes the
        // extractor as long as one field (githubToken) stays secret-ref.
        title: "Inbound webhook HMAC secret (custom workflow path)",
        description:
          "Shared secret the GitHub Actions workflow signs the inbound payload with (X-Hub-Signature-256). onWebhook verifies it before creating a mirror issue. Set the SAME value as the workflow's PAPERCLIP_ISSUE_SYNC_SECRET repo secret. Only needed for the `github-issue` endpoint; the `github-app` endpoint uses appWebhookSecret instead.",
      },
      appWebhookSecret: {
        type: "string",
        // NOT format:"secret-ref" — same reason as inboundWebhookSecret above.
        title: "GitHub App webhook secret (native issues path)",
        description:
          "The webhook secret configured on the AgenticOS Developer GitHub App. Verifies X-Hub-Signature-256 on native `issues` events delivered to the `github-app` endpoint. Set this to the SAME value as the App's webhook secret. Preferred over per-repo inboundWebhookSecret — one secret covers every installed repo.",
      },
      opsWebhookUrl: {
        type: "string",
        title: "Ops webhook URL (Discord)",
        description:
          "Optional Discord (or Discord-compatible) webhook URL. When set, the plugin posts a best-effort `{content}` ping on every inbound mirror creation so triage is never silent — including a loud warning when the mirror landed unassigned. A failed ping never blocks mirror creation. Also carries the PR-review state-change pings (System 3): review-issues-created, re-review-on-new-commits, and pipeline errors — and 🚨 swallowed-failure alerts (GOL-296) when a caught exception in onWebhook or an event dispatch would otherwise vanish into server.log.",
      },
      opsPingMode: {
        type: "string",
        enum: ["outcomes", "verbose", "errors"],
        title: "Ops ping noise policy (0.12.1)",
        description:
          "What the ops webhook receives. 'outcomes' (default when unset): sign-off ✅ / changes-requested ❌ / CI-fix / reconcile 🧹 plus every error-class ping; drops 🔍 review-created and 🔁 re-review lifecycle chatter and routine assigned-mirror pings. 'verbose': everything (pre-0.12.1 behaviour). 'errors': only error-class pings (🔥 pipeline errors, 🚨 swallowed failures, unassigned-mirror warnings — these pass every mode; an alert channel must never silently drop alerts).",
      },
      prReviewAliceAgentId: {
        type: "string",
        title: "PR review — lead reviewer (Ada) agent ID (GOL-158/GOL-713)",
        description:
          "Agent UUID that ALWAYS reviews every non-draft PR (spec System 2). Leave empty to disable the PR review pipeline (the `github-pr` webhook then no-ops). Company-global — the review issue is created in the matched bridge's project. Emits the `agent-review/ada` check (the Phase-3 required gate). Key id keeps its legacy `Alice` name for deployed-config compatibility; the reviewer slug was renamed alice→ada in GOL-713.",
      },
      prReviewIrisAgentId: {
        type: "string",
        title: "PR review — Iris agent ID (frontend, GOL-158)",
        description:
          "Agent UUID that ADDITIONALLY reviews a PR when any changed path matches prReviewFrontendPaths. Leave empty to skip frontend review even when frontend paths change.",
      },
      prReviewFrontendPaths: {
        type: "array",
        title: "PR review — frontend path globs (GOL-158)",
        description:
          "Changed-file globs that trigger a second (Iris) frontend review. Supports `*` (within a segment) and `**` (across segments). Defaults to [\"apps/dashboard/**\", \"**/*.tsx\", \"**/*.css\"] when empty.",
        items: { type: "string" },
      },
      ciAgentPrAuthor: {
        type: "string",
        title: "CI-fix — agent PR author login (GOL-305)",
        description:
          "GitHub login that authors agent PRs. The CI→Paperclip fix loop only opens a fix issue when a failing PR's author matches this. Defaults to \"agenticos-developer[bot]\" (the shared Developer App identity). The fix loop reuses prReviewAliceAgentId/prReviewIrisAgentId for owner routing and is off when prReviewAliceAgentId is unset.",
      },
      paperclipApiBaseUrl: {
        type: "string",
        title: "Paperclip API base URL (inbound scope-expiry REST fallback, GOL-323)",
        description:
          "Base URL of the Paperclip REST API, e.g. https://paperclip.gatheringatthegrove.com (no trailing slash needed). When set together with paperclipApiToken, an inbound ctx.issues.* write that fails with a host scope-expiry error is retried via the REST API — the board-authorized interim mitigation for the ~230 dropped inbound writes/day (GOL-295/GOL-300) until the upstream host scope-lifetime fix ships. Leave unset to disable the fallback (behaviour unchanged).",
      },
      paperclipApiToken: {
        type: "string",
        // NOT format:"secret-ref" — deliberately mirrors appWebhookSecret /
        // inboundWebhookSecret above (this host strips secret-ref fields from saved
        // config, so marking it would leave the worker with NO token and the
        // fallback permanently disabled). It must ALSO not be the single secret-ref
        // field: keeping githubToken as the sole format:"secret-ref" preserves the
        // extractor invariant (it flags UUID-shaped strings — our paperclipProjectId
        // values — only when NO field declares secret-ref). A raw bearer token is
        // not UUID-shaped, so it passes the extractor unflagged.
        title: "Paperclip API bearer token (scope-expiry REST fallback, GOL-323)",
        description:
          "Bearer token used to authenticate the Paperclip REST fallback (GOL-323). Only used on the already-failing inbound path — a scope-expiry retry. Required (with paperclipApiBaseUrl) to enable the fallback.",
      },
      paperclipCfAccessClientId: {
        type: "string",
        // NOT format:"secret-ref" — same reasoning as paperclipApiToken above.
        title: "Paperclip CF Access service-token client id (REST fallback, GOL-323)",
        description:
          "Cloudflare Access service-token CLIENT ID for the REST fallback. REQUIRED when paperclipApiBaseUrl is the CF-Access-gated public host (paperclip.gatheringatthegrove.com) — which is the ONLY reachable target, because the host's plugin http.outbound SSRF filter blocks the internal loopback (127.0.0.1). Without it CF Access 302-redirects the fallback request to the login page and the write is lost. Sent as the CF-Access-Client-Id header. Pair with paperclipCfAccessClientSecret.",
      },
      paperclipCfAccessClientSecret: {
        type: "string",
        // NOT format:"secret-ref" — same reasoning as paperclipApiToken above.
        title: "Paperclip CF Access service-token client secret (REST fallback, GOL-323)",
        description:
          "Cloudflare Access service-token CLIENT SECRET for the REST fallback. Sent as the CF-Access-Client-Secret header alongside paperclipCfAccessClientId so CF's non_identity service-token policy admits the request to the gated public host. Required (with the client id) whenever paperclipApiBaseUrl is CF-Access-gated.",
      },
    },
    required: ["bridges"],
  },
  // Event-driven + inbound webhook + the hourly mirror-reconcile job (0.12.0).
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
