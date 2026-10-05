/**
 * Sweep phase (GOL-2424 Option A): the reliability backstop for the receive
 * event. It walks this plugin's open request issues and, for each:
 *   1. runs {@link processReply} — harvests a reply the event dropped (events
 *      deliver deltas and can be missed; the sweep guarantees eventual pickup);
 *   2. if still waiting past the timeout, re-pings the drafting agent once, then
 *      gives up and marks the request blocked so it never hangs forever.
 *
 * Per-issue failures are isolated and counted in {@link SweepSummary.errors}
 * rather than aborting the tick (GOL-2927). The host-side invocation-scope
 * denial that used to drop ~20% of busy-window ticks outright is handled one
 * level down, in the port wrappers in `worker.ts` — see `scope-retry.ts`.
 */
import { processReply, type ReceiveDeps } from "./receive.js";

export interface SweepSummary {
  scanned: number;
  drafted: number;
  invalid: number;
  rePinged: number;
  gaveUp: number;
  waiting: number;
  /**
   * Issues whose processing threw and were skipped. Non-zero means the sweep
   * still completed — it no longer loses the whole tick to one bad issue
   * (GOL-2927). A persistently non-zero count is the signal to look.
   */
  errors: number;
}

const HOUR_MS = 60 * 60 * 1000;

export async function runSweep(deps: ReceiveDeps, listLimit = 100): Promise<SweepSummary> {
  const { issues, state, cfg, now, logger } = deps;
  const summary: SweepSummary = { scanned: 0, drafted: 0, invalid: 0, rePinged: 0, gaveUp: 0, waiting: 0, errors: 0 };

  const owned = await issues.listOwnRequests(listLimit);
  for (const issue of owned) {
    // Isolate per issue: before GOL-2927 a single throw (a host invocation-scope
    // denial, an Odoo blip) aborted the whole tick and silently dropped every
    // remaining request. The sweep is the reliability backstop — it must not be
    // the thing that fails first.
    try {
      await sweepOne(deps, issue, summary);
    } catch (err) {
      summary.errors++;
      logger?.warn?.("content-drafter: sweep skipped an issue after an error", {
        issueId: issue.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

/** One issue's worth of sweep work. Throws are caught and counted by the caller. */
async function sweepOne(deps: ReceiveDeps, issue: { id: string }, summary: SweepSummary): Promise<void> {
  const { issues, state, cfg, now, logger } = deps;
  const req = await state.getRequest(issue.id);
  if (!req || req.status !== "open") return;
  summary.scanned++;

  const outcome = await processReply(deps, issue.id);
  if (outcome.status === "drafted") {
    summary.drafted++;
    return;
  }
  if (outcome.status === "invalid") {
    summary.invalid++;
    if (outcome.gaveUp) summary.gaveUp++;
    return;
  }
  if (outcome.status !== "waiting") return; // ignored/error — leave for next sweep

  // Still waiting on a first usable reply. Age from request creation.
  const ageMs = now.getTime() - new Date(req.createdAt).getTime();
  const timeoutMs = Math.max(1, cfg.replyTimeoutHours) * HOUR_MS;
  if (!req.rePinged && ageMs >= timeoutMs) {
    await issues.postComment(
      issue.id,
      "Still waiting on a content draft for this product. Please reply with the fenced ```json block " +
        "described above, or say why you can't.",
    );
    await issues.wakeAssignee(issue.id, "content-drafter: draft reply overdue");
    req.rePinged = true;
    await state.setRequest(issue.id, req);
    summary.rePinged++;
    logger?.info("content-drafter: re-pinged overdue request", { issueId: issue.id, productId: req.productId });
  } else if (req.rePinged && ageMs >= 2 * timeoutMs) {
    await issues.postComment(
      issue.id,
      "No usable content draft after a re-ping. Marking this request blocked; re-open it to retry.",
    );
    req.status = "failed";
    await issues.setStatus(issue.id, "blocked");
    await state.setRequest(issue.id, req);
    summary.gaveUp++;
    logger?.info("content-drafter: gave up on overdue request", { issueId: issue.id, productId: req.productId });
  } else {
    summary.waiting++;
  }
}
