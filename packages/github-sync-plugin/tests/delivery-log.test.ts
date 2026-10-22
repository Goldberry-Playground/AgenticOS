import { describe, it, expect } from "vitest";
import {
  recordDelivery,
  recentDeliveries,
  failedDeliveryCount,
  deliveryCountSince,
  isFailedOutcome,
  isDeliveryProcessed,
  DuplicateDelivery,
  WebhookRejection,
  type DeliveryRow,
} from "../src/delivery-log.js";
import type { MappingDb } from "../src/mapping.js";

/**
 * In-memory fake of the `github_sync_delivery` table. Backs the three statements
 * the store issues: the INSERT (recordDelivery), the newest-first LIMIT SELECT
 * (recentDeliveries), and the `count(*) … WHERE outcome <> 'processed'` counter
 * (failedDeliveryCount, with and without the `occurred_at >=` cutoff). Column
 * shape mirrors migrations/006_delivery_log.sql.
 */
function makeDeliveryDb(): MappingDb & { rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  return {
    namespace: "plugin_github_sync_test",
    rows,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/count\(\*\)/i.test(sql)) {
        // failedDeliveryCount adds `outcome NOT IN ('processed', 'duplicate')`;
        // deliveryCountSince counts every outcome. Only apply the failed filter
        // when the SQL asks for it.
        const onlyFailed = /outcome NOT IN/i.test(sql);
        const pool = onlyFailed
          ? rows.filter((r) => r.outcome !== "processed" && r.outcome !== "duplicate")
          : rows;
        const since = /occurred_at >=/i.test(sql) ? String(params?.[0]) : null;
        const n = since ? pool.filter((r) => String(r.occurred_at) >= since).length : pool.length;
        return [{ n }] as T[];
      }
      if (/WHERE delivery_guid = \$1 AND outcome = 'processed'/i.test(sql)) {
        const hit = rows.some((r) => r.delivery_guid === params?.[0] && r.outcome === "processed");
        return (hit ? [{ one: 1 }] : []) as T[];
      }
      if (/ORDER BY occurred_at DESC/i.test(sql)) {
        const limit = Number(params?.[0] ?? 50);
        return [...rows]
          .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
          .slice(0, limit) as T[];
      }
      return [];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (/INSERT INTO/i.test(sql)) {
        const [request_id, endpoint_key, event, delivery_guid, outcome, detail, occurred_at] = params ?? [];
        rows.push({ request_id, endpoint_key, event, delivery_guid, outcome, detail, occurred_at });
      }
      return { rowCount: 1 };
    },
  };
}

function row(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    requestId: "req-1",
    endpointKey: "github-app",
    event: "issues",
    deliveryGuid: "guid-1",
    outcome: "processed",
    detail: null,
    occurredAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("recordDelivery / recentDeliveries", () => {
  it("persists a delivery outcome and reads it back, newest first", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ requestId: "a", occurredAt: "2026-08-13T00:00:00.000Z" }));
    await recordDelivery(
      db,
      row({ requestId: "b", occurredAt: "2026-08-13T00:01:00.000Z", outcome: "rejected_signature", detail: "bad sig" }),
    );

    const recent = await recentDeliveries(db);
    expect(recent.map((r) => r.requestId)).toEqual(["b", "a"]);
    expect(recent[0]?.outcome).toBe("rejected_signature");
    expect(recent[0]?.detail).toBe("bad sig");
    expect(recent[0]?.event).toBe("issues");
    expect(recent[0]?.deliveryGuid).toBe("guid-1");
  });

  it("truncates an oversized detail so a giant payload can't bloat the row", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ outcome: "failed_processing", detail: "x".repeat(2000) }));
    const [only] = await recentDeliveries(db);
    expect(only?.detail?.length).toBe(1001); // 1000 chars + the ellipsis
    expect(only?.detail?.endsWith("…")).toBe(true);
  });

  it("stores null for a missing event/guid/detail", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ event: null, deliveryGuid: null, detail: null }));
    const [only] = await recentDeliveries(db);
    expect(only?.event).toBeNull();
    expect(only?.deliveryGuid).toBeNull();
    expect(only?.detail).toBeNull();
  });
});

describe("failedDeliveryCount", () => {
  it("counts every non-processed outcome and ignores clean successes", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ requestId: "1", outcome: "processed" }));
    await recordDelivery(db, row({ requestId: "2", outcome: "rejected_signature" }));
    await recordDelivery(db, row({ requestId: "3", outcome: "failed_processing" }));
    await recordDelivery(db, row({ requestId: "4", outcome: "invalid_payload" }));
    await recordDelivery(db, row({ requestId: "5", outcome: "rejected_config" }));

    expect(await failedDeliveryCount(db)).toBe(4);
  });

  it("respects the since cutoff", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ requestId: "old", outcome: "failed_processing", occurredAt: "2026-08-13T00:00:00.000Z" }));
    await recordDelivery(db, row({ requestId: "new", outcome: "failed_processing", occurredAt: "2026-08-13T02:00:00.000Z" }));

    expect(await failedDeliveryCount(db, "2026-08-13T01:00:00.000Z")).toBe(1);
  });

  it("returns 0 on an empty table", async () => {
    expect(await failedDeliveryCount(makeDeliveryDb())).toBe(0);
  });
});

describe("deliveryCountSince", () => {
  it("counts EVERY outcome (incl. processed + rejected) in the window — the dead-man liveness signal", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ requestId: "1", outcome: "processed", occurredAt: "2026-09-21T02:00:00.000Z" }));
    await recordDelivery(db, row({ requestId: "2", outcome: "rejected_signature", occurredAt: "2026-09-21T02:30:00.000Z" }));
    // A pre-window row must not count toward liveness.
    await recordDelivery(db, row({ requestId: "old", outcome: "processed", occurredAt: "2026-09-20T00:00:00.000Z" }));

    expect(await deliveryCountSince(db, "2026-09-21T00:00:00.000Z")).toBe(2);
  });

  it("returns 0 when no delivery landed in the window (the dead-man precondition)", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ requestId: "old", outcome: "processed", occurredAt: "2026-09-20T00:00:00.000Z" }));
    expect(await deliveryCountSince(db, "2026-09-21T00:00:00.000Z")).toBe(0);
    expect(await deliveryCountSince(makeDeliveryDb(), "2026-09-21T00:00:00.000Z")).toBe(0);
  });
});

describe("isFailedOutcome", () => {
  it("is true for every outcome except processed", () => {
    expect(isFailedOutcome("processed")).toBe(false);
    expect(isFailedOutcome("rejected_signature")).toBe(true);
    expect(isFailedOutcome("rejected_config")).toBe(true);
    expect(isFailedOutcome("invalid_payload")).toBe(true);
    expect(isFailedOutcome("failed_processing")).toBe(true);
  });
});

describe("WebhookRejection", () => {
  it("carries its outcome and defaults to a 401 status hint (unsigned → 401)", () => {
    const err = new WebhookRejection("rejected_signature", "signature verification failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WebhookRejection");
    expect(err.outcome).toBe("rejected_signature");
    expect(err.httpStatus).toBe(401);
    expect(err.message).toBe("signature verification failed");
  });

  it("allows an explicit status hint", () => {
    const err = new WebhookRejection("invalid_payload", "bad body", 400);
    expect(err.httpStatus).toBe(400);
  });
});

describe("replay guard (GOL-3588)", () => {
  it("reports a GUID as processed only when it has a `processed` row", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ deliveryGuid: "guid-ok", outcome: "processed" }));
    await recordDelivery(db, row({ deliveryGuid: "guid-failed", outcome: "failed_processing" }));
    await recordDelivery(db, row({ deliveryGuid: "guid-bad-sig", outcome: "rejected_signature" }));
    expect(await isDeliveryProcessed(db, "guid-ok")).toBe(true);
    // A failed or rejected delivery must stay retryable: GitHub's manual
    // "Redeliver" reuses the original GUID.
    expect(await isDeliveryProcessed(db, "guid-failed")).toBe(false);
    expect(await isDeliveryProcessed(db, "guid-bad-sig")).toBe(false);
    expect(await isDeliveryProcessed(db, "guid-never-seen")).toBe(false);
  });

  it("does not count a dropped duplicate as a failed delivery", async () => {
    const db = makeDeliveryDb();
    await recordDelivery(db, row({ outcome: "processed" }));
    await recordDelivery(db, row({ outcome: "duplicate" }));
    expect(await failedDeliveryCount(db)).toBe(0);
    expect(isFailedOutcome("duplicate")).toBe(false);
    // ...but it still proves the ingress is alive for the dead-man.
    expect(await deliveryCountSince(db, "2026-08-01T00:00:00.000Z")).toBe(2);
  });

  it("DuplicateDelivery carries the GUID", () => {
    const err = new DuplicateDelivery("guid-x");
    expect(err.deliveryGuid).toBe("guid-x");
    expect(err).toBeInstanceOf(Error);
  });
});
