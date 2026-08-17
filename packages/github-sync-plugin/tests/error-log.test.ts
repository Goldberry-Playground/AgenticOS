import { describe, it, expect } from "vitest";
import {
  recordError,
  recentErrors,
  buildSwallowedFailurePing,
  buildFallbackFailurePing,
  OpsPingThrottle,
  withSuppressionNote,
  type ErrorRow,
} from "../src/error-log.js";
import type { MappingDb } from "../src/mapping.js";

/**
 * In-memory fake of the `github_sync_error` table. Backs the two statements the
 * store issues: the INSERT (recordError) and the `ORDER BY occurred_at DESC LIMIT`
 * SELECT (recentErrors). Column shape mirrors migrations/003_error_log.sql — note
 * `context` is stored as a JSON TEXT string, exactly as the store serializes it.
 */
function makeErrorDb(): MappingDb & { rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  return {
    namespace: "plugin_github_sync_test",
    rows,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
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
        const [occurredAt, scope, detail, context] = params ?? [];
        rows.push({ occurred_at: occurredAt, scope, detail, context });
      }
      return { rowCount: 1 };
    },
  };
}

describe("recordError / recentErrors", () => {
  it("persists a swallowed failure and reads it back, newest first", async () => {
    const db = makeErrorDb();
    await recordError(db, {
      occurredAt: "2026-07-11T00:00:00.000Z",
      scope: "issue.created handler failed",
      detail: "boom",
      context: { issueId: "abc" },
    });
    await recordError(db, {
      occurredAt: "2026-07-11T00:01:00.000Z",
      scope: "inbound webhook: handler failed (github-app)",
      detail: "kapow",
      context: { endpointKey: "github-app" },
    });

    const recent = await recentErrors(db);
    expect(recent).toHaveLength(2);
    // Newest first.
    expect(recent[0].scope).toBe("inbound webhook: handler failed (github-app)");
    expect(recent[0].detail).toBe("kapow");
    expect(recent[0].context).toEqual({ endpointKey: "github-app" });
    expect(recent[1].detail).toBe("boom");
  });

  it("serializes context to JSON TEXT and stores NULL for empty context", async () => {
    const db = makeErrorDb();
    await recordError(db, { occurredAt: "2026-07-11T00:00:00.000Z", scope: "s", detail: "d" });
    expect(db.rows[0].context).toBeNull();

    await recordError(db, {
      occurredAt: "2026-07-11T00:00:01.000Z",
      scope: "s",
      detail: "d",
      context: {},
    });
    // An empty context object is treated as no context (NULL), not "{}".
    expect(db.rows[1].context).toBeNull();

    await recordError(db, {
      occurredAt: "2026-07-11T00:00:02.000Z",
      scope: "s",
      detail: "d",
      context: { k: "v" },
    });
    expect(db.rows[2].context).toBe(JSON.stringify({ k: "v" }));
  });

  it("respects the limit argument", async () => {
    const db = makeErrorDb();
    for (let i = 0; i < 5; i++) {
      await recordError(db, {
        occurredAt: `2026-07-11T00:00:0${i}.000Z`,
        scope: "s",
        detail: `d${i}`,
      });
    }
    const recent = await recentErrors(db, 2);
    expect(recent.map((r: ErrorRow) => r.detail)).toEqual(["d4", "d3"]);
  });

  it("tolerates a corrupt (non-JSON) context on read", async () => {
    const db = makeErrorDb();
    db.rows.push({ occurred_at: "2026-07-11T00:00:00.000Z", scope: "s", detail: "d", context: "not json" });
    const recent = await recentErrors(db);
    expect(recent[0].context).toBeUndefined();
  });
});

describe("buildSwallowedFailurePing", () => {
  it("prefixes with the 🚨 alert marker and includes scope + detail", () => {
    const msg = buildSwallowedFailurePing("inbound webhook: handler failed (github-app)", "boom");
    expect(msg).toBe("🚨 github-sync failure — inbound webhook: handler failed (github-app): boom");
  });

  it("truncates a very long detail so it can't blow Discord's content limit", () => {
    const long = "x".repeat(1000);
    const msg = buildSwallowedFailurePing("scope", long);
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(600);
  });
});

describe("buildFallbackFailurePing (GOL-1485)", () => {
  it("prefixes with the ⛔ marker and carries site + HTTP status", () => {
    const msg = buildFallbackFailurePing("mirror.create", 403);
    expect(msg).toContain("⛔");
    expect(msg).toContain("mirror.create");
    expect(msg).toContain("HTTP 403");
    expect(msg).toContain("#457");
  });

  it("reports 'no HTTP status' when the retry threw a non-HTTP error", () => {
    const msg = buildFallbackFailurePing("ci.comment", undefined);
    expect(msg).toContain("ci.comment");
    expect(msg).toContain("no HTTP status");
  });

  it("is deterministic per (site, status) so the ops-alert throttle collapses a burst", () => {
    // Byte-for-byte identical content is what OpsPingThrottle keys on, so two failures
    // for the same site+status must produce the same string (one ping per window).
    expect(buildFallbackFailurePing("mirror.create", 403)).toBe(buildFallbackFailurePing("mirror.create", 403));
    expect(buildFallbackFailurePing("mirror.create", 403)).not.toBe(buildFallbackFailurePing("mirror.create", 500));
  });
});

describe("OpsPingThrottle (GOL-724 alert dedup)", () => {
  const WINDOW = 5 * 60_000;

  it("emits the first hit and suppresses identical hits inside the window", () => {
    const t = new OpsPingThrottle(WINDOW);
    expect(t.decide("k", 0)).toEqual({ emit: true, suppressed: 0 });
    // A burst of redeliveries of the SAME alert collapses to nothing.
    expect(t.decide("k", 1_000)).toEqual({ emit: false, suppressed: 1 });
    expect(t.decide("k", 2_000)).toEqual({ emit: false, suppressed: 2 });
    expect(t.decide("k", WINDOW - 1)).toEqual({ emit: false, suppressed: 3 });
  });

  it("re-emits once the window elapses and reports how many were suppressed", () => {
    const t = new OpsPingThrottle(WINDOW);
    t.decide("k", 0);
    t.decide("k", 1_000); // suppressed #1
    t.decide("k", 2_000); // suppressed #2
    // First hit at/after the window boundary re-opens and surfaces the swallowed count.
    expect(t.decide("k", WINDOW)).toEqual({ emit: true, suppressed: 2 });
    // New window: counter reset, next identical hit is suppressed from zero again.
    expect(t.decide("k", WINDOW + 500)).toEqual({ emit: false, suppressed: 1 });
  });

  it("throttles per key — a different alert still pages immediately", () => {
    const t = new OpsPingThrottle(WINDOW);
    expect(t.decide("hmac", 0).emit).toBe(true);
    expect(t.decide("hmac", 100).emit).toBe(false);
    // A distinct error is not muffled by an unrelated burst.
    expect(t.decide("broker-401", 100).emit).toBe(true);
  });

  it("prune drops keys with no hit for a full window so the map can't grow unbounded", () => {
    const t = new OpsPingThrottle(WINDOW);
    t.decide("k", 0);
    t.prune(WINDOW); // last hit was at 0, a full window ago → dropped
    // Dropped → treated as brand new (suppressed resets to 0), proving the entry is gone.
    expect(t.decide("k", WINDOW + 1)).toEqual({ emit: true, suppressed: 0 });
  });

  it("decide opportunistically prunes stale keys so the Map stays bounded (GOL-728)", () => {
    const t = new OpsPingThrottle(WINDOW);
    t.decide("stale", 0);
    t.decide("stale", 1_000); // suppressed #1 → window would carry suppressed=1 if retained
    // An unrelated alert a full window later drives decide → prune(now), which must
    // evict "stale" (lastAt=1_000, now-lastAt >= WINDOW). If prune had NOT run, the
    // stale window would survive and its next re-open would report suppressed:1.
    t.decide("other", WINDOW + 1_000);
    expect(t.decide("stale", WINDOW + 1_001)).toEqual({ emit: true, suppressed: 0 });
  });

  it("decide keeps the just-decided key even while pruning peers", () => {
    const t = new OpsPingThrottle(WINDOW);
    t.decide("k", 0);
    t.decide("k", 1_000); // suppressed #1 — this same call runs prune(1_000)
    // prune must not evict the key decide just refreshed; its suppressed count survives
    // so the next window re-open still reports the collapsed total.
    expect(t.decide("k", WINDOW + 1_000)).toEqual({ emit: true, suppressed: 1 });
  });
});

describe("withSuppressionNote", () => {
  it("returns the content unchanged when nothing was suppressed", () => {
    expect(withSuppressionNote("🔥 boom", 0)).toBe("🔥 boom");
  });

  it("appends a pluralized suppressed-count note", () => {
    expect(withSuppressionNote("🔥 boom", 1)).toBe("🔥 boom (+1 identical alert suppressed)");
    expect(withSuppressionNote("🔥 boom", 4)).toBe("🔥 boom (+4 identical alerts suppressed)");
  });
});
