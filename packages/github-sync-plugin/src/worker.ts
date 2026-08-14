import { AsyncResource } from "node:async_hooks";
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { Issue, PluginContext, PluginEvent, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { GitHubClient } from "./github-client.js";
import { makeBrokerTokenProvider, staticTokenProvider } from "./broker.js";
import { getByRepoNumber, upsert, deleteByPaperclipIssueId } from "./mapping.js";
import {
  buildInboundDescription,
  buildMirrorOpsMessage,
  getHeader,
  parseGithubAppIssueEvent,
  parseInboundPayload,
  verifyGithubSignature,
  type InboundPayload,
} from "./inbound.js";
import {
  handleIssueCreated,
  handleIssueUpdated,
  resolveMirrorClosureStatus,
  type SyncDeps,
} from "./sync.js";
import { resolveRouting, type LabelRouting } from "./routing.js";
import {
  anyFrontendMatch,
  buildNewCommitsNote,
  buildPipelineErrorPing,
  buildReReviewPing,
  buildReviewIssueBody,
  buildReviewIssueTitle,
  buildReviewIssuesCreatedPing,
  CHECK_CONTEXT,
  classifyHeadChange,
  decideReviewAction,
  DEFAULT_FRONTEND_PATHS,
  isActionablePrAction,
  isNullBodyStatusError,
  parseGithubPrEvent,
  shortSha,
  type GithubPrEvent,
  type Reviewer,
} from "./pr-review.js";
import { getReviewRecord, upsertReviewRecord, listReviewRecordsUpdatedSince } from "./pr-review-store.js";
import { handleReviewSignoff } from "./pr-signoff.js";
import { runMirrorReconcile, buildReconcilePing } from "./reconcile.js";
import { runSignoffReconcile } from "./signoff-reconcile.js";
import { runInboundCloseReconcile, buildInboundCloseReconcilePing } from "./inbound-close-reconcile.js";
import { runInboundCreateReconcile, buildInboundCreateReconcilePing } from "./inbound-create-reconcile.js";
import {
  recordError,
  buildSwallowedFailurePing,
  buildFallbackFailurePing,
  OpsPingThrottle,
  withSuppressionNote,
} from "./error-log.js";
import { recordDelivery, WebhookRejection, type DeliveryOutcome } from "./delivery-log.js";
import {
  buildCiFixBody,
  buildCiFixOpenedPing,
  buildCiFixResolvedPing,
  buildCiFixTitle,
  buildCiFixUpdatedPing,
  buildCiReFailNote,
  buildCiResolvedNote,
  classifyCiState,
  decideCiFixAction,
  DEFAULT_AGENT_PR_AUTHOR,
  failingChecks,
  parseCiCompletionEvent,
  type CiCompletionEvent,
} from "./ci-failure.js";
import { getCiFailureRecord, upsertCiFailureRecord } from "./ci-failure-store.js";
import { PaperclipRestClient, withRestFallback, type FallbackFailure } from "./paperclip-rest.js";

/** Manifest-declared inbound webhook endpoint keys (GitHub → Paperclip). */
/** Custom Actions-workflow path: a signed {repo,number,title,body,url} payload. */
const INBOUND_ENDPOINT_KEY = "github-issue";
/** Native GitHub App path: GitHub's own signed `issues` event, one App webhook for all repos. */
const APP_WEBHOOK_ENDPOINT_KEY = "github-app";
/** GitHub App `pull_request` event path: the agent PR review pipeline (GOL-158). */
const PR_WEBHOOK_ENDPOINT_KEY = "github-pr";

/**
 * Sign-off reconcile lookback (GOL-1160). A strand is healed on the first hourly
 * sweep after it occurs, so a few days is ample slack; older rows are for PRs long
 * since merged/closed whose stranded check no longer gates anything. Kept small so
 * the sweep stays cheap (one check-run read per distinct head, most already green).
 */
const SIGNOFF_RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
/** Row cap per sweep — idempotent; the next run re-scans the same bounded window. */
const SIGNOFF_RECONCILE_ROW_CAP = 200;

/**
 * Inbound-close reconcile sweep (GOL-1206): how far back to look for GitHub-side
 * closes to mirror. Generous (14 days) because the sweep is idempotent and
 * loop-guarded — re-scanning a settled close is free — so a wide window only buys
 * resilience to a few missed cycles / a redeploy gap without unbounded cost.
 */
const INBOUND_CLOSE_RECONCILE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
/** Page cap per repo per run (100/page) — bounds a large repo's scan; a hit sets
 *  `truncated` and the freshest closes (sort=updated desc) are scanned first. */
const INBOUND_CLOSE_RECONCILE_MAX_PAGES = 5;

/**
 * Inbound-create reconcile sweep (GOL-1413): how far back to look for GitHub-side
 * issues that never got a Paperclip twin (inbound webhook outage). Same 14-day
 * window and page cap as the close leg — the sweep is idempotent and pre-checks
 * the mapping, so re-scanning a settled/already-mirrored issue is a cheap skip.
 */
const INBOUND_CREATE_RECONCILE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const INBOUND_CREATE_RECONCILE_MAX_PAGES = 5;

/** Captured in setup() so onWebhook (which only receives `input`) can reach ctx. */
let currentContext: PluginContext | null = null;

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Paperclip issue priorities (mirrors Issue["priority"] without importing the type). */
type IssuePriority = "critical" | "high" | "medium" | "low";
const PRIORITIES: readonly IssuePriority[] = ["critical", "high", "medium", "low"];

/** One repo ↔ project bridge. The same plugin can carry several (pluginKey is unique). */
interface BridgeConfig {
  githubOrg: string;
  githubRepo: string;
  paperclipProjectId: string;
  syncLabelPaperclip: string;
  syncMarkerGithub: string;
  /**
   * Deterministic default routing (GOL-80). When set, inbound mirror issues are
   * created ASSIGNED to this agent so they enter its heartbeat automatically —
   * without this a mirror lands unassigned and Paperclip agents never pick up
   * unassigned work (heartbeat rule #1), so GitHub issues pile up unowned.
   * Superseded by labelRouting/fallbackAssigneeAgentId (v0.6.0) when those are
   * set; kept as the backward-compatible last resort.
   */
  defaultAssigneeAgentId?: string;
  /**
   * Discipline routing by GitHub label (v0.6.0, GOL-150). label name → agent id.
   * Precedence infra=bug=alert > frontend > feature (see routing.ts). A matched
   * label assigns the mirror to that discipline's owner.
   */
  labelRouting?: LabelRouting;
  /**
   * Assignee when no routing label matches (v0.6.0 triage owner, e.g. CEO). Takes
   * precedence over defaultAssigneeAgentId for the no-label case.
   */
  fallbackAssigneeAgentId?: string;
  /** Priority for mirror issues from this bridge. Defaults to "medium". */
  defaultPriority?: IssuePriority;
}

interface GithubSyncConfig {
  bridges: BridgeConfig[];
  /** Override for GH_TOKEN_BROKER_URL (set if the env isn't passed to plugin workers). */
  tokenBrokerUrl?: string;
  /**
   * Bearer the broker requires since M3 (PR #356). Sandboxed plugin workers can't
   * read the GH_BROKER_API_KEY env/file, so this must be supplied via config or
   * every token mint 401s and the PR-review pipeline can't fetch changed files.
   */
  tokenBrokerApiKey?: string;
  /** Optional static-PAT fallback, used only when no broker is configured. */
  githubToken?: string;
  /** Company owning the synced projects — required to create inbound mirror issues. */
  companyId?: string;
  /** HMAC secret for the custom inbound GitHub webhook (verifies X-Hub-Signature-256). */
  inboundWebhookSecret?: string;
  /** HMAC secret configured on the GitHub App's webhook (native `issues` events). */
  appWebhookSecret?: string;
  /**
   * Optional Discord (or Discord-compatible) webhook URL. When set, the plugin
   * posts a best-effort ops ping on every mirror creation so inbound triage is
   * never silent (GOL-80). A failed ping never blocks mirror creation.
   */
  opsWebhookUrl?: string;
  /**
   * Ops-channel noise policy (2026-08-01 "4 pings per PR" complaint). A typical
   * agent PR emitted 🔍 open + 🔁 per push + ✅ per reviewer; only the outcomes
   * carry decision value.
   *  - "outcomes" (default): ✅/❌/CI-fix/🧹 + all error pings; 🔍/🔁 lifecycle
   *    chatter and routine assigned-mirror pings are dropped.
   *  - "verbose": everything (the pre-0.12.1 behaviour).
   *  - "errors": only 🔥/🚨-class pings (incl. the unassigned-mirror warning).
   */
  opsPingMode?: "verbose" | "outcomes" | "errors";
  /** PR review pipeline (GOL-158): agent that always reviews. Unset → pipeline off. */
  prReviewAliceAgentId?: string;
  /** PR review pipeline: agent that additionally reviews when frontend paths change. */
  prReviewIrisAgentId?: string;
  /** Changed-file globs that trigger the frontend (Iris) review. Defaults applied at use. */
  prReviewFrontendPaths?: string[];
  /**
   * GitHub login that authors agent PRs (GOL-305 CI-fix loop). A failing CI check
   * only opens a fix issue when the PR's author matches this. Defaults to
   * "agenticos-developer[bot]" (the shared Developer App identity).
   */
  ciAgentPrAuthor?: string;
  /**
   * Paperclip API base URL for the inbound scope-expiry REST fallback (GOL-323),
   * e.g. "https://paperclip.gatheringatthegrove.com". When set together with
   * paperclipApiToken, a scope-expiry on an inbound ctx.issues.* write is retried
   * via the REST API. Unset → fallback disabled (behaviour unchanged).
   */
  paperclipApiBaseUrl?: string;
  /**
   * Bearer token for the Paperclip REST scope-expiry fallback (GOL-323). Only
   * used on the already-failing inbound path. Deliberately NOT a secret-ref
   * config field (see manifest note) — it's a raw bearer token, not UUID-shaped.
   */
  paperclipApiToken?: string;
  /**
   * Cloudflare Access service-token client id / secret for the REST fallback
   * (GOL-323). REQUIRED when paperclipApiBaseUrl is the CF-Access-gated public
   * host — the only reachable target, since the host's plugin http.outbound SSRF
   * filter blocks the internal loopback (127.0.0.1). Without them CF Access
   * 302-redirects the fallback and the write is lost. Sent as CF-Access-Client-Id
   * / CF-Access-Client-Secret headers. Not secret-ref (raw, non-UUID values).
   */
  paperclipCfAccessClientId?: string;
  paperclipCfAccessClientSecret?: string;
}

function readConfig(raw: Record<string, unknown>): GithubSyncConfig {
  const rawBridges = Array.isArray(raw.bridges) ? raw.bridges : [];
  const bridges: BridgeConfig[] = rawBridges
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      const rawPriority = typeof o.defaultPriority === "string" ? o.defaultPriority.toLowerCase() : "";
      const defaultAssigneeAgentId = o.defaultAssigneeAgentId ? String(o.defaultAssigneeAgentId) : undefined;
      const fallbackAssigneeAgentId = o.fallbackAssigneeAgentId ? String(o.fallbackAssigneeAgentId) : undefined;
      // labelRouting: keep only string→non-empty-string entries. An empty/invalid
      // map is dropped (undefined) so resolveRouting falls straight to fallback.
      const labelRouting =
        o.labelRouting && typeof o.labelRouting === "object" && !Array.isArray(o.labelRouting)
          ? Object.fromEntries(
              Object.entries(o.labelRouting as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string" && v)
                .map(([k, v]) => [k, String(v)]),
            )
          : undefined;
      return {
        githubOrg: String(o.githubOrg ?? "EngineeringMoonBear"),
        githubRepo: String(o.githubRepo ?? ""),
        paperclipProjectId: String(o.paperclipProjectId ?? ""),
        syncLabelPaperclip: String(o.syncLabelPaperclip ?? "synced-from-paperclip"),
        syncMarkerGithub: String(o.syncMarkerGithub ?? "synced-from-github"),
        defaultAssigneeAgentId,
        fallbackAssigneeAgentId,
        ...(labelRouting && Object.keys(labelRouting).length > 0 ? { labelRouting } : {}),
        // Invalid/absent priority silently falls back to "medium" at create time.
        defaultPriority: (PRIORITIES as readonly string[]).includes(rawPriority)
          ? (rawPriority as IssuePriority)
          : undefined,
      };
    })
    // A bridge without a repo or project can't sync anything — drop it.
    .filter((b) => b.githubRepo && b.paperclipProjectId);

  return {
    bridges,
    tokenBrokerUrl: raw.tokenBrokerUrl ? String(raw.tokenBrokerUrl) : undefined,
    tokenBrokerApiKey: raw.tokenBrokerApiKey ? String(raw.tokenBrokerApiKey) : undefined,
    githubToken: raw.githubToken ? String(raw.githubToken) : undefined,
    companyId: raw.companyId ? String(raw.companyId) : undefined,
    inboundWebhookSecret: raw.inboundWebhookSecret ? String(raw.inboundWebhookSecret) : undefined,
    appWebhookSecret: raw.appWebhookSecret ? String(raw.appWebhookSecret) : undefined,
    opsWebhookUrl: raw.opsWebhookUrl ? String(raw.opsWebhookUrl) : undefined,
    opsPingMode:
      raw.opsPingMode === "verbose" || raw.opsPingMode === "errors" || raw.opsPingMode === "outcomes"
        ? raw.opsPingMode
        : undefined,
    prReviewAliceAgentId: raw.prReviewAliceAgentId ? String(raw.prReviewAliceAgentId) : undefined,
    prReviewIrisAgentId: raw.prReviewIrisAgentId ? String(raw.prReviewIrisAgentId) : undefined,
    prReviewFrontendPaths: Array.isArray(raw.prReviewFrontendPaths)
      ? raw.prReviewFrontendPaths.filter((p): p is string => typeof p === "string" && p.length > 0)
      : undefined,
    ciAgentPrAuthor: raw.ciAgentPrAuthor ? String(raw.ciAgentPrAuthor) : undefined,
    paperclipApiBaseUrl: raw.paperclipApiBaseUrl ? String(raw.paperclipApiBaseUrl) : undefined,
    paperclipApiToken: raw.paperclipApiToken ? String(raw.paperclipApiToken) : undefined,
    paperclipCfAccessClientId: raw.paperclipCfAccessClientId ? String(raw.paperclipCfAccessClientId) : undefined,
    paperclipCfAccessClientSecret: raw.paperclipCfAccessClientSecret
      ? String(raw.paperclipCfAccessClientSecret)
      : undefined,
  };
}

/**
 * Build the REST-bypass client (GOL-323) from config, or null when the fallback
 * is not configured (no base URL / token). Centralised so every scope-expiry
 * catch site constructs the client identically — including the CF Access
 * service-token headers, which are mandatory for the gated public host (the only
 * reachable target; the internal loopback is SSRF-blocked by the host).
 */
function restFallbackClient(ctx: PluginContext, cfg: GithubSyncConfig): PaperclipRestClient | null {
  if (!cfg.paperclipApiBaseUrl || !cfg.paperclipApiToken) return null;
  return new PaperclipRestClient({
    baseUrl: cfg.paperclipApiBaseUrl,
    token: cfg.paperclipApiToken,
    http: ctx.http,
    cfAccessClientId: cfg.paperclipCfAccessClientId,
    cfAccessClientSecret: cfg.paperclipCfAccessClientSecret,
  });
}

/** Bind the logger + REST client + failure hook `withRestFallback` needs at every catch site. */
function restFallbackDeps(ctx: PluginContext, cfg: GithubSyncConfig) {
  return {
    logger: ctx.logger,
    rest: restFallbackClient(ctx, cfg),
    // GOL-1485: every fallback path routes through here, so wiring the observability hook
    // once covers mirror.create, sync.get, reconcile.list, ci.*, close, etc. uniformly.
    onFallbackFailure: ({ site, status }: FallbackFailure) => recordFallbackFailure(ctx, cfg, site, status),
  };
}

/**
 * A REST-fallback FAILURE (GOL-1485). `withRestFallback` already emitted the `logger.error`
 * (host stderr, unchanged); this adds the two OBSERVABLE sinks so a dying fallback key (#457)
 * is seen in real time instead of going unnoticed until mirrors visibly stop:
 *   1. a durable `github_sync_error` row — queryable without a server.log dig;
 *   2. a throttled ⛔ Discord ops alert — one per (site, status) per window (error-class, so it
 *      passes every `opsPingMode`; an alert channel must never silently drop alerts).
 * Best-effort throughout: never masks the fallback error, which `withRestFallback` rethrows.
 */
async function recordFallbackFailure(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  site: string,
  status: number | undefined,
): Promise<void> {
  const code = status === undefined ? "no HTTP status" : `HTTP ${status}`;
  try {
    await recordError(ctx.db, {
      occurredAt: new Date().toISOString(),
      scope: "rest-fallback-failed",
      detail: `Paperclip REST fallback failed for ${site} (${code})`,
      context: { site, status },
    });
  } catch (writeErr) {
    ctx.logger.warn("failed to persist rest-fallback failure to github_sync_error", {
      site,
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }
  await postThrottledOpsAlert(ctx, cfg, buildFallbackFailurePing(site, status));
}

/**
 * Best-effort ops-visibility ping (GOL-80). Posts a Discord-style `{content}`
 * message to the configured webhook. Any failure is logged and swallowed — mirror
 * creation must never depend on the ops channel being reachable.
 */
/**
 * Process-wide throttle for repetitive ERROR-class ops alerts (GOL-724). Keyed by the
 * exact ping content, so one crash window plus GitHub redelivery can't spam N identical
 * `🔥 PR review pipeline error` / `🚨 github-sync failure` lines at ops. Long-lived
 * because the plugin worker is; state-change pings (mirror/review created) bypass it.
 */
const opsAlertThrottle = new OpsPingThrottle();

/**
 * Emit an error-class ops ping through {@link opsAlertThrottle}: the first of a burst of
 * identical alerts posts, the rest are suppressed for the window, and the next emit
 * carries a `(+N suppressed)` note so nothing is silently lost.
 */
async function postThrottledOpsAlert(ctx: PluginContext, cfg: GithubSyncConfig, content: string): Promise<void> {
  const decision = opsAlertThrottle.decide(content, Date.now());
  if (!decision.emit) return;
  await postOpsPing(ctx, cfg.opsWebhookUrl, withSuppressionNote(content, decision.suppressed));
}

/**
 * Ops-ping noise gate (opsPingMode, default "outcomes"). "error"-class pings pass
 * every mode — an alerting channel that can silently drop alerts is worse than a
 * noisy one. recordSwallowedFailure's 🚨 path bypasses this gate entirely for the
 * same reason.
 */
type OpsPingClass = "lifecycle" | "outcome" | "error";
function wantPing(cfg: GithubSyncConfig, klass: OpsPingClass): boolean {
  const mode = cfg.opsPingMode ?? "outcomes";
  if (klass === "error") return true;
  if (mode === "verbose") return true;
  if (mode === "outcomes") return klass === "outcome";
  return false; // "errors" mode: nothing but error-class
}

async function postOpsPing(ctx: PluginContext, webhookUrl: string | undefined, content: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await ctx.http.fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      ctx.logger.warn("ops webhook ping failed", { status: res.status });
    }
  } catch (err) {
    // Discord acks a successful webhook post with 204 No Content, which the SDK's
    // http.fetch surfaces as a thrown "Invalid response status code 204" (the
    // WHATWG Response constructor rejects a body on a null-body status). Treat
    // that as success — otherwise every ops ping looks like it failed, which is
    // why pipeline errors were invisible for weeks (GOL-179).
    if (isNullBodyStatusError(err)) return;
    ctx.logger.warn("ops webhook ping error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Record a SWALLOWED worker failure (GOL-296) to every sink we own, so a caught
 * exception is never invisible-until-a-server.log-dig again:
 *   1. `ctx.logger.error` — host stderr (unchanged; preserves the prior behaviour).
 *   2. the `github_sync_error` table — a durable, queryable per-plugin sink
 *      (`SELECT … ORDER BY occurred_at DESC`) reachable without server.log access.
 *   3. a 🚨 Discord ops-webhook alert — real-time paging when a delivery 200s with
 *      no mirror.
 * Sinks 2 and 3 are best-effort: the failure being reported must never be masked by
 * a secondary failure while writing it down.
 */
async function recordSwallowedFailure(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  scope: string,
  err: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  ctx.logger.error(scope, { ...context, error: detail });
  try {
    await recordError(ctx.db, {
      occurredAt: new Date().toISOString(),
      scope,
      detail,
      context,
    });
  } catch (writeErr) {
    ctx.logger.warn("failed to persist swallowed failure to github_sync_error", {
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }
  await postThrottledOpsAlert(ctx, cfg, buildSwallowedFailurePing(scope, detail));
}

/**
 * Record a PR-review / CI pipeline error (HMAC reject, broker-401 changed-file fetch
 * fail, check-post fail) to the same durable sinks as a swallowed failure, then page
 * ops through the throttle (GOL-724). Before this, these `🔥 PR review pipeline error`
 * pings were fire-and-forget: invisible to DB triage AND un-deduped, so a single crash
 * window spammed Discord. Now every one lands in `github_sync_error` (queryable without
 * a server.log dig) and identical alerts collapse to one per window.
 */
async function recordPipelineError(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  scope: string,
  detail: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  ctx.logger.warn(scope, { ...context, detail });
  try {
    await recordError(ctx.db, {
      occurredAt: new Date().toISOString(),
      scope,
      detail,
      context,
    });
  } catch (writeErr) {
    ctx.logger.warn("failed to persist pipeline error to github_sync_error", {
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }
  await postThrottledOpsAlert(ctx, cfg, buildPipelineErrorPing(detail));
}

/**
 * Best-effort per-delivery outcome record (GOL-1411). NEVER throws: recording a
 * delivery must not mask the outcome (or failure) it records, nor turn a clean
 * success into a 500 of its own. The Discord alert + `github_sync_error` row are
 * the loud path; this is the durable, queryable per-delivery status + the
 * failed-processing counter (`failedDeliveryCount`).
 */
async function safeRecordDelivery(
  ctx: PluginContext,
  input: PluginWebhookInput,
  outcome: DeliveryOutcome,
  detail?: string,
): Promise<void> {
  try {
    await recordDelivery(ctx.db, {
      requestId: input.requestId,
      endpointKey: input.endpointKey,
      event: getHeader(input.headers, "x-github-event") ?? null,
      deliveryGuid: getHeader(input.headers, "x-github-delivery") ?? null,
      outcome,
      detail: detail ?? null,
      occurredAt: new Date().toISOString(),
    });
  } catch (err) {
    ctx.logger.warn("failed to persist webhook delivery outcome", {
      endpointKey: input.endpointKey,
      outcome,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Route an issue event to the bridge for its project, with per-event error
 * isolation (a handler must never throw back onto the bus).
 *
 * WHY company-wide + in-handler routing instead of a `{ projectId }` subscription
 * filter: the host's issue.created/issue.updated events carry a DELTA payload that
 * does not reliably include `projectId` (the event-bus filter reads
 * `payload.projectId`, which is often absent), so a project-scoped filter silently
 * drops every event. We instead subscribe company-wide and read the full issue back
 * to learn its real project, then dispatch to the matching bridge — or skip if the
 * issue isn't in a synced project. Scoping to configured projects is preserved; it
 * just no longer depends on the event payload's shape.
 */
function makeDispatch(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  depsByProject: Map<string, SyncDeps>,
  handle: (deps: SyncDeps, input: { issueId: string; companyId: string }) => Promise<void>,
  eventName: string,
) {
  return async (event: PluginEvent) => {
    try {
      if (!event.entityId) {
        ctx.logger.warn(`${eventName} event missing entityId; skipping`);
        return;
      }
      const issue = await withRestFallback(
        restFallbackDeps(ctx, cfg),
        `${eventName}.get`,
        () => ctx.issues.get(event.entityId!, event.companyId),
        async (rest) => (await rest.getIssue(event.entityId!)) as Issue | null,
      );
      if (!issue) {
        ctx.logger.warn(`${eventName}: issue not readable; skipping`, {
          issueId: event.entityId,
        });
        return;
      }
      const deps = issue.projectId ? depsByProject.get(issue.projectId) : undefined;
      if (!deps) return; // not in a synced project — ignore quietly
      await handle(deps, { issueId: event.entityId, companyId: event.companyId });
    } catch (err) {
      // Swallowed here so one bad event never throws back onto the bus. Report it to
      // every sink we own (log + github_sync_error + Discord) so it isn't invisible.
      await recordSwallowedFailure(ctx, cfg, `${eventName} handler failed`, err, {
        issueId: event.entityId,
      });
    }
  };
}

/** Find the bridge whose repo matches "org/repo" or the bare repo name. */
function matchBridge(cfg: GithubSyncConfig, repo: string): BridgeConfig | undefined {
  return cfg.bridges.find(
    (b) =>
      `${b.githubOrg}/${b.githubRepo}`.toLowerCase() === repo.toLowerCase() ||
      b.githubRepo.toLowerCase() === repo.toLowerCase(),
  );
}

/**
 * Shared inbound tail. Dedupe an already-mirrored GitHub issue, else create the
 * mirror Paperclip issue and record the mapping (origin "github") up front so the
 * issue.created event it triggers is seen as already-mapped and NOT bounced back.
 */
async function createMirrorIssue(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  bridge: BridgeConfig,
  payload: InboundPayload,
  labels: readonly string[] = [],
  runInScope: InvocationScopeRunner = (fn) => fn(),
): Promise<void> {
  if (!cfg.companyId) {
    ctx.logger.error("inbound webhook: companyId not configured — cannot create issue");
    return;
  }

  // Idempotency: skip redeliveries of an already-mirrored GitHub issue. This also
  // catches Paperclip-origin issues (outbound sync recorded their mapping first).
  const existing = await getByRepoNumber(ctx.db, payload.repo, payload.number);
  if (existing) {
    ctx.logger.info("inbound webhook: already mirrored; skipping", {
      repo: payload.repo,
      number: payload.number,
    });
    return;
  }

  // Discipline routing (GOL-150, v0.6.0): resolve the assignee from the issue's
  // GitHub labels, falling back to the triage owner, then the legacy default
  // (GOL-80). Without an assignee the mirror lands unowned and no agent ever picks
  // it up (heartbeat rule #1), so an unresolved routing is surfaced loudly below.
  const routing = resolveRouting(bridge, labels);
  const assigneeAgentId = routing.assigneeAgentId;
  // Re-enter the captured host invocation scope for the privileged write. Without
  // this the create can fire after the webhook's HTTP-200 has expired the scope
  // ("missing, expired, or unknown invocation scope"), which is the intermittent
  // mirror-drop of GOL-300/GOL-295. See captureInvocationScope (GOL-179).
  const createInput = {
    companyId: cfg.companyId!,
    projectId: bridge.paperclipProjectId,
    title: payload.title,
    description: buildInboundDescription(payload),
    status: "todo" as const,
    priority: bridge.defaultPriority ?? "medium",
    ...(assigneeAgentId ? { assigneeAgentId } : {}),
  };
  // REST-bypass fallback (GOL-323): the host may expire the scope after HTTP-200
  // before this write lands. On that error ONLY, retry via the Paperclip REST API.
  const issue = await withRestFallback<{ id: string }>(
    restFallbackDeps(ctx, cfg),
    "mirror.create",
    () => runInScope(() => ctx.issues.create(createInput)),
    // companyId moves into the URL for the REST create; pass the rest of the payload.
    (rest) => {
      const { companyId: _companyId, ...restBody } = createInput;
      return rest.createIssue(cfg.companyId!, restBody);
    },
  );

  await upsert(ctx.db, {
    paperclipIssueId: issue.id,
    githubRepo: payload.repo,
    githubIssueNumber: payload.number,
    lastSyncedAt: new Date().toISOString(),
    origin: "github",
  });

  ctx.logger.info("inbound: created Paperclip issue from GitHub", {
    repo: payload.repo,
    number: payload.number,
    projectId: bridge.paperclipProjectId,
    issueId: issue.id,
    assigneeAgentId: assigneeAgentId ?? null,
    routing: routing.reason,
    routedByLabel: routing.matchedLabel ?? null,
  });

  if (!assigneeAgentId) {
    // Surface the misconfiguration loudly: an unassigned mirror is the exact
    // silent-pileup failure GOL-80 exists to close.
    ctx.logger.warn(
      "inbound: mirror created UNASSIGNED — configure the bridge's labelRouting/fallbackAssigneeAgentId (or defaultAssigneeAgentId) so it enters an agent heartbeat",
      { repo: payload.repo, number: payload.number, projectId: bridge.paperclipProjectId },
    );
  }

  // Ops visibility: best-effort ping so inbound triage is never silent, and the
  // routing decision (which discipline label matched, or fallback) is visible.
  // An UNASSIGNED mirror is error-class (agents never pick up unassigned work);
  // a routine assigned mirror is lifecycle chatter under opsPingMode=outcomes.
  if (!wantPing(cfg, assigneeAgentId ? "lifecycle" : "error")) return;
  await postOpsPing(
    ctx,
    cfg.opsWebhookUrl,
    buildMirrorOpsMessage({
      repo: payload.repo,
      number: payload.number,
      title: payload.title,
      url: payload.url,
      projectId: bridge.paperclipProjectId,
      issueId: issue.id,
      assigneeAgentId,
      routedByLabel: routing.matchedLabel,
      routedByFallback: routing.reason === "fallback" || routing.reason === "default",
    }),
  );
}

/**
 * Custom Actions-workflow endpoint (`github-issue`): a per-repo workflow signs a
 * `{repo,number,title,body,url}` payload with the shared `inboundWebhookSecret`.
 */
async function handleCustomInbound(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  input: PluginWebhookInput,
  runInScope: InvocationScopeRunner,
): Promise<void> {
  // Verify BEFORE any enqueue/write, and THROW (not silent-return) on failure so
  // the receiver returns a non-2xx instead of the old dishonest 200 (GOL-1411).
  if (!cfg.inboundWebhookSecret) {
    throw new WebhookRejection("rejected_config", "inbound webhook: no inboundWebhookSecret configured");
  }
  if (!verifyGithubSignature(input.rawBody, cfg.inboundWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    throw new WebhookRejection("rejected_signature", "inbound webhook: signature verification failed");
  }

  const payload = parseInboundPayload(input.parsedBody ?? safeJson(input.rawBody));
  if (!payload) {
    throw new WebhookRejection("invalid_payload", "inbound webhook: unparseable/invalid payload");
  }

  const bridge = matchBridge(cfg, payload.repo);
  if (!bridge) {
    ctx.logger.info("inbound webhook: repo not in a synced bridge; ignoring", { repo: payload.repo });
    return;
  }
  await createMirrorIssue(ctx, cfg, bridge, payload, [], runInScope);
}

/**
 * Inbound closure propagation (GitHub → Paperclip). When an agent PR merges with
 * a `Closes #N` keyword, GitHub natively closes issue #N and fires an `issues`
 * `closed` App-webhook event; `reopened` is the inverse. We look up the mirror
 * mapping and, when the mirror's status actually needs to change, write the new
 * Paperclip status. Unlike the `opened` path this deliberately DOES act on
 * Paperclip-origin issues — the whole point is to close the mirror of an issue
 * whose GitHub twin we created outbound.
 *
 * Loop safety: `resolveMirrorClosureStatus` returns null when the mirror already
 * matches, so the outbound-close → GitHub-`closed`-echo → inbound path is a no-op
 * and never bounces. We do not create a mirror on close/reopen — an unmapped
 * GitHub issue has no Paperclip twin to propagate to.
 *
 * Returns a `ClosureOutcome` so the polling inbound-close reconcile sweep
 * (GOL-1206) can tally what each re-drive did; the event path ignores it. The
 * webhook and the sweep share this ONE code path — same mapping lookup, same
 * `resolveMirrorClosureStatus` matrix, same loop guard, same write — so the
 * polling fallback can never diverge from the event-driven behaviour.
 *
 * `pruned` (GOL-1274) is the self-heal outcome: the mirror is confirmed
 * permanently gone (twin hard-deleted), so the orphaned mapping is deleted rather
 * than counted `failed` and retried forever.
 */
type ClosureOutcome = "no-bridge" | "no-company" | "unmapped" | "unreadable" | "pruned" | "in-sync" | "propagated";

async function handleAppClosure(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  event: { action: string; payload: InboundPayload },
  runInScope: InvocationScopeRunner,
): Promise<ClosureOutcome> {
  const bridge = matchBridge(cfg, event.payload.repo);
  if (!bridge) {
    ctx.logger.info("app webhook: closure for repo not in a synced bridge; ignoring", {
      repo: event.payload.repo,
    });
    return "no-bridge";
  }
  if (!cfg.companyId) {
    ctx.logger.error("app webhook: companyId not configured — cannot propagate closure");
    return "no-company";
  }

  const mapping = await getByRepoNumber(ctx.db, event.payload.repo, event.payload.number);
  if (!mapping) {
    // No mirror exists — nothing to propagate. (We only mirror on `opened`.)
    ctx.logger.info("app webhook: closure for unmapped issue; nothing to propagate", {
      repo: event.payload.repo,
      number: event.payload.number,
      action: event.action,
    });
    return "unmapped";
  }

  // REST-bypass fallback (GOL-323): retry the read via REST only on scope-expiry.
  // REST returns the same-shaped issue JSON (id/status/…); the loose RestIssue is
  // cast to Issue so downstream typing (resolveMirrorClosureStatus) holds.
  const issue: Issue | null = await withRestFallback(
    restFallbackDeps(ctx, cfg),
    "closure.get",
    () => runInScope(() => ctx.issues.get(mapping.paperclipIssueId, cfg.companyId!)),
    async (rest) => (await rest.getIssue(mapping.paperclipIssueId)) as Issue | null,
  );
  if (!issue) {
    // Confirmed permanently gone, not a transient blip. `withRestFallback` returns
    // null ONLY on a positive not-found: the in-scope `ctx.issues.get` returns null
    // for a genuine 404, and the REST fallback returns null strictly on HTTP 404
    // (a 5xx/timeout throws a PaperclipRestError, which propagates here and is tallied
    // `failed`, not returned as null). So reaching this branch means the Paperclip
    // twin was hard-deleted and its mapping row is orphaned — every hourly sweep would
    // otherwise re-find it, read null, and count it `failed`, paging ops forever
    // (GOL-1273). Self-heal by pruning the stale row; next sweep sees the GitHub twin
    // as unmapped → a silent skip (GOL-1274).
    const deleted = await deleteByPaperclipIssueId(ctx.db, mapping.paperclipIssueId);
    ctx.logger.info("app webhook: mirror issue gone; pruned orphaned mapping (self-heal)", {
      issueId: mapping.paperclipIssueId,
      repo: event.payload.repo,
      number: event.payload.number,
      action: event.action,
      rowsDeleted: deleted,
    });
    return "pruned";
  }

  const target = resolveMirrorClosureStatus(event.action, issue.status);
  if (!target) {
    // Already in sync — the loop guard. No update, no bounce.
    ctx.logger.info("app webhook: mirror already in sync; skipping (loop guard)", {
      issueId: issue.id,
      action: event.action,
      status: issue.status,
    });
    return "in-sync";
  }

  // REST-bypass fallback (GOL-323): retry the status write via REST on scope-expiry.
  await withRestFallback(
    restFallbackDeps(ctx, cfg),
    "closure.update",
    async () => {
      await runInScope(() => ctx.issues.update(issue.id, { status: target }, cfg.companyId!));
    },
    async (rest) => {
      await rest.updateIssue(issue.id, { status: target });
    },
  );
  await upsert(ctx.db, { ...mapping, lastSyncedAt: new Date().toISOString() });

  ctx.logger.info("app webhook: propagated GitHub closure to Paperclip mirror", {
    issueId: issue.id,
    repo: event.payload.repo,
    number: event.payload.number,
    action: event.action,
    status: target,
  });
  return "propagated";
}

/**
 * Native GitHub App endpoint (`github-app`): GitHub delivers its own signed
 * `issues` event for EVERY installed repo. We verify the App webhook secret,
 * mirror `opened` issues (skipping Paperclip-origin via the label guard), and
 * propagate `closed`/`reopened` onto an existing mirror (closure propagation).
 */
async function handleAppInbound(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  input: PluginWebhookInput,
  runInScope: InvocationScopeRunner,
): Promise<void> {
  // Verify BEFORE any enqueue/write and THROW on failure (GOL-1411): the receiver
  // must return a non-2xx for an unsigned/misconfigured delivery, not the old
  // dishonest 200 that made GitHub's delivery log green while inbound was dead.
  if (!cfg.appWebhookSecret) {
    throw new WebhookRejection("rejected_config", "app webhook: no appWebhookSecret configured");
  }
  if (!verifyGithubSignature(input.rawBody, cfg.appWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    throw new WebhookRejection("rejected_signature", "app webhook: signature verification failed");
  }

  // GitHub sets X-GitHub-Event; ignore anything but `issues`. Lenient if absent.
  const eventType = getHeader(input.headers, "x-github-event");
  if (eventType && eventType !== "issues") {
    ctx.logger.info("app webhook: ignoring non-issues event", { eventType });
    return;
  }

  const event = parseGithubAppIssueEvent(input.parsedBody ?? safeJson(input.rawBody));
  if (!event) {
    ctx.logger.warn("app webhook: unparseable/invalid issues payload");
    return;
  }

  // Closure propagation (GitHub → Paperclip): a merged `Closes #N` PR closes the
  // GitHub issue → `closed`; `reopened` is the inverse. Handled before the
  // opened-only guard, and intentionally without the Paperclip-origin label skip.
  if (event.action === "closed" || event.action === "reopened") {
    await handleAppClosure(ctx, cfg, event, runInScope);
    return;
  }
  if (event.action !== "opened") {
    ctx.logger.info("app webhook: ignoring issue action", { action: event.action });
    return;
  }

  const bridge = matchBridge(cfg, event.payload.repo);
  if (!bridge) {
    ctx.logger.info("app webhook: repo not in a synced bridge; ignoring", { repo: event.payload.repo });
    return;
  }

  // Loop guard: never mirror an issue GitHub already shows as Paperclip-origin.
  // createMirrorIssue's getByRepoNumber dedupe also catches these, but the label
  // check avoids a needless read and is robust if the mapping row is missing.
  if (event.labels.some((l) => l.toLowerCase() === bridge.syncLabelPaperclip.toLowerCase())) {
    ctx.logger.info("app webhook: issue is Paperclip-origin (label); skipping", {
      repo: event.payload.repo,
      number: event.payload.number,
    });
    return;
  }

  // Pass the issue's labels so discipline routing (v0.6.0) can pick the assignee.
  await createMirrorIssue(ctx, cfg, bridge, event.payload, event.labels, runInScope);
}

/**
 * Build a write-capable GitHubClient for one bridge, preferring the gh-token-broker
 * (repo-scoped App tokens, cross-org) and falling back to a static PAT. Returns
 * null when no auth is available. Used by the PR pipeline's onWebhook path, which
 * (unlike setup) has no prebuilt per-project client to hand.
 */
function makeBridgeGithubClient(cfg: GithubSyncConfig, bridge: BridgeConfig): GitHubClient | null {
  const brokerUrl = cfg.tokenBrokerUrl || process.env.GH_TOKEN_BROKER_URL || "";
  if (brokerUrl) {
    return new GitHubClient({
      org: bridge.githubOrg,
      getToken: makeBrokerTokenProvider(brokerUrl, bridge.githubOrg, { apiKey: cfg.tokenBrokerApiKey }),
    });
  }
  if (cfg.githubToken) {
    return new GitHubClient({ org: bridge.githubOrg, getToken: staticTokenProvider(cfg.githubToken) });
  }
  return null;
}

/** Outcome of processing one reviewer for a PR event, for ping aggregation. */
type ReviewOutcome = "created" | "reopened" | "noop";

/**
 * Native GitHub App `pull_request` endpoint (`github-pr`): the agent PR review
 * pipeline (GOL-158, spec System 2). Verifies the App webhook secret, filters to
 * non-draft actionable actions, fetches the PR's changed files via the broker
 * token, then per reviewer (Ada always; Iris when a changed path matches the
 * frontend globs):
 *   - creates a review issue in the matched bridge's project (first time), or
 *   - reopens it with a "new commits" note when the head SHA changed, and
 *   - seeds/resets a pending `agent-review/*` check-run on the head SHA (best-effort).
 * Idempotent per (repo, PR, head SHA) via the github_pr_review store.
 */
/**
 * Runs a thunk inside a previously-captured async context. See
 * {@link captureInvocationScope}.
 */
type InvocationScopeRunner = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Snapshot the current async execution context so privileged `ctx.issues.*`
 * calls made *after* an outbound fetch still carry the host invocation scope.
 *
 * WHY: the SDK attaches the per-invocation scope to a privileged host call only
 * when its AsyncLocalStorage store is present (worker-rpc-host sends
 * `paperclipInvocationId` iff `getStore()` is truthy). The PR path must call
 * `github.listPullFiles()` first — an outbound undici `fetch` (github-client +
 * broker use the global `fetch`, not `ctx.http.fetch`) that drops the async
 * context. By the time we reach `ctx.issues.create` the store is gone and the
 * host rejects the write: "not allowed to perform issues.create: missing,
 * expired, or unknown invocation scope" (GOL-179, root-caused in GOL-178).
 *
 * We can't simply reorder the writes before the fetch: both the Iris reviewer
 * decision and the issue body need the fetched file list. Instead we capture the
 * context while it's still valid (before any outbound fetch) and re-enter it for
 * each privileged write. `ctx.http.fetch`/`ctx.logger` don't need the scope, so
 * the ops pings that run after the fetch are unaffected — and so is `ctx.db`,
 * whose namespace calls the host authorizes without the invocation scope.
 */
function captureInvocationScope(): InvocationScopeRunner {
  return AsyncResource.bind(<T>(fn: () => Promise<T>): Promise<T> => fn());
}

async function handlePrInbound(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  input: PluginWebhookInput,
): Promise<void> {
  // Verify BEFORE any enqueue/write and THROW on failure (GOL-1411). No Discord
  // alert on a rejection: an unsigned/unauthenticated probe is not an outage, and
  // paging on every probe would only be alert-noise. onWebhook records the
  // rejection to github_sync_delivery (queryable) and re-throws for the non-2xx.
  if (!cfg.appWebhookSecret) {
    throw new WebhookRejection("rejected_config", "pr webhook: no appWebhookSecret configured");
  }
  if (!verifyGithubSignature(input.rawBody, cfg.appWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    throw new WebhookRejection("rejected_signature", "pr webhook: signature verification failed");
  }

  // GitHub sets X-GitHub-Event; ignore anything but `pull_request`. Lenient if absent.
  const eventType = getHeader(input.headers, "x-github-event");
  if (eventType && eventType !== "pull_request") {
    ctx.logger.info("pr webhook: ignoring non-pull_request event", { eventType });
    return;
  }

  const ev = parseGithubPrEvent(input.parsedBody ?? safeJson(input.rawBody));
  if (!ev) {
    ctx.logger.warn("pr webhook: unparseable/invalid pull_request payload");
    return;
  }
  if (ev.draft) {
    ctx.logger.info("pr webhook: skipping draft PR", { repo: ev.repo, number: ev.number });
    return; // silent on drafts (spec System 3)
  }
  if (!isActionablePrAction(ev.action)) {
    ctx.logger.info("pr webhook: ignoring PR action", { action: ev.action, repo: ev.repo, number: ev.number });
    return;
  }

  const bridge = matchBridge(cfg, ev.repo);
  if (!bridge) {
    ctx.logger.info("pr webhook: repo not in a synced bridge; ignoring", { repo: ev.repo });
    return;
  }
  if (!cfg.companyId) {
    ctx.logger.error("pr webhook: companyId not configured — cannot create review issues");
    return;
  }
  if (!cfg.prReviewAliceAgentId) {
    ctx.logger.info("pr webhook: PR review pipeline disabled (no prReviewAliceAgentId configured)");
    return;
  }

  const github = makeBridgeGithubClient(cfg, bridge);
  if (!github) {
    ctx.logger.warn("pr webhook: no auth for bridge — cannot fetch PR files", { repo: ev.repo });
    return;
  }

  // Layer 1 (GOL — merge automation): a `synchronize` whose new head is a
  // GitHub-generated base-sync merge ("Update branch") carries no author work.
  // Reopening the review issue for it is what produced the ~202 junk "Review PR"
  // twins and re-pinged the operator for unchanged code. One cheap commit fetch
  // decides it; anything we cannot positively identify as a base-sync falls
  // through to the normal pipeline.
  if (ev.action === "synchronize") {
    const headSha = ev.after || ev.headSha;
    const commitRes = await github.getCommit(bridge.githubRepo, headSha);
    if (!commitRes.ok) {
      ctx.logger.warn("pr webhook: head commit fetch failed — treating as author work", {
        repo: ev.repo,
        number: ev.number,
        headSha,
        error: commitRes.error,
      });
    }
    const kind = classifyHeadChange({
      before: ev.before,
      head: commitRes.ok
        ? { parents: commitRes.data.parents, committerLogin: commitRes.data.committerLogin }
        : null,
    });
    if (kind === "base-sync") {
      ctx.logger.info("pr webhook: base-sync (Update branch) — skipping re-review", {
        repo: ev.repo,
        number: ev.number,
        before: ev.before,
        after: headSha,
      });
      return;
    }
  }

  // Capture the invocation scope BEFORE listPullFiles' outbound fetch drops the
  // async context; every privileged ctx.issues.* write below is re-entered into
  // it via `runInScope`. See captureInvocationScope (GOL-179).
  const runInScope = captureInvocationScope();

  const filesRes = await github.listPullFiles(bridge.githubRepo, ev.number);
  if (!filesRes.ok) {
    // A delivery that 200s but produces NO review issue/check dies HERE — e.g. the
    // broker mint 401s (missing `tokenBrokerApiKey` config) or GitHub rejects the
    // fetch. This used to be DB-invisible: only a Discord ops-ping fired, so
    // `github_sync_error` stayed empty and the silent tail was undiagnosable without
    // a server.log dig (GOL-721). Persist a queryable row alongside the ping.
    await recordSwallowedFailure(
      ctx,
      cfg,
      "pr webhook: failed to fetch PR changed files",
      filesRes.error,
      { repo: ev.repo, number: ev.number },
    );
    return;
  }
  const { files, truncated } = filesRes.data;
  if (truncated) {
    ctx.logger.warn("pr webhook: changed-file list truncated at the page cap — frontend match may under-report", {
      repo: ev.repo,
      number: ev.number,
    });
  }

  // Decide reviewers: Ada always; Iris when a changed path matches the frontend globs.
  // The `prReviewAliceAgentId` config key keeps its legacy name (deployed config
  // binds to it) but now holds Ada's agent UUID; the emitted reviewer slug is `ada`
  // (→ `agent-review/ada`, GOL-713).
  const frontendPaths = cfg.prReviewFrontendPaths?.length ? cfg.prReviewFrontendPaths : DEFAULT_FRONTEND_PATHS;
  const isFrontend = anyFrontendMatch(files, frontendPaths);
  const reviewers: Array<{ reviewer: Reviewer; agentId: string }> = [
    { reviewer: "ada", agentId: cfg.prReviewAliceAgentId },
  ];
  if (isFrontend && cfg.prReviewIrisAgentId) {
    reviewers.push({ reviewer: "iris", agentId: cfg.prReviewIrisAgentId });
  }

  const created: Reviewer[] = [];
  const reopened: Reviewer[] = [];
  for (const { reviewer, agentId } of reviewers) {
    try {
      const outcome = await processReviewer(ctx, cfg, bridge, github, ev, files, reviewer, agentId, runInScope);
      if (outcome === "created") created.push(reviewer);
      else if (outcome === "reopened") reopened.push(reviewer);
    } catch (err) {
      // Per-reviewer failure (issue create/update or seed-check). Was ops-ping-only;
      // now also lands in `github_sync_error` so a silent drop is queryable (GOL-721).
      await recordSwallowedFailure(ctx, cfg, "pr webhook: reviewer processing failed", err, {
        repo: ev.repo,
        number: ev.number,
        reviewer,
      });
    }
  }

  // Lifecycle pings (one per PR per transition) — dropped under opsPingMode=
  // "outcomes" (the default): with ✅/❌ carrying the decisions, 🔍/🔁 was the
  // bulk of the ~4-pings-per-PR channel noise.
  if (created.length && wantPing(cfg, "lifecycle")) {
    await postOpsPing(ctx, cfg.opsWebhookUrl, buildReviewIssuesCreatedPing(ev, created));
  }
  if (reopened.length && wantPing(cfg, "lifecycle")) {
    await postOpsPing(ctx, cfg.opsWebhookUrl, buildReReviewPing(ev, reopened));
  }
}

/**
 * Create-or-reopen the review issue for one reviewer, seeding/resetting the
 * pending check-run. Idempotent per head SHA (see github_pr_review):
 *   - no record            → create the review issue
 *   - record, same headSha → redelivery, no-op
 *   - record, new headSha  → reopen (todo) + "new commits" note (synchronize)
 */
async function processReviewer(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  bridge: BridgeConfig,
  github: GitHubClient,
  ev: GithubPrEvent,
  files: readonly string[],
  reviewer: Reviewer,
  agentId: string,
  runInScope: InvocationScopeRunner,
): Promise<ReviewOutcome> {
  const existing = await getReviewRecord(ctx.db, ev.repo, ev.number, reviewer);
  const action = decideReviewAction(existing ? existing.headSha : null, ev.headSha);
  if (action === "noop") {
    ctx.logger.info("pr webhook: already reviewed at this head SHA; skipping", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      headSha: ev.headSha,
    });
    return "noop";
  }

  const now = new Date().toISOString();
  if (action === "create" || !existing) {
    const createInput = {
      companyId: cfg.companyId!,
      projectId: bridge.paperclipProjectId,
      title: buildReviewIssueTitle(reviewer, ev),
      description: buildReviewIssueBody(reviewer, ev, files),
      status: "todo" as const,
      priority: bridge.defaultPriority ?? "medium",
      assigneeAgentId: agentId,
    };
    // Highest-volume drop site post-deploy (GOL-384): 7 of 13 observed drops.
    const issue = await withRestFallback<{ id: string }>(
      restFallbackDeps(ctx, cfg),
      "review.create",
      () => runInScope(() => ctx.issues.create(createInput)),
      (rest) => {
        const { companyId: _companyId, ...restBody } = createInput;
        return rest.createIssue(cfg.companyId!, restBody);
      },
    );
    await upsertReviewRecord(ctx.db, {
      githubRepo: ev.repo,
      prNumber: ev.number,
      reviewer,
      headSha: ev.headSha,
      paperclipIssueId: issue.id,
      updatedAt: now,
    });
    ctx.logger.info("pr webhook: created review issue", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      issueId: issue.id,
      assigneeAgentId: agentId,
    });
    await seedPendingCheck(ctx, github, bridge, ev, reviewer);
    return "created";
  }

  // New head SHA on an existing review: reopen + note, reset the pending check.
  const deps = restFallbackDeps(ctx, cfg);
  await withRestFallback(
    deps,
    "review.update",
    async () => {
      await runInScope(() => ctx.issues.update(existing.paperclipIssueId, { status: "todo" }, cfg.companyId!));
    },
    async (rest) => {
      await rest.updateIssue(existing.paperclipIssueId, { status: "todo" });
    },
  );
  const newCommitsNote = buildNewCommitsNote(reviewer, ev);
  await withRestFallback(
    deps,
    "review.comment",
    async () => {
      await runInScope(() => ctx.issues.createComment(existing.paperclipIssueId, newCommitsNote, cfg.companyId!));
    },
    (rest) => rest.createComment(existing.paperclipIssueId, newCommitsNote),
  );
  await upsertReviewRecord(ctx.db, {
    githubRepo: ev.repo,
    prNumber: ev.number,
    reviewer,
    headSha: ev.headSha,
    paperclipIssueId: existing.paperclipIssueId,
    updatedAt: now,
  });
  ctx.logger.info("pr webhook: reopened review issue for new commits", {
    repo: ev.repo,
    number: ev.number,
    reviewer,
    issueId: existing.paperclipIssueId,
    headSha: ev.headSha,
  });
  await seedPendingCheck(ctx, github, bridge, ev, reviewer);
  return "reopened";
}

/**
 * Seed/reset a pending `agent-review/*` check-run on the PR head SHA. Best-effort:
 * a failure (e.g. the App lacks `checks:write` during the Phase 2 soak) is logged
 * but never blocks review-issue creation, and — to keep the ops channel low-noise
 * during rollout — is NOT pinged. The check is completed to success later by
 * handleReviewSignoff (pr-signoff.ts, GOL-186) when the review issue closes `done`.
 */
async function seedPendingCheck(
  ctx: PluginContext,
  github: GitHubClient,
  bridge: BridgeConfig,
  ev: GithubPrEvent,
  reviewer: Reviewer,
): Promise<void> {
  const res = await github.createCheckRun(bridge.githubRepo, {
    name: CHECK_CONTEXT[reviewer],
    headSha: ev.headSha,
    title: `Agent review pending (${reviewer})`,
    summary: `Awaiting ${reviewer}'s review of ${ev.repo}#${ev.number} @ \`${shortSha(ev.headSha)}\`. Non-required during Phase 2 soak (GOL-158).`,
    detailsUrl: ev.url || undefined,
  });
  if (!res.ok) {
    ctx.logger.warn("pr webhook: pending check-run seed failed (needs App checks:write?)", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      status: res.status,
      error: res.error,
    });
  }
}

/**
 * CI → Paperclip fix-issue loop (GOL-305). Native GitHub App `check_suite` /
 * `workflow_run` **completed** events arrive on the same App webhook URL as
 * `issues`/`pull_request` and are fanned here by X-GitHub-Event. The event is only
 * a trigger: for each associated PR we re-derive the aggregate CI state from the
 * head SHA's check-runs (excluding the plugin's own `agent-review/*` checks), then:
 *   - red CI on an agent-authored open PR → open (or update-in-place) a fix issue
 *     assigned to the code owner (Ada, or Iris on frontend paths), and
 *   - a green suite → auto-close the open fix issue.
 * The github_ci_failure store keys one fix issue per (repo, PR#) — the loop-guard.
 *
 * Live verification depends on the App being subscribed to `check_suite` /
 * `workflow_run` (GOL-304). Until then this path never fires (GitHub delivers no
 * such events) and everything else is unchanged.
 */
async function handleCiCompletion(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  input: PluginWebhookInput,
  eventType: string,
): Promise<void> {
  // Verify BEFORE any enqueue/write and THROW on failure (GOL-1411); rejection is
  // recorded + non-2xx'd by onWebhook, no Discord alert (probe noise).
  if (!cfg.appWebhookSecret) {
    throw new WebhookRejection("rejected_config", "ci webhook: no appWebhookSecret configured");
  }
  if (!verifyGithubSignature(input.rawBody, cfg.appWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    throw new WebhookRejection("rejected_signature", `ci webhook: signature verification failed (${eventType})`);
  }

  const ev = parseCiCompletionEvent(input.parsedBody ?? safeJson(input.rawBody), eventType);
  if (!ev) {
    ctx.logger.warn("ci webhook: unparseable/invalid payload", { eventType });
    return;
  }
  if (ev.action !== "completed") {
    ctx.logger.info("ci webhook: ignoring non-completed action", { action: ev.action, eventType });
    return;
  }
  if (ev.prNumbers.length === 0) {
    // No same-repo PR is associated (fork PR or a push-triggered run) — there's no
    // PR to route a fix to. check_suite reliably carries pull_requests for agent
    // (same-repo) PRs, so this is the expected skip for everything else.
    ctx.logger.info("ci webhook: run not associated with a PR; ignoring", {
      repo: ev.repo,
      headSha: ev.headSha,
      eventType,
    });
    return;
  }

  const bridge = matchBridge(cfg, ev.repo);
  if (!bridge) {
    ctx.logger.info("ci webhook: repo not in a synced bridge; ignoring", { repo: ev.repo });
    return;
  }
  if (!cfg.companyId) {
    ctx.logger.error("ci webhook: companyId not configured — cannot manage fix issues");
    return;
  }
  if (!cfg.prReviewAliceAgentId) {
    // Reuses the PR-review owner config (Ada default, Iris on frontend). Unset →
    // the CI-fix loop is off, mirroring how the review pipeline gates.
    ctx.logger.info("ci webhook: CI-fix loop disabled (no prReviewAliceAgentId configured)");
    return;
  }

  const github = makeBridgeGithubClient(cfg, bridge);
  if (!github) {
    ctx.logger.warn("ci webhook: no auth for bridge — cannot manage fix issues", { repo: ev.repo });
    return;
  }

  // Capture the invocation scope BEFORE any outbound fetch drops the async context;
  // every privileged ctx.issues.* write is re-entered via runInScope (GOL-179).
  const runInScope = captureInvocationScope();

  for (const prNumber of ev.prNumbers) {
    try {
      await processCiPr(ctx, cfg, bridge, github, ev, prNumber, runInScope);
    } catch (err) {
      await recordPipelineError(
        ctx,
        cfg,
        "ci webhook: PR processing failed",
        `CI-fix handling failed for ${ev.repo}#${prNumber}`,
        { repo: ev.repo, prNumber, error: err instanceof Error ? err.message : String(err) },
      );
    }
  }
}

/**
 * Open / update / auto-close the fix issue for one PR. Idempotent per (repo, PR#)
 * via github_ci_failure:
 *   - green CI + open record   → close the fix issue (done) + resolved note
 *   - red CI   + no/closed rec → create a fix issue assigned to the code owner
 *   - red CI   + open record   → reopen (todo) + re-fail note, in place
 *   - pending / no CI checks    → no-op (wait for a terminal signal)
 * The author gate (agent-authored PR) + owner routing only run when we actually
 * create/update — the close path needs neither.
 */
async function processCiPr(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  bridge: BridgeConfig,
  github: GitHubClient,
  ev: CiCompletionEvent,
  prNumber: number,
  runInScope: InvocationScopeRunner,
): Promise<void> {
  const checksRes = await github.listCommitCheckRuns(bridge.githubRepo, ev.headSha);
  if (!checksRes.ok) {
    await recordPipelineError(
      ctx,
      cfg,
      "ci webhook: failed to list check-runs",
      `could not list check-runs for ${ev.repo}@${ev.headSha}: ${checksRes.error}`,
      { repo: ev.repo, prNumber, headSha: ev.headSha, error: checksRes.error },
    );
    return;
  }

  const state = classifyCiState(checksRes.data);
  const record = await getCiFailureRecord(ctx.db, ev.repo, prNumber);
  const action = decideCiFixAction(record, state);
  const now = new Date().toISOString();

  if (action === "noop") {
    ctx.logger.info("ci webhook: no action", {
      repo: ev.repo,
      prNumber,
      state,
      record: record?.status ?? null,
    });
    return;
  }

  if (action === "close") {
    // decideCiFixAction only returns "close" when record is present + open.
    const rec = record!;
    const closeDeps = restFallbackDeps(ctx, cfg);
    await withRestFallback(
      closeDeps,
      "ci.close.update",
      async () => {
        await runInScope(() => ctx.issues.update(rec.paperclipIssueId, { status: "done" }, cfg.companyId!));
      },
      async (rest) => {
        await rest.updateIssue(rec.paperclipIssueId, { status: "done" });
      },
    );
    const resolvedNote = buildCiResolvedNote(ev.headSha);
    await withRestFallback(
      closeDeps,
      "ci.close.comment",
      async () => {
        await runInScope(() => ctx.issues.createComment(rec.paperclipIssueId, resolvedNote, cfg.companyId!));
      },
      (rest) => rest.createComment(rec.paperclipIssueId, resolvedNote),
    );
    await upsertCiFailureRecord(ctx.db, { ...rec, headSha: ev.headSha, status: "closed", updatedAt: now });
    ctx.logger.info("ci webhook: auto-closed fix issue (CI green)", {
      repo: ev.repo,
      prNumber,
      issueId: rec.paperclipIssueId,
      headSha: ev.headSha,
    });
    if (wantPing(cfg, "outcome")) await postOpsPing(ctx, cfg.opsWebhookUrl, buildCiFixResolvedPing(ev.repo, prNumber));
    return;
  }

  // create / update — both gate on an agent-authored, still-open PR + owner routing.
  const prRes = await github.getPull(bridge.githubRepo, prNumber);
  if (!prRes.ok) {
    ctx.logger.error("ci webhook: failed to fetch PR", { repo: ev.repo, prNumber, error: prRes.error });
    return;
  }
  const pr = prRes.data;
  const agentAuthor = cfg.ciAgentPrAuthor || DEFAULT_AGENT_PR_AUTHOR;
  if (pr.authorLogin.toLowerCase() !== agentAuthor.toLowerCase()) {
    ctx.logger.info("ci webhook: PR not agent-authored; skipping", {
      repo: ev.repo,
      prNumber,
      author: pr.authorLogin,
    });
    return;
  }
  if (pr.state === "closed") {
    ctx.logger.info("ci webhook: PR is closed; not opening a fix issue", {
      repo: ev.repo,
      prNumber,
      merged: pr.merged,
    });
    return;
  }

  // Owner routing mirrors the PR-review pipeline: Iris when a changed path is
  // frontend (and Iris is configured), else Ada. A file-list fetch failure
  // degrades to Ada rather than dropping the fix.
  const filesRes = await github.listPullFiles(bridge.githubRepo, prNumber);
  const files = filesRes.ok ? filesRes.data.files : [];
  if (!filesRes.ok) {
    ctx.logger.warn("ci webhook: could not list PR files for owner routing; defaulting to Ada", {
      repo: ev.repo,
      prNumber,
      error: filesRes.error,
    });
  }
  const frontendPaths = cfg.prReviewFrontendPaths?.length ? cfg.prReviewFrontendPaths : DEFAULT_FRONTEND_PATHS;
  const owner =
    files.length > 0 && anyFrontendMatch(files, frontendPaths) && cfg.prReviewIrisAgentId
      ? { agentId: cfg.prReviewIrisAgentId, name: "Iris" }
      : { agentId: cfg.prReviewAliceAgentId!, name: "Ada" };

  const failed = failingChecks(checksRes.data);
  const fixCtx = {
    repo: ev.repo,
    prNumber,
    prUrl: pr.htmlUrl || ev.detailsUrl,
    prTitle: pr.title,
    headSha: ev.headSha,
    ownerName: owner.name,
    runName: ev.name,
    runUrl: ev.detailsUrl,
    failed,
  };

  if (action === "create") {
    const createInput = {
      companyId: cfg.companyId!,
      projectId: bridge.paperclipProjectId,
      title: buildCiFixTitle(fixCtx),
      description: buildCiFixBody(fixCtx),
      status: "todo" as const,
      // CI red blocks the merge — fix issues page higher than routine mirrors.
      priority: bridge.defaultPriority ?? "high",
      assigneeAgentId: owner.agentId,
    };
    const issue = await withRestFallback<{ id: string }>(
      restFallbackDeps(ctx, cfg),
      "ci.create",
      () => runInScope(() => ctx.issues.create(createInput)),
      (rest) => {
        const { companyId: _companyId, ...restBody } = createInput;
        return rest.createIssue(cfg.companyId!, restBody);
      },
    );
    await upsertCiFailureRecord(ctx.db, {
      githubRepo: ev.repo,
      prNumber,
      headSha: ev.headSha,
      paperclipIssueId: issue.id,
      status: "open",
      updatedAt: now,
    });
    ctx.logger.info("ci webhook: opened CI fix issue", {
      repo: ev.repo,
      prNumber,
      issueId: issue.id,
      assigneeAgentId: owner.agentId,
      failedCount: failed.length,
    });
    if (wantPing(cfg, "outcome")) await postOpsPing(ctx, cfg.opsWebhookUrl, buildCiFixOpenedPing(fixCtx));
    return;
  }

  // update — decideCiFixAction only returns "update" when record is present + open.
  const rec = record!;
  const updateDeps = restFallbackDeps(ctx, cfg);
  await withRestFallback(
    updateDeps,
    "ci.update",
    async () => {
      await runInScope(() => ctx.issues.update(rec.paperclipIssueId, { status: "todo" }, cfg.companyId!));
    },
    async (rest) => {
      await rest.updateIssue(rec.paperclipIssueId, { status: "todo" });
    },
  );
  const reFailNote = buildCiReFailNote(fixCtx);
  await withRestFallback(
    updateDeps,
    "ci.comment",
    async () => {
      await runInScope(() => ctx.issues.createComment(rec.paperclipIssueId, reFailNote, cfg.companyId!));
    },
    (rest) => rest.createComment(rec.paperclipIssueId, reFailNote),
  );
  await upsertCiFailureRecord(ctx.db, { ...rec, headSha: ev.headSha, status: "open", updatedAt: now });
  ctx.logger.info("ci webhook: updated CI fix issue (still failing)", {
    repo: ev.repo,
    prNumber,
    issueId: rec.paperclipIssueId,
    headSha: ev.headSha,
    failedCount: failed.length,
  });
  if (wantPing(cfg, "outcome")) await postOpsPing(ctx, cfg.opsWebhookUrl, buildCiFixUpdatedPing(fixCtx));
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("GitHub Sync plugin starting");

    // Capture ctx for onWebhook (the inbound handler only receives `input`).
    currentContext = ctx;

    // The github_sync_mapping table is created by migrations/001_init.sql, applied
    // by the host before worker init — runtime DDL is not permitted by ctx.db.

    const cfg = readConfig(await ctx.config.get());
    if (cfg.bridges.length === 0) {
      ctx.logger.warn(
        "no bridges configured — GitHub Sync is INACTIVE. Set config.bridges = [{ githubOrg, githubRepo, paperclipProjectId }]. The plugin refuses to mirror company-wide.",
      );
      return;
    }

    // Auth: prefer the gh-token-broker (repo-scoped GitHub App installation tokens,
    // cross-org). Fall back to a static PAT only if no broker URL is available.
    const brokerUrl = cfg.tokenBrokerUrl || process.env.GH_TOKEN_BROKER_URL || "";

    // Build a projectId → SyncDeps map. Subscriptions below are company-wide (the
    // event filter can't see projectId — see makeDispatch), so routing is by project.
    const depsByProject = new Map<string, SyncDeps>();
    // Full `owner/repo` slug → that bridge's client + bare repo name. The sign-off
    // completion path resolves through THIS (deps.resolveRepoClient) because
    // depsByProject is not injective: two bridges sharing one paperclipProjectId
    // collapse to the last bridge's github/config, which posted grove-odoo-modules
    // check completions to odoocker-goldberrygrove (PRs #44/#46).
    const clientsBySlug = new Map<string, { github: GitHubClient; repo: string }>();
    const bridgeSlugsByProject = new Map<string, string[]>();
    const resolveRepoClient = (repoSlug: string) => clientsBySlug.get(repoSlug.toLowerCase()) ?? null;
    for (const bridge of cfg.bridges) {
      let getToken;
      if (brokerUrl) {
        getToken = makeBrokerTokenProvider(brokerUrl, bridge.githubOrg, { apiKey: cfg.tokenBrokerApiKey });
      } else if (cfg.githubToken) {
        getToken = staticTokenProvider(cfg.githubToken);
      } else {
        ctx.logger.warn(
          `bridge ${bridge.githubOrg}/${bridge.githubRepo} has no auth (no GH_TOKEN_BROKER_URL / tokenBrokerUrl and no githubToken) — skipping`,
        );
        continue;
      }

      const github = new GitHubClient({ org: bridge.githubOrg, getToken });
      const slug = `${bridge.githubOrg}/${bridge.githubRepo}`;
      clientsBySlug.set(slug.toLowerCase(), { github, repo: bridge.githubRepo });
      bridgeSlugsByProject.set(bridge.paperclipProjectId, [
        ...(bridgeSlugsByProject.get(bridge.paperclipProjectId) ?? []),
        slug,
      ]);
      depsByProject.set(bridge.paperclipProjectId, {
        db: ctx.db,
        github,
        config: {
          githubRepo: bridge.githubRepo,
          syncLabelPaperclip: bridge.syncLabelPaperclip,
          syncMarkerGithub: bridge.syncMarkerGithub,
        },
        logger: ctx.logger,
        getIssue: (issueId, companyId) =>
          withRestFallback(
            restFallbackDeps(ctx, cfg),
            "sync.get",
            () => ctx.issues.get(issueId, companyId),
            async (rest) => (await rest.getIssue(issueId)) as Issue | null,
          ),
        postOpsPing: async (content, kind = "outcome") => {
          if (wantPing(cfg, kind)) await postOpsPing(ctx, cfg.opsWebhookUrl, content);
        },
        resolveRepoClient,
      });

      ctx.logger.info("bridge active", {
        repo: `${bridge.githubOrg}/${bridge.githubRepo}`,
        projectId: bridge.paperclipProjectId,
        auth: brokerUrl ? "gh-token-broker" : "static token",
      });
    }

    if (depsByProject.size === 0) {
      ctx.logger.warn("no usable bridges (all missing auth) — GitHub Sync is INACTIVE.");
      return;
    }

    // Shared paperclipProjectId = only the LAST bridge's deps handle that project's
    // issue events. Sign-off completions survive this (resolveRepoClient routes by
    // the row's repo slug), but the mirror path's config/github are still the last
    // bridge's — keep this loud until routing is per-bridge.
    for (const [projectId, slugs] of bridgeSlugsByProject) {
      if (slugs.length > 1) {
        ctx.logger.warn(
          "multiple bridges share one paperclipProjectId — issue-event dispatch uses only the LAST bridge's config",
          { projectId, bridges: slugs },
        );
      }
    }

    // One company-wide subscription per event type; makeDispatch routes each event
    // to the bridge for the issue's project (or drops it if not a synced project).
    ctx.events.on("issue.created", makeDispatch(ctx, cfg, depsByProject, handleIssueCreated, "issue.created"));
    ctx.events.on("issue.updated", makeDispatch(ctx, cfg, depsByProject, handleIssueUpdated, "issue.updated"));
    // Second issue.updated dispatch: complete the agent-review check-run when a PR
    // review issue closes `done` (GOL-186). Independent of the mirror path above —
    // it early-returns on issues with no github_pr_review row, and the mirror path
    // early-returns on unmapped review issues, so they never collide.
    ctx.events.on("issue.updated", makeDispatch(ctx, cfg, depsByProject, handleReviewSignoff, "issue.updated:signoff"));

    // Scheduled sweep (0.12.0): the event-driven mirror has no memory — issues
    // created before a bridge existed, or whose issue.created delivery dropped
    // (scope expiry, http.fetch timeout), stay twin-less forever. The hourly
    // reconcile lists each bridged project and mirrors active unmapped issues
    // through the same handleIssueCreated path, a few per run (see reconcile.ts).
    ctx.jobs.register("mirror-reconcile", async () => {
      try {
        if (!cfg.companyId) {
          ctx.logger.warn("mirror-reconcile: companyId not configured; skipping sweep");
          return;
        }
        const summary = await runMirrorReconcile({
          companyId: cfg.companyId,
          projectIds: Array.from(depsByProject.keys()),
          // REST fallback is NOT optional here (GOL-1163). A scheduled job has no
          // ambient invocation scope — there is no webhook delivery or event
          // dispatch to inherit one from — so this privileged read is the single
          // most scope-fragile call in the plugin. Bare, it threw "referenced a
          // missing, expired, or unknown invocation scope" on 2026-08-03 21:23Z
          // and the sweep has not created a twin since (38 issues left unmapped).
          // Same withRestFallback the inbound mirror path uses (GOL-323).
          listIssues: (projectId, status, offset, limit) =>
            withRestFallback<Issue[]>(
              restFallbackDeps(ctx, cfg),
              "reconcile.list",
              () =>
                ctx.issues.list({
                  companyId: cfg.companyId!,
                  projectId,
                  status: status as Issue["status"],
                  offset,
                  limit,
                }),
              async (rest) =>
                (await rest.listIssues(cfg.companyId!, {
                  projectId,
                  status,
                  offset,
                  limit,
                })) as unknown as Issue[],
            ),
          depsForProject: (projectId) => depsByProject.get(projectId),
          logger: ctx.logger,
        });
        ctx.logger.info("mirror-reconcile complete", summary as unknown as Record<string, unknown>);
        if (summary.created > 0 || summary.failed > 0) {
          if (wantPing(cfg, "outcome")) await postOpsPing(ctx, cfg.opsWebhookUrl, buildReconcilePing(summary));
        }
      } catch (err) {
        await recordSwallowedFailure(ctx, cfg, "mirror-reconcile job failed", err, {});
      }
    });

    // Sign-off reconcile sweep (GOL-1160): the event-driven handleReviewSignoff
    // strands a REQUIRED `agent-review/*` check `in_progress` forever if the
    // check-run completion hits a transient failure (broker 401, timeout, 5xx) on
    // the TERMINAL `done` transition — no later issue.updated re-fires its retry.
    // That blocks the Phase-3 merge gate until an admin bypass (observed 2026-08-03
    // on grove-sites#407 / odoocker#387 / grove-odoo-modules#68). This sweep re-drives
    // the SAME handler for any signed-off review issue whose check is not yet green.
    // Any bridge's deps carries the global resolveRepoClient, so one suffices to
    // route the post to the row's own repo (not the last-registered bridge).
    const signoffDeps = depsByProject.values().next().value!;
    ctx.jobs.register("signoff-reconcile", async () => {
      try {
        if (!cfg.companyId) {
          ctx.logger.warn("signoff-reconcile: companyId not configured; skipping sweep");
          return;
        }
        const companyId = cfg.companyId;
        const sinceIso = new Date(Date.now() - SIGNOFF_RECONCILE_WINDOW_MS).toISOString();
        const summary = await runSignoffReconcile({
          companyId,
          sinceIso,
          limit: SIGNOFF_RECONCILE_ROW_CAP,
          listRows: (since, limit) => listReviewRecordsUpdatedSince(ctx.db, since, limit),
          getIssueStatus: async (issueId, cId) => (await signoffDeps.getIssue(issueId, cId))?.status ?? null,
          resolveRepoClient,
          driveSignoff: (issueId) => handleReviewSignoff(signoffDeps, { issueId, companyId }),
          logger: ctx.logger,
        });
        ctx.logger.info("signoff-reconcile complete", summary as unknown as Record<string, unknown>);
      } catch (err) {
        await recordSwallowedFailure(ctx, cfg, "signoff-reconcile job failed", err, {});
      }
    });

    // Inbound-close reconcile sweep (GOL-1206): the polling inbound leg of closure
    // propagation. The GitHub App is installed ONLY on AgenticOS, so the
    // Goldberry-Playground bridged repos (grove-sites, odoocker-goldberrygrove,
    // grove-odoo-modules) never receive an `issues` `closed`/`reopened` App event —
    // a merged `Closes #N` PR closes the twin but nothing brings that close back into
    // Paperclip (mirror-reconcile is outbound-only). This hourly sweep lists each
    // bridged repo's recently-updated issues and re-drives the SAME handleAppClosure
    // code path per issue — same mapping lookup, same resolveMirrorClosureStatus
    // matrix, same loop guard, same REST-fallback write. AgenticOS stays a no-op here
    // (its closes reach the mirror event-driven before the sweep runs → loop guard
    // skips them). Idempotent and safe every cycle.
    ctx.jobs.register("inbound-close-reconcile", async () => {
      try {
        if (!cfg.companyId) {
          ctx.logger.warn("inbound-close-reconcile: companyId not configured; skipping sweep");
          return;
        }
        const sinceIso = new Date(Date.now() - INBOUND_CLOSE_RECONCILE_WINDOW_MS).toISOString();
        const summary = await runInboundCloseReconcile({
          repoSlugs: Array.from(clientsBySlug.keys()),
          listIssues: async (repoSlug) => {
            const entry = clientsBySlug.get(repoSlug);
            if (!entry) return { ok: false, error: "no client for repo" };
            const res = await entry.github.listIssues(entry.repo, {
              state: "all",
              since: sinceIso,
              maxPages: INBOUND_CLOSE_RECONCILE_MAX_PAGES,
            });
            if (!res.ok) return { ok: false, error: res.error };
            return {
              ok: true,
              issues: res.data.issues.map((i) => ({ number: i.number, state: i.state })),
              truncated: res.data.truncated,
            };
          },
          // Re-drive the event handler with NO ambient scope ((fn) => fn()); its
          // ctx.issues.get/update go through withRestFallback, so a cron-tick scope
          // expiry falls back to the Paperclip REST API (GOL-323/GOL-1163).
          driveClosure: ({ action, repoSlug, number }) =>
            handleAppClosure(
              ctx,
              cfg,
              { action, payload: { repo: repoSlug, number, title: "", body: "", url: "" } },
              (fn) => fn(),
            ),
          logger: ctx.logger,
        });
        ctx.logger.info("inbound-close-reconcile complete", summary as unknown as Record<string, unknown>);
        // Page on real work only: a propagate, an actionable failure (transient), OR a
        // one-time self-heal prune (observable cleanup, fires once per orphan then the
        // twin is unmapped — never a recurring page). Permanent deletions no longer land
        // in `failed`, so `failed > 0` is now purely actionable (GOL-1274).
        if (summary.propagated > 0 || summary.failed > 0 || summary.pruned > 0) {
          if (wantPing(cfg, "outcome"))
            await postOpsPing(ctx, cfg.opsWebhookUrl, buildInboundCloseReconcilePing(summary));
        }
      } catch (err) {
        await recordSwallowedFailure(ctx, cfg, "inbound-close-reconcile job failed", err, {});
      }
    });

    // Inbound-CREATE reconcile sweep (GOL-1413): the polling inbound leg of mirror
    // CREATION — the create counterpart to inbound-close-reconcile and the inbound
    // sibling the outbound mirror-reconcile (PR #444) never had. The inbound mirror
    // is event-driven only: a GitHub-native issue gets a Paperclip twin solely if
    // its webhook (App `opened` event, or the custom Actions POST) was delivered AND
    // the handler survived. If the inbound webhook is disabled / mis-delivered / its
    // handler drops (scope expiry, timeout), that issue is never revisited — neither
    // mirror-reconcile (outbound-only) nor inbound-close-reconcile (acts only on
    // already-mapped issues) will create it. This hourly sweep lists each bridged
    // repo's recently-OPEN issues and re-drives the SAME createMirrorIssue path the
    // webhook uses for any open, non-Paperclip-origin, unmapped issue — so a
    // deliberately-induced inbound-webhook outage self-heals within an hour (the DoD
    // self-heal net; absorbs grove-sites#473 / GOL-1300). AgenticOS stays a near
    // no-op (its opened issues are already mapped by the time the sweep runs).
    ctx.jobs.register("inbound-create-reconcile", async () => {
      try {
        if (!cfg.companyId) {
          ctx.logger.warn("inbound-create-reconcile: companyId not configured; skipping sweep");
          return;
        }
        const sinceIso = new Date(Date.now() - INBOUND_CREATE_RECONCILE_WINDOW_MS).toISOString();
        const summary = await runInboundCreateReconcile({
          repoSlugs: Array.from(clientsBySlug.keys()),
          // state:"open" — never create a pre-closed mirror (the close leg is
          // inbound-close-reconcile's job); `since` bounds the scan to the window.
          listIssues: async (repoSlug) => {
            const entry = clientsBySlug.get(repoSlug);
            if (!entry) return { ok: false, error: "no client for repo" };
            const res = await entry.github.listIssues(entry.repo, {
              state: "open",
              since: sinceIso,
              maxPages: INBOUND_CREATE_RECONCILE_MAX_PAGES,
            });
            if (!res.ok) return { ok: false, error: res.error };
            return {
              ok: true,
              issues: res.data.issues.map((i) => ({
                number: i.number,
                state: i.state,
                title: i.title,
                body: i.body,
                url: i.htmlUrl,
                labels: i.labels,
              })),
              truncated: res.data.truncated,
            };
          },
          // Re-drive the SAME inbound mirror-create the webhook uses. Owns the guards
          // (bridge / closed / Paperclip-origin label / already-mapped) so the sweep
          // tallies without duplicating createMirrorIssue's internals. No ambient
          // scope ((fn) => fn()); createMirrorIssue's writes go through withRestFallback,
          // so a cron-tick scope expiry falls back to the Paperclip REST API (GOL-323).
          driveCreate: async ({ repoSlug, issue }) => {
            const bridge = matchBridge(cfg, repoSlug);
            if (!bridge) return "no-bridge";
            if (issue.state === "closed") return "skipped-closed";
            // Loop guard: never mirror an issue GitHub already shows as Paperclip-origin
            // (mirrors the event-path label check in handleAppInbound).
            if (issue.labels.some((l) => l.toLowerCase() === bridge.syncLabelPaperclip.toLowerCase())) {
              return "skipped-paperclip-origin";
            }
            // Idempotency pre-check: an already-mirrored issue is a cheap skip, not a
            // create attempt (createMirrorIssue also dedupes internally as a backstop).
            if (await getByRepoNumber(ctx.db, repoSlug, issue.number)) return "skipped-mapped";
            await createMirrorIssue(
              ctx,
              cfg,
              bridge,
              { repo: repoSlug, number: issue.number, title: issue.title, body: issue.body, url: issue.url },
              issue.labels,
              (fn) => fn(),
            );
            // createMirrorIssue upserts the mapping on success and logs-and-returns on
            // failure (no throw), so the mapping row is the ground truth for success.
            return (await getByRepoNumber(ctx.db, repoSlug, issue.number)) ? "created" : "failed";
          },
          logger: ctx.logger,
        });
        ctx.logger.info("inbound-create-reconcile complete", summary as unknown as Record<string, unknown>);
        // Page on real work only: a create, or an actionable (retryable) failure.
        // createMirrorIssue already emits a per-mirror ops ping on each create, so this
        // summary ping is the sweep-level rollup.
        if (summary.created > 0 || summary.failed > 0) {
          if (wantPing(cfg, "outcome"))
            await postOpsPing(ctx, cfg.opsWebhookUrl, buildInboundCreateReconcilePing(summary));
        }
      } catch (err) {
        await recordSwallowedFailure(ctx, cfg, "inbound-create-reconcile job failed", err, {});
      }
    });

    ctx.logger.info("github sync listening", {
      projects: Array.from(depsByProject.keys()),
    });
  },

  /**
   * Inbound leg (GitHub → Paperclip). The host routes three public endpoints here:
   *   - `POST …/webhooks/github-issue` → a custom Actions-workflow payload,
   *   - `POST …/webhooks/github-app`   → the App's single webhook URL: `issues` and
   *       `pull_request` both arrive here and are fanned out by X-GitHub-Event, or
   *   - `POST …/webhooks/github-pr`    → GitHub's native `pull_request` event (review
   *       pipeline) via a direct-ingress path (e.g. Terra's CF bypass).
   * Each verifies its own HMAC (the plugin's responsibility) then creates the
   * mirror/review issue directly — routines can't, since every routine run needs an agent.
   */
  async onWebhook(input: PluginWebhookInput): Promise<void> {
    const ctx = currentContext;
    if (!ctx) return;

    // Capture the host invocation scope BEFORE any await — including
    // ctx.config.get() below and, critically, the webhook HTTP-200 send that the
    // host uses to expire the scope. On the inbound mirror/closure paths the
    // privileged ctx.issues.* write can otherwise fire after that teardown and be
    // rejected ("missing, expired, or unknown invocation scope"), the intermittent
    // drop root-caused in GOL-300/GOL-295. Every inbound handler re-enters this
    // scope for its writes via runInScope, matching the proven PR-path fix
    // (GOL-179). handlePrInbound still captures its own scope internally.
    const runInScope = captureInvocationScope();

    // `cfg` is read INSIDE the try: a throw from ctx.config.get()/readConfig used to
    // escape onWebhook and surface only as the host's opaque "host handler error"
    // line in server.log (GOL-296). Capturing it here means every failure path — not
    // just handler bodies — reaches recordSwallowedFailure below.
    let cfg: GithubSyncConfig | undefined;
    try {
      cfg = readConfig(await ctx.config.get());
      if (input.endpointKey === INBOUND_ENDPOINT_KEY) {
        await handleCustomInbound(ctx, cfg, input, runInScope);
      } else if (input.endpointKey === APP_WEBHOOK_ENDPOINT_KEY) {
        // A GitHub App has a single webhook URL, so once the App is subscribed to
        // `pull_request` those deliveries also land on `github-app` (not the separate
        // `github-pr` endpoint, which the App can't point a second event type at).
        // Fan out by X-GitHub-Event: `pull_request` → the review pipeline, everything
        // else → the issues-mirror handler (which self-filters to `issues`). The
        // dedicated `github-pr` endpoint remains a valid direct-ingress path; each
        // handler verifies the same appWebhookSecret, so both routes are equivalent.
        const ghEvent = getHeader(input.headers, "x-github-event");
        if (ghEvent === "pull_request") {
          await handlePrInbound(ctx, cfg, input);
        } else if (ghEvent === "check_suite" || ghEvent === "workflow_run") {
          // CI → Paperclip fix-issue loop (GOL-305): a failing check on an
          // agent-authored PR opens/updates an author-assigned fix issue; a green
          // suite auto-closes it. Same App webhook URL, fanned out by event type.
          await handleCiCompletion(ctx, cfg, input, ghEvent);
        } else {
          await handleAppInbound(ctx, cfg, input, runInScope);
        }
      } else if (input.endpointKey === PR_WEBHOOK_ENDPOINT_KEY) {
        await handlePrInbound(ctx, cfg, input);
      } else {
        ctx.logger.warn("inbound webhook: unknown endpoint", { endpointKey: input.endpointKey });
      }
      // Reached only when a handler completed without throwing: signature verified
      // (or the endpoint is a benign no-op) and any enqueue/write landed. Record the
      // honest success so per-delivery status is queryable, not merely absent.
      await safeRecordDelivery(ctx, input, "processed");
    } catch (err) {
      // GOL-1411 receiver honesty: whatever happened, record the per-delivery
      // outcome and RE-THROW so the host returns a non-2xx. The old code swallowed
      // every failure and let the host reply 200 — GitHub's delivery log stayed
      // green while inbound mirroring was dead (the ~20h-invisible 08-12 outage).
      if (err instanceof WebhookRejection) {
        // Verification / config / payload rejection detected BEFORE any enqueue.
        // Record it (queryable) but do NOT page Discord — an unauthenticated probe
        // is not an outage, and alerting on every probe is pure noise. Re-throw so
        // the host turns the delivery red (W1 maps err.httpStatus → 401).
        await safeRecordDelivery(ctx, input, err.outcome, err.message);
        throw err;
      }
      // A genuine processing failure AFTER a verified signature. Record it as the
      // failed-processing counter's source, page Discord (the loud path), and
      // re-throw for the non-2xx so GitHub retries. Retries are safe: the inbound
      // create dedupes on repo+number (getByRepoNumber) before writing, and the
      // reconcile sweeps heal any create-ok/mapping-miss window.
      const scope = `inbound webhook: handler failed (${input.endpointKey})`;
      const detail = err instanceof Error ? err.message : String(err);
      await safeRecordDelivery(ctx, input, "failed_processing", detail);
      if (cfg) {
        await recordSwallowedFailure(ctx, cfg, scope, err, { endpointKey: input.endpointKey });
      } else {
        // The config read itself threw — we have no opsWebhookUrl to page, but the DB
        // namespace is config-independent, so still persist to the queryable sink.
        ctx.logger.error(scope, { endpointKey: input.endpointKey, error: detail });
        try {
          await recordError(ctx.db, {
            occurredAt: new Date().toISOString(),
            scope,
            detail,
            context: { endpointKey: input.endpointKey },
          });
        } catch {
          // best-effort; host stderr above is the floor.
        }
      }
      throw err;
    }
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
