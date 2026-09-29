import { describe, it, expect } from "vitest";
import {
  recordHeartbeat,
  getHeartbeat,
  heartbeatAgeMs,
  HEARTBEAT_ROW_ID,
  type HeartbeatRow,
} from "../src/heartbeat.js";
import type { MappingDb } from "../src/mapping.js";

/**
 * In-memory fake of the single-row `github_sync_heartbeat` table. Mirrors
 * migrations/007_heartbeat.sql (snake_case) and enforces the pinned-PK upsert
 * so the table can never grow past one row.
 */
function makeHeartbeatDb(): MappingDb & { rows: Map<number, Record<string, unknown>> } {
  const rows = new Map<number, Record<string, unknown>>();
  return {
    namespace: "plugin_github_sync_test",
    rows,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/SELECT .* FROM .*github_sync_heartbeat WHERE id = \$1/is.test(sql)) {
        const r = rows.get(Number(params?.[0]));
        return r ? [r as T] : [];
      }
      return [];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (/INSERT INTO .*github_sync_heartbeat/is.test(sql)) {
        const [id, updatedAt, bootedAt, version] = params ?? [];
        // ON CONFLICT (id) DO UPDATE — the pinned key means this always overwrites.
        rows.set(Number(id), {
          id: Number(id),
          updated_at: String(updatedAt),
          worker_booted_at: String(bootedAt),
          worker_version: version == null ? null : String(version),
        });
      }
      return { rowCount: 1 };
    },
  };
}

const BOOTED_AT = "2026-09-21T08:00:00.000Z";

describe("heartbeat store", () => {
  it("returns null before any heartbeat is stamped", async () => {
    const db = makeHeartbeatDb();
    expect(await getHeartbeat(db)).toBeNull();
  });

  it("stamps and reads back the single heartbeat row", async () => {
    const db = makeHeartbeatDb();
    await recordHeartbeat(db, {
      updatedAt: "2026-09-21T08:05:00.000Z",
      workerBootedAt: BOOTED_AT,
      workerVersion: "0.16.5",
    });
    const hb = await getHeartbeat(db);
    expect(hb).toEqual<HeartbeatRow>({
      updatedAt: "2026-09-21T08:05:00.000Z",
      workerBootedAt: BOOTED_AT,
      workerVersion: "0.16.5",
    });
  });

  it("keeps exactly one row across repeated stamps (upsert on the pinned PK)", async () => {
    const db = makeHeartbeatDb();
    await recordHeartbeat(db, { updatedAt: "2026-09-21T08:05:00.000Z", workerBootedAt: BOOTED_AT, workerVersion: "0.16.5" });
    await recordHeartbeat(db, { updatedAt: "2026-09-21T08:10:00.000Z", workerBootedAt: BOOTED_AT, workerVersion: "0.16.5" });
    expect(db.rows.size).toBe(1);
    expect(db.rows.has(HEARTBEAT_ROW_ID)).toBe(true);
    expect((await getHeartbeat(db))?.updatedAt).toBe("2026-09-21T08:10:00.000Z");
  });
});

describe("heartbeatAgeMs", () => {
  const row: HeartbeatRow = {
    updatedAt: "2026-09-21T08:00:00.000Z",
    workerBootedAt: BOOTED_AT,
    workerVersion: "0.16.5",
  };
  const t0 = Date.parse("2026-09-21T08:00:00.000Z");

  it("is null for a missing row", () => {
    expect(heartbeatAgeMs(null, t0)).toBeNull();
  });

  it("measures age forward from the heartbeat timestamp", () => {
    expect(heartbeatAgeMs(row, t0 + 20 * 60 * 1000)).toBe(20 * 60 * 1000);
  });

  it("clamps a clock-skew negative age to zero", () => {
    expect(heartbeatAgeMs(row, t0 - 5000)).toBe(0);
  });

  it("is null when the stored timestamp is unparseable", () => {
    expect(heartbeatAgeMs({ ...row, updatedAt: "not-a-date" }, t0)).toBeNull();
  });
});
