/**
 * `github_sync_heartbeat` — a single-row worker liveness signal (GOL-2371,
 * D3 of GOL-2344; follow-up to GOL-2279).
 *
 * WHY: on 2026-09-09 a boot-time `execSync` crash in the plugin-worker supervisor
 * left the github-sync worker dead for ~5 days — every inbound GitHub webhook
 * 502'd — with NO auto-respawn and NO alert, because nothing external could tell
 * a dead worker from a quiet one. `github_sync_delivery` only advances when a
 * webhook actually arrives, so a silent inbound window and a dead worker look
 * identical from the outside.
 *
 * This table is the unconditional liveness heartbeat the delivery log is not: a
 * live worker refreshes `updated_at` every few minutes from the `worker-heartbeat`
 * scheduled job (and once at boot). A dead worker stops refreshing it, so the row
 * goes stale — a signal an external watchdog (a monitor polling over DATABASE_URL,
 * or the host supervisor) can read to auto-respawn or page within MINUTES instead
 * of days. The plugin OWNS emitting the signal; detection/respawn at the host
 * boundary is DevOps (Terra) — see GOL-2287 Part B (host supervisor) / Part A
 * (external probe). Reading a DB row needs no HMAC signing secret, so it also
 * sidesteps GOL-2287 Part A's blocker.
 *
 * Created by `migrations/007_heartbeat.sql` (runtime DDL is forbidden by the
 * plugin-DB contract). Every statement is schema-qualified with the host-derived
 * namespace exposed as `ctx.db.namespace`, matching `delivery-log.ts` / `mapping.ts`.
 */
import type { MappingDb } from "./mapping.js";

export const HEARTBEAT_TABLE = "github_sync_heartbeat";

/** The table holds at most one row; its primary key is pinned to this value. */
export const HEARTBEAT_ROW_ID = 1;

/**
 * Default staleness threshold the read side (onHealth / an external monitor)
 * uses to flag a dead worker. With the `worker-heartbeat` job on a 5-minute
 * schedule this is three missed ticks — long enough to ride out a single slow
 * tick or a brief scheduler hiccup, short enough that detection is minutes, not
 * the ~5 days of GOL-2279. Callers may override.
 */
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000; // 15 min

export interface HeartbeatRow {
  /** ISO-8601 timestamp of the most recent heartbeat write (the liveness clock). */
  updatedAt: string;
  /** ISO-8601 timestamp this worker PROCESS booted — changes only on a respawn. */
  workerBootedAt: string;
  /** Plugin version this worker is running, for at-a-glance drift checks. */
  workerVersion: string;
}

/** Fully-qualified `<namespace>.github_sync_heartbeat` for runtime SQL. */
function qualifiedTable(db: MappingDb): string {
  return `${db.namespace}.${HEARTBEAT_TABLE}`;
}

/**
 * Stamp the single heartbeat row (INSERT-or-UPDATE). Idempotent by the pinned
 * primary key, so the table never grows beyond one row. Best-effort at the call
 * site: a failed heartbeat write must never take the worker down — that would be
 * the very outage this signal exists to detect.
 */
export async function recordHeartbeat(
  db: MappingDb,
  row: { updatedAt: string; workerBootedAt: string; workerVersion: string },
): Promise<void> {
  await db.execute(
    `INSERT INTO ${qualifiedTable(db)} (id, updated_at, worker_booted_at, worker_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET updated_at = EXCLUDED.updated_at,
             worker_booted_at = EXCLUDED.worker_booted_at,
             worker_version = EXCLUDED.worker_version`,
    [HEARTBEAT_ROW_ID, row.updatedAt, row.workerBootedAt, row.workerVersion],
  );
}

/** The current heartbeat, or null if the worker has never stamped one. */
export async function getHeartbeat(db: MappingDb): Promise<HeartbeatRow | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT updated_at, worker_booted_at, worker_version
       FROM ${qualifiedTable(db)} WHERE id = $1`,
    [HEARTBEAT_ROW_ID],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    updatedAt: String(r.updated_at),
    workerBootedAt: String(r.worker_booted_at),
    workerVersion: r.worker_version != null ? String(r.worker_version) : "",
  };
}

/** Age of a heartbeat in ms at `now` (negative clamped to 0), or null when absent. */
export function heartbeatAgeMs(row: HeartbeatRow | null, now: number): number | null {
  if (!row) return null;
  const t = Date.parse(row.updatedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, now - t);
}
