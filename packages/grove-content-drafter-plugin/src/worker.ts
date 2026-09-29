import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { OdooClient } from "./odoo-client.js";
import { runRequestBatch } from "./request.js";
import { processReply, type ReceiveDeps } from "./receive.js";
import { runSweep } from "./sweep.js";
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

/** Adapt the host `ctx.issues` onto the company-bound {@link IssuePort}. */
function makeIssuePort(ctx: PluginContext, cfg: DrafterConfig): IssuePort {
  const companyId = cfg.companyId;
  return {
    async openRequestExistsForProduct(originId) {
      const hits = await ctx.issues.list({ companyId, originKind: ORIGIN_KIND, originId, limit: 10 });
      return hits.some((i) => OPEN_STATUSES.has(i.status));
    },
    async createRequestIssue({ title, description, originId }) {
      const issue = await ctx.issues.create({
        companyId,
        projectId: cfg.groveProjectId,
        title,
        description,
        status: "todo",
        priority: "medium",
        assigneeAgentId: cfg.drafterAgentId,
        originKind: ORIGIN_KIND,
        originId,
      });
      return { id: issue.id };
    },
    async get(issueId) {
      const i = await ctx.issues.get(issueId, companyId);
      return i ? toIssueLike(i) : null;
    },
    async listOwnRequests(limit) {
      const list = await ctx.issues.list({ companyId, originKindPrefix: ORIGIN_KIND, limit });
      return list.map(toIssueLike).filter((i) => OPEN_STATUSES.has(i.status));
    },
    async listComments(issueId) {
      const comments = await ctx.issues.listComments(issueId, companyId);
      return comments.map((c) => ({
        authorAgentId: c.authorAgentId ?? null,
        body: c.body ?? "",
        createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
      }));
    },
    async postComment(issueId, body) {
      await ctx.issues.createComment(issueId, body, companyId);
    },
    async wakeAssignee(issueId, reason) {
      await ctx.issues.requestWakeup(issueId, companyId, { reason });
    },
    async setStatus(issueId, status) {
      await ctx.issues.update(issueId, { status }, companyId);
    },
  };
}

/** Adapt the host `ctx.state` onto the {@link StatePort}. */
function makeStatePort(ctx: PluginContext, cfg: DrafterConfig): StatePort {
  return {
    async getRequest(issueId) {
      const v = await ctx.state.get({ scopeKind: "issue", scopeId: issueId, stateKey: "request" });
      return (v as RequestState | null) ?? null;
    },
    async setRequest(issueId, state) {
      await ctx.state.set({ scopeKind: "issue", scopeId: issueId, stateKey: "request" }, state);
    },
    async getDraftedVersion(productKey) {
      const v = await ctx.state.get({
        scopeKind: "company",
        scopeId: cfg.companyId,
        namespace: "drafted-version",
        stateKey: productKey,
      });
      return (v as string | null) ?? null;
    },
    async setDraftedVersion(productKey, marker) {
      await ctx.state.set(
        { scopeKind: "company", scopeId: cfg.companyId, namespace: "drafted-version", stateKey: productKey },
        marker,
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

    // Phase 2b — sweep: backstop the event + handle reply timeouts.
    ctx.jobs.register("content-draft-sweep", async () => {
      const wired = wire(ctx, readConfig(await ctx.config.get()));
      if (!wired) return;
      const summary = await runSweep({ ...wired.receive, now: new Date() });
      ctx.logger.info("content-draft-sweep complete", summary as unknown as Record<string, unknown>);
    });

    // Phase 2 — receive: fast path on the drafting agent's reply. Company-wide
    // (comment events carry no reliable projectId); routed in-handler by state.
    ctx.events.on("issue.comment.created", async (event) => {
      try {
        const issueId = resolveIssueId(event);
        if (!issueId) return;
        const wired = wire(ctx, readConfig(await ctx.config.get()));
        if (!wired) return;
        const outcome = await processReply({ ...wired.receive, now: new Date() }, issueId);
        if (outcome.status !== "ignored" && outcome.status !== "waiting") {
          ctx.logger.info("content-drafter reply handled", { issueId, ...outcome });
        }
      } catch (err) {
        ctx.logger.error("content-drafter reply handler failed", {
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
