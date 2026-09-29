/**
 * Narrow ports the request/receive/sweep phases depend on, plus the shared
 * config + idempotency-marker helpers. Keeping the Paperclip and state surfaces
 * behind small interfaces lets the phases be unit-tested with plain fakes (no
 * SDK), the same way {@link OdooClient} is faked in the job tests. worker.ts
 * adapts the real `ctx.issues` / `ctx.state` onto these ports.
 */

/** Resolved plugin config (agent-backed drafting; no Anthropic key). */
export interface DrafterConfig {
  odooBaseUrl: string;
  odooDb: string;
  odooUsername: string;
  odooPassword: string;
  houseRules: string;
  /** Company that owns the request issues + products. */
  companyId: string;
  /** Grove project the request issues are filed under (optional). */
  groveProjectId: string;
  /** Agent the drafting request issues are assigned to (CMO - Sora). */
  drafterAgentId: string;
  /** Max products turned into request issues per request-batch run. */
  maxDraftsPerRun: number;
  /** Hours with no usable reply before the sweep re-pings, then gives up. */
  replyTimeoutHours: number;
  /** When true (default) the receive phase drafts + logs but never writes Odoo. */
  dryRun: boolean;
}

/** Per-request state, keyed by the request issue id. */
export interface RequestState {
  productId: number;
  /** product.template#<id>@<write_date> at request time. */
  marker: string;
  status: "open" | "drafted" | "failed";
  /** Invalid-reply retries already spent. */
  attempts: number;
  /** Whether the timeout re-ping has already been sent. */
  rePinged: boolean;
  createdAt: string;
  /** createdAt of the newest drafter reply we have already acted on. */
  lastReplyAt?: string;
}

/** A Paperclip issue as far as this plugin cares. */
export interface IssueLike {
  id: string;
  title: string;
  description: string | null;
  status: string;
  originKind: string | null;
  createdAt: string;
}

/** Paperclip issue operations, company-bound and attributed by the adapter. */
export interface IssuePort {
  /** Any non-terminal request issue already open for this product? */
  openRequestExistsForProduct(originId: string): Promise<boolean>;
  createRequestIssue(input: { title: string; description: string; originId: string }): Promise<{ id: string }>;
  get(issueId: string): Promise<IssueLike | null>;
  /** All request issues this plugin owns (any status), newest first, capped. */
  listOwnRequests(limit: number): Promise<IssueLike[]>;
  listComments(issueId: string): Promise<{ authorAgentId: string | null; body: string; createdAt: string }[]>;
  postComment(issueId: string, body: string): Promise<void>;
  /** Wake the request issue's assignee (plugin comments alone never wake anyone). */
  wakeAssignee(issueId: string, reason: string): Promise<void>;
  setStatus(issueId: string, status: "done" | "blocked"): Promise<void>;
}

/** Idempotency + retry state. */
export interface StatePort {
  getRequest(issueId: string): Promise<RequestState | null>;
  setRequest(issueId: string, state: RequestState): Promise<void>;
  /** Last version marker successfully drafted for a product ("" if none). */
  getDraftedVersion(productKey: string): Promise<string | null>;
  setDraftedVersion(productKey: string, marker: string): Promise<void>;
}

/** Product-scoped origin id: one request issue open per product at a time. */
export function productOriginId(productId: number): string {
  return `pt#${productId}`;
}

/** Version marker embedded in the request + used to avoid redoing a version. */
export function versionMarker(productId: number, writeDate: string): string {
  return `product.template#${productId}@${writeDate || "unknown"}`;
}

/** The `<!-- ... -->` marker line dropped in the request body for humans. */
export function markerComment(marker: string): string {
  return `<!-- content-draft: ${marker} -->`;
}
