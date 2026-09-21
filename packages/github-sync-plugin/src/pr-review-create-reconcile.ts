/**
 * PR review-twin create reconcile sweep (GOL-2344) — the pull-request sibling of
 * the inbound issue-mirror create sweep (`inbound-create-reconcile`, GOL-1413).
 *
 * The agent PR-review pipeline (GOL-158) is purely event-driven: a GitHub PR only
 * gets its Paperclip review twin(s) + seeded `agent-review/*` check-run if its
 * `pull_request` webhook (`opened` / `synchronize` / `reopened` / `ready_for_review`)
 * was delivered AND `handlePrInbound` survived. If that webhook is disabled,
 * mis-delivered, or its handler drops (scope expiry, timeout, a worker-crash
 * window), the PR is NEVER revisited — no feedback loop brings it in. The
 * signoff-reconcile sweep (GOL-1160) only heals PRs that ALREADY have a
 * `github_pr_review` row (it re-drives a stranded sign-off check); it never
 * CREATES a missing twin. So a PR opened during an inbound-webhook outage stays
 * review-less forever, and — for a maintainer-authored PR on a GOL-1406 protected
 * path (auto-approve withholds, the sole maintainer can't self-approve) — it sits
 * unmergeable with no avenue to Ada's sign-off. That is exactly what stranded
 * grove-sites#775 (its `opened` + 3 `synchronize` deliveries were all lost).
 *
 * This hourly sweep closes that gap. For each bridged repo it lists open,
 * non-draft PRs and, for any PR whose current head SHA has no matching
 * `github_pr_review` row (no twin, or a twin stuck on a stale head), re-drives the
 * SAME `handlePrInbound` pipeline the webhook uses — Ada twin always, Iris when a
 * changed path matches the frontend globs, and the pending `agent-review/*`
 * check-run seed. So a deliberately-dropped `pull_request` webhook self-heals
 * within an hour instead of requiring an empty-commit nudge (acceptance: open a
 * maintainer PR on a protected path with the webhook dropped → the twin exists
 * within one sweep interval).
 *
 * Because it reuses the pipeline verbatim it inherits — no duplication:
 *   - the `github_pr_review` per-(repo,PR,reviewer) idempotency: a PR whose twin is
 *     already current is a cheap `skipped-current` (Ada's row pre-checked here so a
 *     settled PR costs one DB read, no GitHub file fetch), a stale head reopens;
 *   - the frontend-glob → Iris reviewer routing and the low-noise lifecycle pings;
 *   - the REST-fallback write path (scope-expiry safe — a cron tick has no ambient
 *     invocation scope, the same hazard the other reconcile sweeps carry, GOL-323).
 *
 * Guard rails (mirroring `inbound-create-reconcile`):
 *  - `maxDrives` ATTEMPTS (twinned + failed) per run (default 20) so a first run
 *    over a backlog trickles out instead of bursting GitHub rate limits / review-
 *    issue spam; a failing drive is retried at next run's pace.
 *  - Draft PRs are skipped — the pipeline never reviews a draft (a `ready_for_review`
 *    re-enters it), so pre-closing that here avoids a wasted file fetch.
 *  - Per-PR failures are counted and logged, never thrown — one bad PR can't kill
 *    the sweep; a whole repo's PR-list failing is `reposFailed`, retried next run.
 *
 * AgenticOS and the business repos keep working event-driven and stay a near
 * no-op here (an open PR's twin is already current by the time the sweep runs, so
 * it is a `skipped-current`). Idempotent and safe to run every cycle.
 */
import type { SyncLogger } from "./sync.js";

/** Minimal open-PR shape the sweep needs to decide + re-drive a review. */
export interface InboundPrRef {
  number: number;
  /** Current PR head commit SHA — review idempotency is keyed on it. */
  headSha: string;
  title: string;
  /** PR html_url (for the review-issue body / pings). */
  url: string;
  /** Draft PRs are never reviewed (a `ready_for_review` re-enters the pipeline). */
  draft: boolean;
}

/** Result of listing one repo's open PRs; `{ ok:false }` is a transient read
 *  failure (auth blip / timeout) that the next sweep retries. */
export type ListPrsResult =
  | { ok: true; prs: InboundPrRef[]; truncated: boolean }
  | { ok: false; error: string };

/** Outcome of a single review re-drive. */
export type PrReviewDriveOutcome =
  /** A missing/stale review twin was created or reopened for the current head. */
  | "twinned"
  /** Ada's review row already sits at the PR's current head — nothing to do. */
  | "skipped-current"
  /** PR is a draft — never reviewed. */
  | "skipped-draft"
  /** Repo is not in a synced bridge (dropped from config mid-run). */
  | "no-bridge"
  /** Re-drive attempted but no twin landed (write failed) — next sweep retries. */
  | "failed";

export interface PrReviewReconcileInput {
  /** Full `owner/repo` slugs to sweep — the bridged repos. */
  repoSlugs: readonly string[];
  /** List a repo's open PRs (drafts included; the drive filters them, capped/paged). */
  listPrs: (repoSlug: string) => Promise<ListPrsResult>;
  /**
   * Re-drive the SAME review pipeline the inbound webhook uses for one PR. The
   * callback owns the bridge/draft/idempotency guards and returns the outcome so
   * the sweep can tally without duplicating the pipeline's internals.
   */
  driveReview: (drive: {
    repoSlug: string;
    pr: InboundPrRef;
  }) => Promise<PrReviewDriveOutcome>;
  /** Drive budget per run; a capped run reports `capped: true` and the next continues. */
  maxDrives?: number;
  logger: SyncLogger;
}

export interface PrReviewReconcileSummary {
  /** Open PRs examined across all repos. */
  scanned: number;
  /** Missing/stale review twins created or reopened this run. */
  twinned: number;
  /** PR whose twin was already current — the idempotency skip. */
  skippedCurrent: number;
  /** Draft PRs skipped — never reviewed. */
  skippedDraft: number;
  /** Re-drives that did not land a twin — next sweep retries. */
  failed: number;
  /** Repos whose PR-list call failed outright — next sweep retries. */
  reposFailed: number;
  /** Any repo hit the page cap (its older PRs were not scanned this run). */
  truncated: boolean;
  /** The drive budget was exhausted this run; the next run continues the backlog. */
  capped: boolean;
}

const DEFAULT_MAX_DRIVES = 20;

export async function runPrReviewReconcile(
  input: PrReviewReconcileInput,
): Promise<PrReviewReconcileSummary> {
  const maxDrives = input.maxDrives ?? DEFAULT_MAX_DRIVES;
  const summary: PrReviewReconcileSummary = {
    scanned: 0,
    twinned: 0,
    skippedCurrent: 0,
    skippedDraft: 0,
    failed: 0,
    reposFailed: 0,
    truncated: false,
    capped: false,
  };

  for (const repoSlug of input.repoSlugs) {
    const listed = await input.listPrs(repoSlug);
    if (!listed.ok) {
      summary.reposFailed++;
      input.logger.warn("pr-review-reconcile: PR list failed; skipping repo this run", {
        repo: repoSlug,
        error: listed.error,
      });
      continue;
    }
    if (listed.truncated) summary.truncated = true;

    for (const pr of listed.prs) {
      summary.scanned++;
      // Budget ATTEMPTS (twinned + failed) so a failing GitHub/Paperclip write is
      // retried at next run's pace instead of hammered across the whole backlog.
      if (summary.twinned + summary.failed >= maxDrives) {
        summary.capped = true;
        return summary;
      }
      try {
        const outcome = await input.driveReview({ repoSlug, pr });
        switch (outcome) {
          case "twinned":
            summary.twinned++;
            break;
          case "skipped-current":
            summary.skippedCurrent++;
            break;
          case "skipped-draft":
            summary.skippedDraft++;
            break;
          case "no-bridge":
            // Repo dropped out of config mid-run — nothing to review into.
            break;
          case "failed":
            summary.failed++;
            break;
        }
      } catch (err) {
        summary.failed++;
        input.logger.warn("pr-review-reconcile: review re-drive failed; continuing sweep", {
          repo: repoSlug,
          number: pr.number,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return summary;
}

/** Ops-channel one-liner for a sweep that twinned something (or is retrying failures). */
export function buildPrReviewReconcilePing(s: PrReviewReconcileSummary): string {
  const capNote = s.capped ? " — capped, next run continues" : "";
  return `🔍 pr-review-reconcile: created/reopened ${s.twinned} missing review twin(s), ${s.failed} failed (scanned ${s.scanned})${capNote}`;
}
