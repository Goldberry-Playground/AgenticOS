import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { OdooClient } from "./odoo-client.js";
import { runRequestBatch } from "./request.js";
import { processReply, type ReceiveDeps } from "./receive.js";
import { runSweep } from "./sweep.js";
import { SweepGate } from "./sweep-gate.js";
import { isInvocationScopeError, withScopeRetry } from "./scope-retry.js";
import type { DrafterConfig, IssuePort, IssueLike, RequestState, StatePort } from "./ports.js";

/**
 * Origin marker on every request issue this plugin owns. Mirrors the discord
 * plugin's proven pattern (a plain `plugin:<id>` origin so the assigned agent is
 * woken to work it). Product-scoped `originId` (pt#<productId>) gives "one open
 * request per product"; `originKindPrefix` lets the sweep enumerate them.
 */
const ORIGIN_KIND = "plugin:agenticos.grove-content-drafter";
const OPEN_STATUSES = new Set(["backlog", "todo", "in_progress", "in_review"]);

function num(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function readConfig(raw: Record<string, unknown>): DrafterConfig {
  return {
    odooBaseUrl: String(raw.odooBaseUrl ?? "https://odoo.qa.gatheringatthegrove.com"),
    odooDb: String(raw.odooDb ?? "odoo"),
    odooUsername: String(raw.odooUsername ?? ""),
    odooPassword: String(raw.odooPassword ?? ""),
    houseRules: String(raw.houseRules ?? ""),
    companyId: String(raw.companyId ?? ""),
    groveProjectId: String(raw.groveProjectId ?? ""),
    drafterAgentId: String(raw.drafterAgentId ?? "c629faf1-cb50-4b7b-b766-3d68f71d54ed"),
    maxDraftsPerRun: num(raw.maxDraftsPerRun, 5),
    replyTimeoutHours: num(raw.replyTimeoutHours, 12),
    // dryRun defaults TRUE — never write until Josh explicitly enables it.
    dryRun: raw.dryRun === undefined ? true : Boolean(raw.dryRun),
  };
}

const REQUIRED = ["odooUsername", "odooPassword", "companyId", "groveProjectId", "drafterAgentId"] as const;

function toIssueLike(i: {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  originKind?: string | null;
  createdAt: string | Date;
}): IssueLike {
  return {
    id: i.id,
    title: i.title,
    description: i.description ?? null,
    status: i.status,
    originKind: i.originKind ?? null,
    createdAt: typeof i.createdAt === "string" ? i.createdAt : new Date(i.createdAt).toISOString(),
  };
}

/**
 * Adapt the host `ctx.issues` onto the company-bound {@link IssuePort}.
 *
 * Every call here is company-scoped, which is exactly the set the host's
 * invocation-scope gate fails CLOSED on for a scheduled job while any delivered
 * `onEvent` holds a scope — 15 minutes per event (GOL-2927 → GOL-3352). They are
 * all wrapped in {@link withScopeRetry} as a short grace, writes included — the
 * denial is a pre-flight gate, so a denied write performed no work and a retry
 * cannot double-post. The structural fix lives in `setup()`: the sweep also runs
 * inside the event handler, which does hold a scope. See `scope-retry.ts`.
 */
function makeIssuePort(ctx: PluginContext, cfg: DrafterConfig): IssuePort {
  const companyId = cfg.companyId;
  const retry = <T>(label: string, fn: () => Promise<T>): Promise<T> =>
    withScopeRetry(label, fn, { logger: ctx.logger });
  return {
    async openRequestExistsForProduct(originId) {
      const hits = await retry("issues.list/open-for-product", () =>
        ctx.issues.list({ companyId, originKind: ORIGIN_KIND, originId, limit: 10 }),
      );
      return hits.some((i) => OPEN_STATUSES.has(i.status));
    },
    async createRequestIssue({ title, description, originId }) {
      const issue = await retry("issues.create", () =>
        ctx.issues.create({
          companyId,
          projectId: cfg.groveProjectId,
          title,
          description,
          status: "todo",
          priority: "medium",
          assigneeAgentId: cfg.drafterAgentId,
          originKind: ORIGIN_KIND,
          originId,
        }),
      );
      return { id: issue.id };
    },
    async get(issueId) {
      const i = await retry("issues.get", () => ctx.issues.get(issueId, companyId));
      return i ? toIssueLike(i) : null;
    },
    async listOwnRequests(limit) {
      const list = await retry("issues.list/own-requests", () =>
        ctx.issues.list({ companyId, originKindPrefix: ORIGIN_KIND, limit }),
      );
      return list.map(toIssueLike).filter((i) => OPEN_STATUSES.has(i.status));
    },
    async listComments(issueId) {
      const comments = await retry("issues.listComments", () => ctx.issues.listComments(issueId, companyId));
      return comments.map((c) => ({
        authorAgentId: c.authorAgentId ?? null,
        body: c.body ?? "",
        createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
      }));
    },
    async postComment(issueId, body) {
      await retry("issues.createComment", () => ctx.issues.createComment(issueId, body, companyId));
    },
    async wakeAssignee(issueId, reason) {
      await retry("issues.requestWakeup", () => ctx.issues.requestWakeup(issueId, companyId, { reason }));
    },
    async setStatus(issueId, status) {
      await retry("issues.update", () => ctx.issues.update(issueId, { status }, companyId));
    },
  };
}

/**
 * Adapt the host `ctx.state` onto the {@link StatePort}.
 *
 * `scopeKind: "company"` state reads/writes resolve to a company scope in the
 * SDK's `requestedCompanyScope()` and are gated like `ctx.issues.*`, so they get
 * the same {@link withScopeRetry} treatment (GOL-2927). `scopeKind: "issue"`
 * carries no company scope and is never gated — left unwrapped so the hot
 * per-issue path keeps zero added branching.
 */
function makeStatePort(ctx: PluginContext, cfg: DrafterConfig): StatePort {
  const retry = <T>(label: string, fn: () => Promise<T>): Promise<T> =>
    withScopeRetry(label, fn, { logger: ctx.logger });
  return {
    async getRequest(issueId) {
      const v = await ctx.state.get({ scopeKind: "issue", scopeId: issueId, stateKey: "request" });
      return (v as RequestState | null) ?? null;
    },
    async setRequest(issueId, state) {
      await ctx.state.set({ scopeKind: "issue", scopeId: issueId, stateKey: "request" }, state);
    },
    async getDraftedVersion(productKey) {
      const v = await retry("state.get/drafted-version", () =>
        ctx.state.get({
          scopeKind: "company",
          scopeId: cfg.companyId,
          namespace: "drafted-version",
          stateKey: productKey,
        }),
      );
      return (v as string | null) ?? null;
    },
    async setDraftedVersion(productKey, marker) {
      await retry("state.set/drafted-version", () =>
        ctx.state.set(
          { scopeKind: "company", scopeId: cfg.companyId, namespace: "drafted-version", stateKey: productKey },
          marker,
        ),
      );
    },
  };
}

interface Wired {
  cfg: DrafterConfig;
  receive: ReceiveDeps;
}

/** Build config + ports, or return null (logged) when required config is absent. */
function wire(ctx: PluginContext, cfg: DrafterConfig): Wired | null {
  const missing = REQUIRED.filter((k) => !cfg[k]);
  if (missing.length) {
    ctx.logger.info("content-drafter not configured — skipping", { missing });
    return null;
  }
  const odoo = new OdooClient({
    baseUrl: cfg.odooBaseUrl,
    db: cfg.odooDb,
    username: cfg.odooUsername,
    password: cfg.odooPassword,
  });
  const receive: ReceiveDeps = {
    odoo,
    issues: makeIssuePort(ctx, cfg),
    state: makeStatePort(ctx, cfg),
    cfg,
    now: new Date(),
    logger: ctx.logger,
  };
  return { cfg, receive };
}

/** Best-effort resolve the issue id from an issue.comment.created event. */
function resolveIssueId(event: PluginEvent): string | undefined {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const fromPayload =
    (p.issueId as string) ??
    (p.issue_id as string) ??
    ((p.comment as Record<string, unknown> | undefined)?.issueId as string) ??
    ((p.issue as Record<string, unknown> | undefined)?.id as string);
  if (fromPayload) return fromPayload;
  if (event.entityType === "issue") return event.entityId;
  return undefined;
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Grove content-drafter plugin starting (agent-backed)");

    // Phase 1 — request: open one issue per requested product for the agent.
    ctx.jobs.register("content-draft-request", async () => {
      const wired = wire(ctx, readConfig(await ctx.config.get()));
      if (!wired) return;
      const summary = await runRequestBatch({
        odoo: wired.receive.odoo,
        issues: wired.receive.issues,
        state: wired.receive.state,
        cfg: wired.cfg,
        now: new Date(),
        logger: ctx.logger,
      });
      ctx.logger.info("content-draft-request complete", summary as unknown as Record<string, unknown>);
    });

    // One gate for both sweep entry points (GOL-3352): at most one sweep runs,
    // at most one more waits. processReply is idempotent, so overlap would be
    // safe — just a pointless doubling of host round-trips.
    const sweepGate = new SweepGate();

    // Phase 2b — sweep: backstop the event + handle reply timeouts.
    //
    // This dispatch carries NO invocation scope, so the host denies every
    // company-scoped call in it for 15 minutes after each delivered comment
    // event (the TTL on `notify()`'s registerInvocation — GOL-3352). That is not
    // a failure to retry through: the event that holds the scope runs a scoped
    // sweep of its own below. Busy windows are, by definition, windows with
    // events, each of which now sweeps; quiet windows never collide. So an
    // exhausted scope retry here is logged and treated as "skipped — covered".
    ctx.jobs.register("content-draft-sweep", async () => {
      const wired = wire(ctx, readConfig(await ctx.config.get()));
      if (!wired) return;
      let gated;
      try {
        gated = await sweepGate.run(() => runSweep({ ...wired.receive, now: new Date() }));
      } catch (err) {
        if (!isInvocationScopeError(err)) throw err;
        ctx.logger.warn(
          "content-draft-sweep skipped: invocation scope held by a concurrent event; the event sweep covers this window",
          { error: err instanceof Error ? err.message : String(err) },
        );
        return;
      }
      if (gated.outcome === "coalesced") {
        ctx.logger.info("content-draft-sweep coalesced into a sweep already in flight");
        return;
      }
      ctx.logger.info("content-draft-sweep complete", gated.result as unknown as Record<string, unknown>);
    });

    // Phase 2 — receive: fast path on the drafting agent's reply. Company-wide
    // (comment events carry no reliable projectId); routed in-handler by state.
    //
    // This is the one dispatch the host DOES scope (deriveInvocationScope handles
    // onEvent), and the SDK runs the handler inside an AsyncLocalStorage holding
    // that invocation, so every host call awaited from here is stamped with it —
    // including a full sweep. Running the sweep here is what makes the scheduled
    // job's scope denial a no-op (GOL-3352): the very event that steals the
    // scope is the one that covers the window.
    ctx.events.on("issue.comment.created", async (event) => {
      const issueId = resolveIssueId(event);
      if (!issueId) return;
      let wired: Wired | null;
      try {
        wired = wire(ctx, readConfig(await ctx.config.get()));
        if (!wired) return;
        const outcome = await processReply({ ...wired.receive, now: new Date() }, issueId);
        if (outcome.status !== "ignored" && outcome.status !== "waiting") {
          ctx.logger.info("content-drafter reply handled", { issueId, ...outcome });
        }
      } catch (err) {
        ctx.logger.error("content-drafter reply handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      try {
        const gated = await sweepGate.run(() => runSweep({ ...wired.receive, now: new Date() }));
        if (gated.outcome === "coalesced") {
          ctx.logger.info("content-drafter: event sweep coalesced into a sweep already in flight", { issueId });
          return;
        }
        ctx.logger.info("content-drafter: event sweep complete", {
          issueId,
          ...(gated.result as unknown as Record<string, unknown>),
        });
      } catch (err) {
        ctx.logger.error("content-drafter: event sweep failed", {
          issueId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
