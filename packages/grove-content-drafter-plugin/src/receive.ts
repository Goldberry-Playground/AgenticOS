/**
 * Receive phase (GOL-2424 Option A). Given a request issue, look for a NEW
 * reply from the drafting agent, validate its fenced JSON, and — unless dryRun —
 * write the draft back to Odoo, then close the request issue. Invalid replies get
 * the exact validation error commented back (that wakes the agent) up to a retry
 * cap; then the request is marked blocked. Never writes partial content.
 *
 * Shared by the fast path (issue.comment.created event) and the backstop
 * (sweep). Both call {@link processReply}, which is idempotent: state.status and
 * lastReplyAt gate it so a redelivered event or an overlapping sweep is a no-op.
 */
import type { OdooClient } from "./odoo-client.js";
import { parseDraftResponse } from "./drafter.js";
import { applyDraftToOdoo, toProductView, READ_FIELDS } from "./apply.js";
import {
  productOriginId,
  type DrafterConfig,
  type IssuePort,
  type StatePort,
} from "./ports.js";

/** Max invalid replies we respond to before giving up and blocking the request. */
export const MAX_INVALID_REPLIES = 2;

export interface ReceiveDeps {
  odoo: OdooClient;
  issues: IssuePort;
  state: StatePort;
  cfg: DrafterConfig;
  now: Date;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

export type ReplyOutcome =
  | { status: "ignored"; reason: string }
  | { status: "waiting" }
  | { status: "invalid"; attempts: number; gaveUp: boolean }
  | { status: "drafted"; dryRun: boolean; productId: number; filledFactCount: number }
  | { status: "error"; error: string };

/** Pull the JSON payload out of an agent comment: last ```json block, else raw. */
export function extractDraftJson(body: string): string {
  const fences = [...body.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (fences.length > 0) return fences[fences.length - 1]![1]!.trim();
  return body;
}

export async function processReply(deps: ReceiveDeps, issueId: string): Promise<ReplyOutcome> {
  const { odoo, issues, state, cfg, now, logger } = deps;

  const req = await state.getRequest(issueId);
  if (!req) return { status: "ignored", reason: "not a drafter request" };
  if (req.status !== "open") return { status: "ignored", reason: `already ${req.status}` };

  // Newest reply from the drafting agent we have not acted on yet. Comments the
  // plugin itself posted (validation errors, re-pings) carry a different author,
  // so they never re-trigger us.
  const comments = await issues.listComments(issueId);
  const since = req.lastReplyAt ?? "";
  const replies = comments
    .filter((c) => c.authorAgentId === cfg.drafterAgentId && c.createdAt > since)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const reply = replies[0];
  if (!reply) return { status: "waiting" };

  // Mark this reply handled up front so a duplicate event / overlapping sweep
  // doesn't double-process or double-post an error.
  req.lastReplyAt = reply.createdAt;

  // Read the product fresh: current empty-fillable set for validation, current
  // provenance for the merge, and confirm it still exists.
  const read = await odoo.read(req.productId, READ_FIELDS);
  if (!read.ok) {
    await state.setRequest(issueId, req); // persist lastReplyAt so we don't loop on the same reply
    return { status: "error", error: `read failed: ${read.error}` };
  }
  const product = toProductView(req.productId, read.data);

  const parsed = parseDraftResponse(extractDraftJson(reply.body), product.emptyFillable);
  if (!parsed.ok) {
    req.attempts++;
    const gaveUp = req.attempts >= MAX_INVALID_REPLIES;
    await issues.postComment(
      issueId,
      gaveUp
        ? `The draft reply was still not usable (${parsed.error}). That was ${req.attempts} attempts; ` +
            `marking this request blocked. Re-open it if you want to try again.`
        : `The draft reply could not be applied: ${parsed.error}. ` +
            `Please re-reply with a single fenced \`\`\`json block matching the contract in the description.`,
    );
    if (gaveUp) {
      req.status = "failed";
      await issues.setStatus(issueId, "blocked");
    } else {
      await issues.wakeAssignee(issueId, "content-drafter: reply needs correction");
    }
    await state.setRequest(issueId, req);
    return { status: "invalid", attempts: req.attempts, gaveUp };
  }

  if (cfg.dryRun) {
    // Preview only: log, close the request, but never touch Odoo or record the
    // drafted-version (so flipping dryRun off re-requests and writes for real).
    logger?.info("content-drafter dry-run (no write)", {
      productId: req.productId,
      name: product.name,
      filledFacts: parsed.data.filledFacts.map((f) => f.field),
      sources: parsed.data.sources.map((s) => s.url),
    });
    req.status = "drafted";
    await state.setRequest(issueId, req);
    await issues.postComment(
      issueId,
      "Dry run: the draft validated and would have been written. No Odoo write performed (dryRun=true).",
    );
    await issues.setStatus(issueId, "done");
    return { status: "drafted", dryRun: true, productId: req.productId, filledFactCount: parsed.data.filledFacts.length };
  }

  const applied = await applyDraftToOdoo(odoo, req.productId, read.data.grove_facts_provenance, parsed.data, now);
  if (!applied.ok) {
    await issues.postComment(issueId, `Draft validated but the Odoo write failed: ${applied.error}. Will retry.`);
    await state.setRequest(issueId, req); // keep open; sweep/next event retries
    return { status: "error", error: applied.error };
  }

  req.status = "drafted";
  await state.setDraftedVersion(productOriginId(req.productId), req.marker);
  await state.setRequest(issueId, req);
  await issues.postComment(
    issueId,
    `Draft written to Odoo (product ${req.productId}, ${applied.data.filledFactCount} cited fact(s)). ` +
      `draft_state='drafted', facts left for human review. Closing this request.`,
  );
  await issues.setStatus(issueId, "done");
  logger?.info("content-drafter drafted", { productId: req.productId, filledFacts: applied.data.filledFactCount });
  return { status: "drafted", dryRun: false, productId: req.productId, filledFactCount: applied.data.filledFactCount };
}
