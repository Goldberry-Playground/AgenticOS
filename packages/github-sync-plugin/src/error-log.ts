/**
 * `github_sync_error` — the plugin-owned, queryable sink for SWALLOWED worker
 * failures (GOL-296). A caught exception in `onWebhook` or an event dispatch used
 * to reach only host stderr (server.log); this table gives a durable, queryable
 * record (`recentErrors`) reachable over DATABASE_URL without a server.log dig.
 *
 * Created by `migrations/003_error_log.sql` (the plugin-DB contract forbids runtime
 * DDL). Every statement is SCHEMA-QUALIFIED with the host-derived namespace, which
 * the SDK exposes as `ctx.db.namespace`. Reuses the `MappingDb` surface so the same
 * `ctx.db` handle backs mappings, PR-review rows, and error records.
 */
import type { MappingDb } from "./mapping.js";

export const ERROR_TABLE = "github_sync_error";

export interface ErrorRow {
  /** ISO-8601 timestamp the failure was caught. */
  occurredAt: string;
  /** Short scope/label, e.g. "inbound webhook: handler failed (github-app)". */
  scope: string;
  /** The error message (or String(err) for non-Errors). */
  detail: string;
  /** Optional structured side-context (endpointKey, issueId, …). */
  context?: Record<string, unknown>;
}

/** Fully-qualified `<namespace>.github_sync_error` for runtime SQL. */
function qualifiedTable(db: MappingDb): string {
  return `${db.namespace}.${ERROR_TABLE}`;
}

/**
 * 🚨 alert for a swallowed worker failure (GOL-296), posted to the Discord ops
 * webhook. A distinct emoji/prefix so it stands out from routine ops pings; the
 * detail is truncated so a giant stack/message never blows Discord's 2000-char
 * `content` limit. Lives here (not worker.ts) so it's unit-testable without
 * importing the worker entrypoint, which calls runWorker() at module load.
 */
export function buildSwallowedFailurePing(scope: string, detail: string): string {
  const trimmed = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail;
  return `🚨 github-sync failure — ${scope}: ${trimmed}`;
}

/**
 * ⛔ alert for a REST-fallback FAILURE (GOL-1485): the GOL-323/GOL-352 scope-expiry
 * fallback FIRED, but the Paperclip REST retry itself failed — e.g. the GitHub Sync
 * Service key silently died (#457: NULL responsible_user_id → 403). Before this the only
 * signal was a `logger.error` on host stderr, which is NOT observable, so a dying fallback
 * key went unseen until inbound mirrors visibly stopped. Distinct ⛔ prefix; carries site +
 * HTTP status. Content is DETERMINISTIC per (site, status) so the ops-alert throttle
 * collapses a broad outage to ~one ping per site per window (the volatile error detail
 * stays in `logger.error` + the `github_sync_error` row, not in the throttle key).
 */
export function buildFallbackFailurePing(site: string, status: number | undefined): string {
  const code = status === undefined ? "no HTTP status" : `HTTP ${status}`;
  return `⛔ github-sync REST fallback FAILED for ${site} (${code}) — the Paperclip REST fallback key may be dead (#457); inbound mirrors for this site will stop until it is fixed.`;
}

/**
 * Persist one swallowed-failure record. Callers wrap this in try/catch — the
 * failure being reported must never be masked by a secondary failure writing it
 * down (a DB outage is itself a likely root cause of the failure being recorded).
 */
export async function recordError(db: MappingDb, row: ErrorRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${qualifiedTable(db)} (occurred_at, scope, detail, context)
       VALUES ($1, $2, $3, $4)`,
    [
      row.occurredAt,
      row.scope,
      row.detail,
      row.context && Object.keys(row.context).length > 0 ? JSON.stringify(row.context) : null,
    ],
  );
}

/**
 * Most-recent swallowed failures first — the queryable read side. Backs ad-hoc
 * `SELECT` triage today; a future `GET /api/plugins/:id/logs`-style endpoint (or a
 * host plugin_logs wiring) can layer on top without changing the write path.
 */
export async function recentErrors(db: MappingDb, limit = 50): Promise<ErrorRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT occurred_at, scope, detail, context
       FROM ${qualifiedTable(db)} ORDER BY occurred_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    occurredAt: String(r.occurred_at),
    scope: String(r.scope),
    detail: String(r.detail),
    context: r.context != null ? safeParseContext(String(r.context)) : undefined,
  }));
}

function safeParseContext(raw: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Decision returned by {@link OpsPingThrottle.decide}. */
export interface ThrottleDecision {
  /** True → the caller should post this ping; false → suppress it. */
  emit: boolean;
  /** How many identical pings were suppressed since the last emit for this key. */
  suppressed: number;
}

interface ThrottleWindow {
  /** Epoch-ms the current window opened (the last emit). */
  openedAt: number;
  /** Epoch-ms of the most recent hit (emitted or suppressed). */
  lastAt: number;
  /** Count of hits suppressed in the current window (excludes the opening emit). */
  suppressed: number;
}

/**
 * In-memory, per-key rate limiter for repetitive ops-webhook alerts (GOL-724).
 *
 * WHY: the PR-review pipeline pings Discord fire-and-forget on every HMAC reject /
 * broker-401 / handler failure. A single worker-crash window plus GitHub's automatic
 * webhook redelivery therefore spams N identical `🔥 PR review pipeline error` lines
 * at ops. This collapses identical alerts to one per `windowMs`: the first hit in a
 * window emits, further identical hits are counted and suppressed, and the first emit
 * of the NEXT window reports how many were swallowed so the signal is never lost.
 *
 * The plugin worker is a long-lived process, so this Map persists across webhook
 * invocations. State is intentionally in-memory only: a restart resets the throttle,
 * which fails open (an extra ping) rather than silently swallowing a fresh alert.
 */
export class OpsPingThrottle {
  private readonly windowMs: number;
  private readonly windows = new Map<string, ThrottleWindow>();

  constructor(windowMs = 5 * 60_000) {
    this.windowMs = windowMs;
  }

  /**
   * Decide whether the alert identified by `key` should be emitted at `now` (ms).
   * Pass a stable key — the ping content itself is a good choice, so only byte-for-byte
   * identical alerts collapse and a different error still pages immediately.
   */
  decide(key: string, now: number): ThrottleDecision {
    const w = this.windows.get(key);
    let decision: ThrottleDecision;
    if (!w || now - w.openedAt >= this.windowMs) {
      const suppressed = w ? w.suppressed : 0;
      this.windows.set(key, { openedAt: now, lastAt: now, suppressed: 0 });
      decision = { emit: true, suppressed };
    } else {
      w.lastAt = now;
      w.suppressed += 1;
      decision = { emit: false, suppressed: w.suppressed };
    }
    // Opportunistically drop stale keys so the Map stays bounded over the
    // long-lived worker (GOL-728). Runs AFTER the current key is refreshed to
    // `now` above, so this call never evicts the window we just decided on and
    // its `suppressed` count is preserved for the next re-open.
    this.prune(now);
    return decision;
  }

  /** Drop windows with no hit for a full window, so the Map can't grow unbounded. */
  prune(now: number): void {
    for (const [key, w] of this.windows) {
      if (now - w.lastAt >= this.windowMs) this.windows.delete(key);
    }
  }
}

/**
 * Append a `(+N earlier alerts suppressed)` note when a throttled ping re-opens after
 * swallowing repeats, so the collapsed count is still visible in the ops channel.
 */
export function withSuppressionNote(content: string, suppressed: number): string {
  return suppressed > 0 ? `${content} (+${suppressed} identical alert${suppressed === 1 ? "" : "s"} suppressed)` : content;
}
