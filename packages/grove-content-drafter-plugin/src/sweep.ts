/**
 * Sweep phase (GOL-2424 Option A): the reliability backstop for the receive
 * event. It walks this plugin's open request issues and, for each:
 *   1. runs {@link processReply} — harvests a reply the event dropped (events
 *      deliver deltas and can be missed; the sweep guarantees eventual pickup);
 *   2. if still waiting past the timeout, re-pings the drafting agent once, then
 *      gives up and marks the request blocked so it never hangs forever.
 */
import { processReply, type ReceiveDeps } from "./receive.js";

export interface SweepSummary {
  scanned: number;
  drafted: number;
  invalid: number;
  rePinged: number;
  gaveUp: number;
  waiting: number;
}

const HOUR_MS = 60 * 60 * 1000;

export async function runSweep(deps: ReceiveDeps, listLimit = 100): Promise<SweepSummary> {
  const { issues, state, cfg, now, logger } = deps;
  const summary: SweepSummary = { scanned: 0, drafted: 0, invalid: 0, rePinged: 0, gaveUp: 0, waiting: 0 };

  const owned = await issues.listOwnRequests(listLimit);
  for (const issue of owned) {
    const req = await state.getRequest(issue.id);
    if (!req || req.status !== "open") continue;
    summary.scanned++;

    const outcome = await processReply(deps, issue.id);
    if (outcome.status === "drafted") {
      summary.drafted++;
      continue;
    }
    if (outcome.status === "invalid") {
      summary.invalid++;
      if (outcome.gaveUp) summary.gaveUp++;
      continue;
    }
    if (outcome.status !== "waiting") continue; // ignored/error — leave for next sweep

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

  return summary;
}
