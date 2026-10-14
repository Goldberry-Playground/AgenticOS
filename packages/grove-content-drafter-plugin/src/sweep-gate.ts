/**
 * In-worker serialisation for the sweep (GOL-3352).
 *
 * The sweep now runs from two places: the scheduled `content-draft-sweep` job
 * and, since GOL-3352, from inside every `issue.comment.created` handler (the
 * only context the host grants this plugin a valid invocation scope — see
 * `scope-retry.ts`). {@link processReply} is idempotent, so two overlapping
 * sweeps are *safe*, but they double every host round-trip for nothing.
 *
 * Semantics: at most one sweep runs at a time, and at most one more waits
 * behind it. A third request while one is running and one is queued is
 * coalesced (dropped) — the queued sweep starts after the running one ends,
 * so it already covers everything the dropped request would have seen.
 *
 * The follow-up is queued rather than skipped on purpose: the running sweep
 * may be a scheduled tick spinning in its (now short) invocation-scope retry,
 * about to fail. Skipping the event sweep in that case would leave the window
 * uncovered; queuing it means the scoped sweep runs the moment the doomed one
 * gives up.
 *
 * Note on scope propagation: `fn` is executed as a promise continuation
 * created inside the caller's async context, so a queued event sweep still
 * runs under that event's `AsyncLocalStorage` invocation — the SDK stamps
 * every worker→host call made from it with the event's invocation id.
 */

export type SweepGateOutcome<T> = { outcome: "ran"; result: T } | { outcome: "coalesced" };

export class SweepGate {
  private tail: Promise<unknown> = Promise.resolve();
  /** Runs accepted (queued or executing) that have not finished yet. */
  private outstanding = 0;

  /** True while a sweep is executing or waiting to execute. */
  get busy(): boolean {
    return this.outstanding > 0;
  }

  async run<T>(fn: () => Promise<T>): Promise<SweepGateOutcome<T>> {
    // One executing + one queued is the cap; anything beyond is covered by
    // the queued run, which has not started yet and so sees the same world.
    if (this.outstanding >= 2) return { outcome: "coalesced" };
    this.outstanding++;
    const prev = this.tail;
    const run = prev
      // A failed predecessor must not poison the chain; its error went to its
      // own caller.
      .catch(() => undefined)
      .then(async () => {
        try {
          return await fn();
        } finally {
          this.outstanding--;
        }
      });
    this.tail = run;
    return { outcome: "ran", result: await run };
  }
}
