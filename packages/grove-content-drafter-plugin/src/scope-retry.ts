/**
 * Bounded retry for the host's invocation-scope fail-closed rejection (GOL-2927,
 * root cause on GOL-323; retry budget cut to a short grace in GOL-3352).
 *
 * WHY THIS EXISTS
 * ---------------
 * The host derives a per-dispatch invocation scope only for `performAction`,
 * `executeTool`, `onEvent`, or params that carry `companyId` directly
 * (`plugin-worker-manager.ts` `deriveInvocationScope`). A `runJob` dispatch
 * carries `{job:{jobKey,runId,trigger,scheduledAt}}` — no `companyId` — so NO
 * invocation is registered for a scheduled job at all.
 *
 * `contextForWorkerMessage()` then fails CLOSED: a worker→host call with no
 * `paperclipInvocationId` is rejected whenever `activeInvocations.size > 0` OR
 * any in-flight host→worker request carries an `invocationId`. For this plugin
 * the competing dispatch is its own company-wide `issue.comment.created`
 * `onEvent` — which is why the loss is load-correlated (~20% of sweep ticks in a
 * busy window, 0% in a quiet one) and why the error text ("missing, expired, or
 * unknown invocation scope") is misleading: the scope was never created, and the
 * rejection is caused by *unrelated* concurrent traffic.
 *
 * WHY A RETRY CANNOT BE THE FIX (GOL-2929 / GOL-3352)
 * --------------------------------------------------
 * The GOL-2927 version of this file assumed the competing scope lives only as
 * long as the event handler runs. It does not. The host delivers `onEvent` via
 * `notify()` — a fire-and-forget JSON-RPC notification — and registers its scope
 * with `registerInvocation(scope, MAX_RPC_TIMEOUT_MS)`: a FIXED 15-MINUTE TTL.
 * Notifications have no response, so nothing ever calls `clearInvocation` for
 * them; only the TTL (or a worker crash) removes the entry. Every delivered
 * comment event therefore blocks ALL of this plugin's scope-less host calls for
 * exactly 15 minutes, however fast the handler finished. The original ~16 s
 * retry budget could only win if the tick landed in the last ~16 s of that TTL
 * — measured over 7 days post-deploy: 1 recovery in 563 ticks, 17.9% failed.
 *
 * The real fix is structural (GOL-3352): the sweep also runs *inside* the event
 * handler, where the plugin does hold a valid scope, and a scheduled sweep whose
 * retry is exhausted is treated as "skipped — covered by the event sweep". This
 * wrapper is kept as a short grace for the one transient it can actually beat
 * (a tick landing in the final moments of a TTL), and because a denied call is
 * still a pure pre-flight gate — the SDK's `gated()` calls
 * `requireInvocationCompanyScope()` *before* the real handler
 * (`host-client-factory.ts`), so retrying a write cannot double-post.
 *
 * Only this one error class is retried; everything else propagates untouched.
 */

/** Logger surface this module needs — matches the SDK's `ctx.logger`. */
export interface ScopeRetryLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface ScopeRetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** First backoff in ms; doubles each attempt, capped by `maxDelayMs`. */
  baseDelayMs?: number;
  /** Ceiling for a single backoff. */
  maxDelayMs?: number;
  logger?: ScopeRetryLogger;
  /** Injectable sleep + jitter so tests run instantly and deterministically. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * Attempt schedule with the defaults below: one retry after 250 ms (±25%
 * jitter). GOL-3352 cut this from 7 attempts / ~16 s: against a 15-minute scope
 * hold the long wait bought nothing (it only ever rescued a tick that landed in
 * the TTL's final seconds) and each failing tick burned ~16 s of the 5-minute
 * `runJob` budget doing it. One short retry still covers a genuinely momentary
 * race; the covering path for everything else is the event-driven sweep.
 */
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 8_000;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True when `err` is the host's invocation-scope denial. Deliberately lenient so
 * it survives minor host wording changes: requires the "invocation scope" phrase
 * plus one of missing/expired/unknown. Mirrors `isScopeExpiryError` in the
 * github-sync plugin (kept as a local copy — these plugins are separately
 * bundled and share no runtime package).
 */
export function isInvocationScopeError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (!msg.includes("invocation scope")) return false;
  return msg.includes("missing") || msg.includes("expired") || msg.includes("unknown");
}

/** Jittered exponential backoff: `base * 2^attempt`, capped, then ±25%. */
function delayFor(attempt: number, opts: Required<Pick<ScopeRetryOptions, "baseDelayMs" | "maxDelayMs">>, random: () => number): number {
  const raw = Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs);
  // Jitter spreads retries so two colliding scope-less jobs do not re-collide in
  // lockstep every attempt.
  const jitter = 0.75 + random() * 0.5;
  return Math.round(raw * jitter);
}

/**
 * Run `fn`, retrying ONLY on {@link isInvocationScopeError} with bounded
 * jittered backoff. Any other error — and the final scope error once the budget
 * is spent — is rethrown unchanged so real failures stay visible.
 */
export async function withScopeRetry<T>(label: string, fn: () => Promise<T>, opts: ScopeRetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let waitedMs = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await fn();
      // Only speak when a retry actually rescued the call, so the quiet path
      // stays quiet and the log line is evidence the band-aid is load-bearing.
      if (attempt > 0) {
        opts.logger?.info?.("content-drafter: host call recovered after invocation-scope retry", {
          label,
          attempt: attempt + 1,
          waitedMs,
        });
      }
      return result;
    } catch (err) {
      if (!isInvocationScopeError(err) || attempt >= attempts - 1) {
        if (isInvocationScopeError(err)) {
          opts.logger?.warn?.("content-drafter: invocation-scope retry budget exhausted", {
            label,
            attempts,
            waitedMs,
          });
        }
        throw err;
      }
      const ms = delayFor(attempt, { baseDelayMs, maxDelayMs }, random);
      waitedMs += ms;
      await sleep(ms);
    }
  }
}
