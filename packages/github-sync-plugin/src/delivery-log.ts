/**
 * `github_sync_delivery` — one row per inbound webhook delivery, recording the
 * PROCESSING OUTCOME of every POST the receiver handles (W2 / GOL-1411).
 *
 * WHY: before this, the receiver returned HTTP 200 `{status:"success"}` for
 * literally every delivery — including unsigned garbage and deliveries whose
 * downstream write failed. GitHub's delivery log therefore showed green
 * checkmarks while inbound mirroring was dead, which is why the 2026-08-12
 * outage stayed invisible for ~20h. This table (plus the honest non-2xx the
 * worker now returns on failure) makes per-delivery processing status queryable
 * over DATABASE_URL, and `failedDeliveryCount` is the failed-processing counter
 * the ops alert is derived from — no server.log dig required.
 *
 * Created by `migrations/006_delivery_log.sql` (runtime DDL is forbidden by the
 * plugin-DB contract). Every statement is schema-qualified with the host-derived
 * namespace exposed as `ctx.db.namespace`, matching `error-log.ts`.
 */
import type { MappingDb } from "./mapping.js";

export const DELIVERY_TABLE = "github_sync_delivery";

/**
 * Terminal processing outcome for one webhook delivery. `processed` is the only
 * success value; everything else is a delivery the receiver rejected or failed
 * to complete, and the worker returns a non-2xx for each of them so GitHub's
 * delivery log turns red instead of the old silent green.
 */
export type DeliveryOutcome =
  /** Signature verified and the handler completed without throwing. */
  | "processed"
  /** HMAC signature missing or wrong — rejected BEFORE any enqueue/write. */
  | "rejected_signature"
  /** The verifying secret is not configured, so no delivery can be trusted. */
  | "rejected_config"
  /** Signature verified but the body wasn't a usable event payload. */
  | "invalid_payload"
  /** Signature verified but a downstream write/enqueue threw. */
  | "failed_processing";

/** A delivery outcome that is anything other than a clean `processed`. */
export function isFailedOutcome(outcome: DeliveryOutcome): boolean {
  return outcome !== "processed";
}

export interface DeliveryRow {
  /** Host-provided unique delivery id (`input.requestId`) — the idempotency key. */
  requestId: string;
  /** Manifest endpoint key the delivery hit (github-issue / github-app / github-pr). */
  endpointKey: string;
  /** `X-GitHub-Event` header, when present (issues / pull_request / check_suite …). */
  event: string | null;
  /** `X-GitHub-Delivery` GUID, when present — cross-references GitHub's own log. */
  deliveryGuid: string | null;
  /** Terminal processing outcome. */
  outcome: DeliveryOutcome;
  /** Short human detail (rejection reason / error message), truncated on write. */
  detail: string | null;
  /** ISO-8601 timestamp the outcome was recorded. */
  occurredAt: string;
}

/** Fully-qualified `<namespace>.github_sync_delivery` for runtime SQL. */
function qualifiedTable(db: MappingDb): string {
  return `${db.namespace}.${DELIVERY_TABLE}`;
}

/** Detail is bounded so a giant payload/stack never bloats the row. */
function trimDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return detail.length > 1000 ? `${detail.slice(0, 1000)}…` : detail;
}

/**
 * Persist one delivery outcome. Callers wrap this best-effort: recording a
 * delivery must never mask the outcome (or the failure) it is recording, so a
 * DB hiccup here is swallowed by the caller rather than turned into a 500 of
 * its own.
 */
export async function recordDelivery(db: MappingDb, row: DeliveryRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${qualifiedTable(db)}
       (request_id, endpoint_key, event, delivery_guid, outcome, detail, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.requestId,
      row.endpointKey,
      row.event,
      row.deliveryGuid,
      row.outcome,
      trimDetail(row.detail),
      row.occurredAt,
    ],
  );
}

/**
 * The failed-processing counter: how many deliveries did NOT cleanly process
 * (optionally since an ISO cutoff). Backs the health/ops read side; the Discord
 * alert fires per-failure at record time, this is the running total for triage.
 */
export async function failedDeliveryCount(db: MappingDb, sinceIso?: string): Promise<number> {
  const rows = sinceIso
    ? await db.query<{ n: number | string }>(
        `SELECT count(*) AS n FROM ${qualifiedTable(db)}
           WHERE outcome <> 'processed' AND occurred_at >= $1`,
        [sinceIso],
      )
    : await db.query<{ n: number | string }>(
        `SELECT count(*) AS n FROM ${qualifiedTable(db)} WHERE outcome <> 'processed'`,
      );
  const first = rows[0];
  return first ? Number(first.n) : 0;
}

/** Most-recent deliveries first — the queryable per-delivery status view. */
export async function recentDeliveries(db: MappingDb, limit = 50): Promise<DeliveryRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT request_id, endpoint_key, event, delivery_guid, outcome, detail, occurred_at
       FROM ${qualifiedTable(db)} ORDER BY occurred_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    requestId: String(r.request_id),
    endpointKey: String(r.endpoint_key),
    event: r.event != null ? String(r.event) : null,
    deliveryGuid: r.delivery_guid != null ? String(r.delivery_guid) : null,
    outcome: String(r.outcome) as DeliveryOutcome,
    detail: r.detail != null ? String(r.detail) : null,
    occurredAt: String(r.occurred_at),
  }));
}

/**
 * A verification/parse/config failure detected BEFORE (or in place of) a
 * successful enqueue. Thrown by the inbound handlers so the receiver returns a
 * non-2xx instead of the old silent 200. `onWebhook` catches it, records the
 * matching {@link DeliveryOutcome}, and re-throws so the host fails the delivery
 * — but deliberately does NOT fire a Discord alert, since an unauthenticated
 * probe is not an outage and would only be alert-noise.
 *
 * `httpStatus` is the status the plugin WANTS the host to return (401 for a bad
 * signature). The worker→host bridge currently only propagates a JSON-RPC error
 * code, so today every thrown handler surfaces as a single non-2xx; mapping this
 * hint to the exact HTTP status is the host receive-path's job (epic W1). The
 * value is carried here so that mapping is a host-only change.
 */
export class WebhookRejection extends Error {
  constructor(
    readonly outcome: Exclude<DeliveryOutcome, "processed" | "failed_processing">,
    message: string,
    readonly httpStatus = 401,
  ) {
    super(message);
    this.name = "WebhookRejection";
  }
}
