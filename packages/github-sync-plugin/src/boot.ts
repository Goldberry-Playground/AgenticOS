/**
 * Worker boot resilience (GOL-2371, D3 of GOL-2344; follow-up to GOL-2279).
 *
 * On 2026-09-09 a boot-time `execSync` crash in the plugin-worker supervisor left
 * the github-sync worker dead for ~5 days — every inbound GitHub webhook 502'd —
 * with no auto-respawn and no alert. A throw escaping the plugin's own `setup()`
 * is the same class of failure. `bootWithRetry` makes init resilient: a transient
 * boot failure (host not ready, a config-fetch blip) self-heals on a later attempt
 * with exponential backoff, and a fatal one is caught — the worker stays UP
 * (degraded) and pages via `onExhausted` rather than crashing.
 *
 * Kept in its own module (no `runWorker` side effect, no host imports) so the retry
 * behaviour is unit-testable with an injected clock; `worker.ts` wires the real
 * logger + ops-ping page.
 */

/** Minimal logger surface — matches the subset of `ctx.logger` used here. */
export interface BootLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface BootRetryDeps {
  logger: BootLogger;
  /** Total attempts before giving up (default 5). */
  maxAttempts?: number;
  /** First backoff delay in ms; doubles each attempt (default 1000). */
  baseDelayMs?: number;
  /** Injectable sleep (tests pass a no-op); defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once, best-effort, after the final attempt fails (page ops, etc.). */
  onExhausted?: (err: unknown, attempts: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `init` with bounded retry-with-backoff. Resolves once `init` succeeds, or
 * after the final attempt fails — it NEVER rethrows, because a throw out of the
 * worker's `setup()` is exactly the silent-death path we are hardening against.
 * The caller keeps the worker up (degraded) on exhaustion; the liveness heartbeat
 * then never advances, so the external watchdog respawns/pages.
 */
export async function bootWithRetry(init: () => Promise<void>, deps: BootRetryDeps): Promise<void> {
  const maxAttempts = deps.maxAttempts ?? 5;
  const baseDelayMs = deps.baseDelayMs ?? 1000;
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await init();
      return;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (attempt >= maxAttempts) {
        deps.logger.error("worker init failed after retries; staying up degraded", {
          attempts: attempt,
          error: detail,
        });
        if (deps.onExhausted) {
          try {
            await deps.onExhausted(err, attempt);
          } catch {
            // Paging is best-effort; the logger.error above is the floor.
          }
        }
        return;
      }
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      deps.logger.warn("worker init attempt failed; retrying with backoff", {
        attempt,
        nextDelayMs: delayMs,
        error: detail,
      });
      await sleep(delayMs);
    }
  }
}
