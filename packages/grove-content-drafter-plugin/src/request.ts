/**
 * Request phase (GOL-2424 Option A). For each product whose content draft was
 * requested, open ONE Paperclip issue assigned to the drafting agent (Sora)
 * carrying the drafting brief + a strict JSON reply contract. The agent runs the
 * LLM on the Claude subscription and replies with a fenced JSON block; the
 * receive phase parses that and does all Odoo writes.
 *
 * Idempotency, two layers:
 *   - product-scoped origin id → never a second OPEN request for one product;
 *   - drafted-version marker → never redo a product+version already drafted.
 * A product edited after drafting gets a new write_date → new marker → re-drafted.
 */
import type { OdooClient } from "./odoo-client.js";
import { buildSystemPrompt, buildUserPrompt } from "./drafter.js";
import { toProductView, READ_FIELDS, factToString } from "./apply.js";
import {
  markerComment,
  productOriginId,
  versionMarker,
  type DrafterConfig,
  type IssuePort,
  type StatePort,
} from "./ports.js";

export interface RequestDeps {
  odoo: OdooClient;
  issues: IssuePort;
  state: StatePort;
  cfg: DrafterConfig;
  now: Date;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

export interface RequestSummary {
  scanned: number;
  requested: number;
  skippedOpen: number;
  skippedDrafted: number;
  error?: string;
}

/** Build the issue body the drafting agent works from. */
export function buildRequestBody(
  system: string,
  user: string,
  marker: string,
): string {
  return [
    markerComment(marker),
    "## Draft listing content",
    "",
    "You are drafting storefront content for one nursery product. Follow the brief below exactly.",
    "**Reply with a single comment containing ONE fenced ```json block** and nothing else that could be",
    "mistaken for the payload. The plugin parses that block, validates it, and writes it to Odoo — you do",
    "not touch Odoo yourself. If you cannot produce a valid draft, say so in plain text and the plugin will",
    "leave the product untouched.",
    "",
    "### System brief",
    "```",
    system,
    "```",
    "",
    "### Product brief",
    "```",
    user,
    "```",
  ].join("\n");
}

export async function runRequestBatch(deps: RequestDeps): Promise<RequestSummary> {
  const { odoo, issues, state, cfg, now, logger } = deps;
  const summary: RequestSummary = { scanned: 0, requested: 0, skippedOpen: 0, skippedDrafted: 0 };

  const search = await odoo.searchRequested(Math.max(1, cfg.maxDraftsPerRun));
  if (!search.ok) return { ...summary, error: `search failed: ${search.error}` };
  const ids = search.data;
  summary.scanned = ids.length;

  for (const id of ids) {
    const read = await odoo.read(id, READ_FIELDS);
    if (!read.ok) {
      logger?.info("content-drafter: read failed; skipping", { productId: id, error: read.error });
      continue;
    }
    const marker = versionMarker(id, factToString(read.data.write_date));
    const productKey = productOriginId(id);

    // One open request per product.
    if (await issues.openRequestExistsForProduct(productKey)) {
      summary.skippedOpen++;
      continue;
    }
    // Never redo a product+version already drafted.
    if ((await state.getDraftedVersion(productKey)) === marker) {
      summary.skippedDrafted++;
      continue;
    }

    const product = toProductView(id, read.data);
    const body = buildRequestBody(buildSystemPrompt(cfg.houseRules), buildUserPrompt(product), marker);
    const created = await issues.createRequestIssue({
      title: `Draft listing content: ${product.name || `product ${id}`}`,
      description: body,
      originId: productKey,
    });
    await state.setRequest(created.id, {
      productId: id,
      marker,
      status: "open",
      attempts: 0,
      rePinged: false,
      createdAt: now.toISOString(),
    });
    summary.requested++;
    logger?.info("content-drafter: opened draft request", { productId: id, issueId: created.id, marker });
  }

  return summary;
}
