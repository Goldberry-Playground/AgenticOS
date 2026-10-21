/**
 * PR-close reconcile sweep (GOL-3374) — retires agent review twins whose PR has
 * merged or closed, for deliveries the `pull_request closed` webhook missed.
 *
 * Before GOL-3374 the PR pipeline simply never looked at a closing PR: `closed`
 * sat in the ignored action set and no sweep touched review twins, so an Ada/Iris
 * twin parked `in_review`/`blocked` outlived its PR indefinitely (~50 merged PRs
 * left stranded twins that Josh retired by hand on 2026-10-14). The worker now
 * handles the webhook (`handlePrClosure`); this hourly sweep is its
 * event-independent backstop, the same relationship inbound-close-reconcile has
 * to handleAppClosure.
 *
 * Each run walks recently-touched `github_pr_review` rows. A row whose twin is
 * already terminal is a cheap skip (the common case). For a non-terminal twin it
 * reads the PR once (cached per repo#PR — ada + iris rows share it): still open →
 * in sync; closed → retire the twin through the SAME `resolveReviewTwinClosureStatus`
 * matrix the webhook uses (merged → `done`, closed-unmerged → `cancelled`).
 *
 * Runs inside the existing `signoff-reconcile` job (no manifest change) with its
 * own, longer window: a PR often merges days after its last `synchronize`, and
 * `updated_at` on the row only moves on review activity.
 */
import type { SyncLogger } from "./sync.js";
import type { PrReviewRow } from "./pr-review-store.js";

/** Current state of a PR, or a transient read failure (next sweep retries). */
export type PullStateResult =
  | { ok: true; state: "open" | "closed"; merged: boolean }
  | { ok: false; error: string };

/** Outcome of retiring one review twin (the return of the worker's retireReviewTwin). */
export type TwinRetireOutcome =
  /** Twin status written (`done` or `cancelled`). */
  | "retired"
  /** Twin already terminal — loop guard, nothing written. */
  | "in-sync"
  /** Twin unreadable (transient) — retry next sweep. */
  | "unreadable";

export interface PrCloseReconcileInput {
  companyId: string;
  /** Only consider rows updated after this ISO timestamp (bounds the sweep). */
  sinceIso: string;
  /** Row cap per run (idempotent — the next run re-scans the same window). */
  limit: number;
  /** Recently-touched review rows, newest first (listReviewRecordsUpdatedSince). */
  listRows: (sinceIso: string, limit: number) => Promise<PrReviewRow[]>;
  /** Current Paperclip status of a review twin, or null if unreadable. */
  getIssueStatus: (issueId: string, companyId: string) => Promise<string | null>;
  /** Read the PR's open/closed/merged state (row's full `owner/repo` slug + number). */
  getPull: (repoSlug: string, prNumber: number) => Promise<PullStateResult>;
  /** Write the twin's terminal status per resolveReviewTwinClosureStatus (idempotent). */
  retireTwin: (drive: { row: PrReviewRow; merged: boolean }) => Promise<TwinRetireOutcome>;
  logger: SyncLogger;
}

export interface PrCloseReconcileSummary {
  /** Review rows examined. */
  scanned: number;
  /** Twins moved to `done`/`cancelled` (the heal count). */
  retired: number;
  /** Rows whose twin was already terminal — the common, healthy case. */
  skippedTerminal: number;
  /** Rows whose PR is still open — the twin is correctly live. */
  skippedOpenPr: number;
  /** Twin/PR unreadable or the status write failed — next sweep retries. */
  failed: number;
}

export async function runPrCloseReconcile(input: PrCloseReconcileInput): Promise<PrCloseReconcileSummary> {
  const summary: PrCloseReconcileSummary = { scanned: 0, retired: 0, skippedTerminal: 0, skippedOpenPr: 0, failed: 0 };
  const rows = await input.listRows(input.sinceIso, input.limit);

  // One PR read per (repo, PR) — the ada + iris rows of a PR share it.
  const pullCache = new Map<string, PullStateResult>();

  for (const row of rows) {
    summary.scanned++;

    // Cheapest gate first: a terminal twin needs nothing (webhook already did it,
    // or the reviewer signed off and closed it) — no GitHub read.
    const status = await input.getIssueStatus(row.paperclipIssueId, input.companyId);
    if (status === null) {
      summary.failed++;
      continue;
    }
    if (status === "done" || status === "cancelled") {
      summary.skippedTerminal++;
      continue;
    }

    const prKey = `${row.githubRepo}#${row.prNumber}`;
    let pull = pullCache.get(prKey);
    if (pull === undefined) {
      pull = await input.getPull(row.githubRepo, row.prNumber);
      pullCache.set(prKey, pull);
    }
    if (!pull.ok) {
      summary.failed++;
      input.logger.warn("pr-close-reconcile: PR read failed; retrying next sweep", {
        repo: row.githubRepo,
        prNumber: row.prNumber,
        error: pull.error,
      });
      continue;
    }
    if (pull.state !== "closed") {
      summary.skippedOpenPr++;
      continue;
    }

    try {
      const outcome = await input.retireTwin({ row, merged: pull.merged });
      switch (outcome) {
        case "retired":
          summary.retired++;
          input.logger.info("pr-close-reconcile: retired a stranded review twin", {
            repo: row.githubRepo,
            prNumber: row.prNumber,
            reviewer: row.reviewer,
            merged: pull.merged,
          });
          break;
        case "in-sync":
          summary.skippedTerminal++;
          break;
        case "unreadable":
          summary.failed++;
          break;
      }
    } catch (err) {
      summary.failed++;
      input.logger.warn("pr-close-reconcile: twin retire failed; continuing sweep", {
        repo: row.githubRepo,
        prNumber: row.prNumber,
        reviewer: row.reviewer,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

/** Ops-channel one-liner for a sweep that retired a twin or hit a failure. */
export function buildPrCloseReconcilePing(s: PrCloseReconcileSummary): string {
  return `🔁 pr-close-reconcile: retired ${s.retired} review twin(s) of merged/closed PRs (dropped \`pull_request closed\` healed), ${s.failed} failed (scanned ${s.scanned})`;
}
