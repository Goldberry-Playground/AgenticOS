/**
 * Outbound-close reconcile sweep (GOL-3374) — the polling mirror of the
 * event-driven OUTBOUND close (`handleIssueUpdated`, sync.ts), and the leg
 * every other direction already had:
 *
 *   mirror-reconcile          Paperclip → GitHub   CREATE  (skips terminal issues)
 *   inbound-create-reconcile  GitHub → Paperclip   CREATE
 *   inbound-close-reconcile   GitHub → Paperclip   CLOSE
 *   outbound-close-reconcile  Paperclip → GitHub   CLOSE   ← this module
 *
 * A Paperclip `done`/`cancelled` reaches GitHub solely if its `issue.updated`
 * event was dispatched AND the GitHub PATCH succeeded. When that single PATCH
 * fails — a broker blip, a GitHub 4xx/5xx, a worker restart, or (until GOL-3374)
 * the deterministic full-slug URL bug on inbound-origin rows — nothing ever
 * retried: the failure was a `logger.error` in a 7-day-rotated server.log and
 * `mirror-reconcile` deliberately skips terminal issues. That is how 22 twins
 * bulk-closed on 2026-10-05 stayed open on GitHub until Josh closed them by hand.
 *
 * Each run lists every bridged repo's OPEN GitHub issues (a short list — the
 * open set is tens of issues, one page; crucially NOT a `since`-bounded list,
 * because a failed PATCH never touched the GitHub issue's `updated_at`) and, for
 * each one whose Paperclip twin is terminal, pushes `state: closed` through the
 * same resolution + failure sink the event path uses (`pushIssueState`). An open
 * twin is left alone (in sync); an unmapped issue is ignored.
 *
 * Why this is also the GUARD (AC4): a healthy event path makes every run a
 * no-op. A non-zero `pushed` means a close was dropped in the last hour and
 * self-healed — the 🔁 ops ping it fires is the signal that the event leg
 * regressed, instead of a quarterly hand-reconcile discovering it.
 *
 * Runs inside the existing `inbound-close-reconcile` job (no manifest change,
 * cheap hot-reload deploy) right after the inbound leg. Idempotent: a pushed
 * close disappears from the open list next run.
 */
import type { SyncLogger } from "./sync.js";

/** Minimal open-issue shape the sweep needs. PRs are already filtered out
 *  upstream (GitHubClient.listIssues drops `pull_request` items). */
export interface OpenIssueRef {
  number: number;
}

/** Result of listing one repo's open issues; `{ ok:false }` is a transient read
 *  failure (auth blip / timeout) that the next sweep retries. */
export type ListOpenIssuesResult =
  | { ok: true; issues: OpenIssueRef[]; truncated: boolean }
  | { ok: false; error: string };

/** Outcome of one outbound close drive for an open GitHub issue. */
export type OutboundCloseDriveOutcome =
  /** No Paperclip twin for this GitHub issue — not ours to close. */
  | "unmapped"
  /** Twin is non-terminal — GitHub open is the correct state; in sync. */
  | "twin-open"
  /** Twin unreadable (transient) — retry next sweep. */
  | "unreadable"
  /** Twin terminal, GitHub was open → `state: closed` pushed (or already closed concurrently). */
  | "pushed"
  /** Twin terminal but the GitHub PATCH failed — recorded durably; retry next sweep. */
  | "failed";

export interface OutboundCloseReconcileInput {
  /** Full `owner/repo` slugs to sweep (clientsBySlug keys). */
  repoSlugs: readonly string[];
  /** List a repo's OPEN issues (PRs pre-filtered, capped). */
  listOpenIssues: (repoSlug: string) => Promise<ListOpenIssuesResult>;
  /** Look up the twin, read its status, push `closed` if terminal (pushIssueState). */
  driveClose: (drive: { repoSlug: string; number: number }) => Promise<OutboundCloseDriveOutcome>;
  logger: SyncLogger;
}

export interface OutboundCloseReconcileSummary {
  /** Open GitHub issues examined across all repos. */
  scanned: number;
  /** Closes pushed to GitHub (the heal count — non-zero means the event leg dropped one). */
  pushed: number;
  /** Open issues with no Paperclip twin — ignored. */
  skippedUnmapped: number;
  /** Open issues whose twin is also open — in sync. */
  skippedTwinOpen: number;
  /** Twin unreadable or GitHub PATCH failed — actionable; next sweep retries. */
  failed: number;
  /** Repos whose open-issue list call failed outright — next sweep retries. */
  reposFailed: number;
  /** Any repo hit the page cap (its remaining open issues were not scanned this run). */
  truncated: boolean;
}

export async function runOutboundCloseReconcile(
  input: OutboundCloseReconcileInput,
): Promise<OutboundCloseReconcileSummary> {
  const summary: OutboundCloseReconcileSummary = {
    scanned: 0,
    pushed: 0,
    skippedUnmapped: 0,
    skippedTwinOpen: 0,
    failed: 0,
    reposFailed: 0,
    truncated: false,
  };

  for (const repoSlug of input.repoSlugs) {
    const listed = await input.listOpenIssues(repoSlug);
    if (!listed.ok) {
      summary.reposFailed++;
      input.logger.warn("outbound-close-reconcile: open-issue list failed; skipping repo this run", {
        repo: repoSlug,
        error: listed.error,
      });
      continue;
    }
    if (listed.truncated) summary.truncated = true;

    for (const issue of listed.issues) {
      summary.scanned++;
      try {
        const outcome = await input.driveClose({ repoSlug, number: issue.number });
        switch (outcome) {
          case "pushed":
            summary.pushed++;
            input.logger.info("outbound-close-reconcile: healed a dropped close", {
              repo: repoSlug,
              number: issue.number,
            });
            break;
          case "twin-open":
            summary.skippedTwinOpen++;
            break;
          case "unmapped":
            summary.skippedUnmapped++;
            break;
          case "unreadable":
          case "failed":
            summary.failed++;
            break;
        }
      } catch (err) {
        summary.failed++;
        input.logger.warn("outbound-close-reconcile: close drive failed; continuing sweep", {
          repo: repoSlug,
          number: issue.number,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return summary;
}

/** Ops-channel one-liner for a sweep that changed something or hit a failure. */
export function buildOutboundCloseReconcilePing(s: OutboundCloseReconcileSummary): string {
  return `🔁 outbound-close-reconcile: closed ${s.pushed} GitHub issue(s) whose Paperclip twin was already terminal (dropped outbound close healed), ${s.failed} failed (scanned ${s.scanned} open)`;
}
