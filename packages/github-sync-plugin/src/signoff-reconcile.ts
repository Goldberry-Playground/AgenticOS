/**
 * Sign-off reconcile sweep (GOL-1160) — the missing retry for stranded
 * `agent-review/*` check-runs.
 *
 * handleReviewSignoff (pr-signoff.ts) completes the required check-run when a
 * review issue closes `done`. When that completion hits a NON-terminal failure —
 * a transient broker-token 401, a timeout, a 5xx — it deliberately mutes the
 * alert and relies on "the next issue.updated re-fires the retry" (GOL-802). But
 * a `done` transition is TERMINAL: an agent reviewer can only reach `done` via
 * `in_progress → done`, and nothing edits the issue afterwards, so there is no
 * next event. A blip at the exact moment of sign-off therefore strands the
 * required check `in_progress` FOREVER → the Phase-3 REVIEW_REQUIRED gate blocks
 * the merge → admin bypass is the only way out.
 *
 * Observed 2026-08-03: grove-sites#407, odoocker#387, grove-odoo-modules#68 each
 * had their review issue signed off `done` yet their `agent-review/ada` check sat
 * `in_progress` — the AgenticOS repo's sibling PRs (whose broker token was warm)
 * greened fine at the same moment, confirming a transient per-owner blip, not a
 * permission gap (a manual check-run POST with the same App token returned 201).
 *
 * This hourly sweep is the event-independent retry: it walks recently-touched
 * review rows, and for any whose review issue is `done` but whose
 * `agent-review/<reviewer>` check is not yet green on the row's head, it re-drives
 * the SAME event handler (handleReviewSignoff), which re-evaluates the per-reviewer
 * ada+iris gate and posts every greenlit check idempotently. An already-green
 * check is skipped after one cheap check-run read; the sweep is capped and safe to
 * run twice. Cause-agnostic: whatever stranded the check (transient auth, a dropped
 * dispatch, a deploy gap) is healed on the next sweep.
 */
import type { GitHubClient } from "./github-client.js";
import type { SyncLogger } from "./sync.js";
import type { PrReviewRow } from "./pr-review-store.js";

export interface SignoffReconcileInput {
  companyId: string;
  /** Only consider rows updated after this ISO timestamp (bounds the sweep). */
  sinceIso: string;
  /** Row cap per run (idempotent — the next run re-scans the same window). */
  limit: number;
  /** Recently-touched review rows, newest first (listReviewRecordsUpdatedSince). */
  listRows: (sinceIso: string, limit: number) => Promise<PrReviewRow[]>;
  /** Current Paperclip status of a review issue, or null if unreadable. */
  getIssueStatus: (issueId: string, companyId: string) => Promise<string | null>;
  /** The row's repo → its GitHub client + bare repo name (global closure). */
  resolveRepoClient: (repoSlug: string) => { github: GitHubClient; repo: string } | null;
  /** Re-drive the real sign-off handler for a review issue id (idempotent). */
  driveSignoff: (issueId: string) => Promise<void>;
  logger: SyncLogger;
}

export interface SignoffReconcileSummary {
  scanned: number;
  /** (repo, PR) pairs re-driven because a done review issue had a non-green check. */
  healed: number;
  /** Rows skipped: issue not done, already green, unbridged, or dup of a healed PR. */
  skipped: number;
  /** GitHub read / re-drive failures — the next sweep retries. */
  failed: number;
}

/** True when a completed, successful `agent-review/<reviewer>` check is present. */
export function isSignoffCheckGreen(
  checks: ReadonlyArray<{ name: string; status: string; conclusion: string | null }>,
  reviewer: string,
): boolean {
  const name = `agent-review/${reviewer}`;
  return checks.some((c) => c.name === name && c.status === "completed" && c.conclusion === "success");
}

export async function runSignoffReconcile(input: SignoffReconcileInput): Promise<SignoffReconcileSummary> {
  const summary: SignoffReconcileSummary = { scanned: 0, healed: 0, skipped: 0, failed: 0 };
  const rows = await input.listRows(input.sinceIso, input.limit);

  // One re-drive per (repo, PR): handleReviewSignoff re-evaluates every reviewer
  // gate, so a single call covers both reviewers of the PR.
  const driven = new Set<string>();
  // Cache check-run reads by (repo, head) — a PR's ada + iris rows usually share a
  // head, so this keeps the sweep to one GitHub read per distinct head.
  const checkCache = new Map<string, ReadonlyArray<{ name: string; status: string; conclusion: string | null }> | null>();

  for (const row of rows) {
    summary.scanned++;
    const prKey = `${row.githubRepo}#${row.prNumber}`;
    if (driven.has(prKey)) {
      summary.skipped++;
      continue;
    }

    // Cheapest gate first: a not-`done` review issue means sign-off has not happened
    // (or was reopened by a synchronize) — the check is correctly pending, fail-closed.
    const status = await input.getIssueStatus(row.paperclipIssueId, input.companyId);
    if (status !== "done") {
      summary.skipped++;
      continue;
    }

    const resolved = input.resolveRepoClient(row.githubRepo);
    if (!resolved) {
      // Unbridged repo or a stale row — we have no client to post with; nothing to do.
      summary.skipped++;
      continue;
    }

    const cacheKey = `${resolved.repo}\n${row.headSha}`;
    let checks = checkCache.get(cacheKey);
    if (checks === undefined) {
      const res = await resolved.github.listCommitCheckRuns(resolved.repo, row.headSha);
      checks = res.ok ? res.data : null;
      checkCache.set(cacheKey, checks);
    }
    if (checks === null) {
      // Transient read failure (auth blip / network) — the next sweep retries.
      summary.failed++;
      continue;
    }
    if (isSignoffCheckGreen(checks, row.reviewer)) {
      summary.skipped++; // healthy — already completed
      continue;
    }

    // Stranded: a signed-off review issue whose required check never went green.
    // Re-drive the real handler; it posts every gate-greenlit check idempotently.
    try {
      await input.driveSignoff(row.paperclipIssueId);
      driven.add(prKey);
      summary.healed++;
      input.logger.info("signoff-reconcile: re-drove stranded sign-off", {
        repo: row.githubRepo,
        prNumber: row.prNumber,
        reviewer: row.reviewer,
        headSha: row.headSha,
      });
    } catch (err) {
      summary.failed++;
      input.logger.warn("signoff-reconcile: re-drive failed", {
        repo: row.githubRepo,
        prNumber: row.prNumber,
        reviewer: row.reviewer,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
