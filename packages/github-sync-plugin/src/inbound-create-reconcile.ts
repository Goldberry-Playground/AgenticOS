/**
 * Inbound-create reconcile sweep (GOL-1413) — the polling INBOUND sibling of the
 * outbound `mirror-reconcile` sweep, and the create-leg counterpart to
 * `inbound-close-reconcile`.
 *
 * The inbound mirror-create is purely event-driven: a GitHub-native issue only
 * gets a Paperclip twin if its webhook (`opened` App event, or the custom
 * Actions POST) was delivered AND the handler survived. If the webhook is
 * disabled, mis-delivered, or its handler drops (scope expiry, timeout), that
 * issue is NEVER revisited — no feedback loop brings it in. `mirror-reconcile`
 * is outbound-only (Paperclip → GitHub) and `inbound-close-reconcile` only acts
 * on issues that ALREADY have a mapping (it propagates closes, never creates).
 * So a GitHub issue born during an inbound-webhook outage stays twin-less forever.
 *
 * This hourly sweep closes that gap. For each bridged repo it lists recently-open
 * GitHub issues and re-drives the SAME `createMirrorIssue` code path the webhook
 * uses for any issue that is open, not Paperclip-origin, and not already mapped —
 * so the DoD self-heal net holds: a deliberately-induced inbound webhook outage
 * is caught here within an hour (acceptance: a new GitHub issue twins into
 * Paperclip within 60 min with the webhook disabled).
 *
 * Because it reuses `createMirrorIssue`, it inherits — verbatim, no duplication:
 *   - the `getByRepoNumber` idempotency dedupe (a redelivery / already-mapped
 *     issue is a no-op) — the sweep pre-checks the mapping too, so an already-
 *     mirrored issue is a cheap `skipped-mapped`, not a create attempt;
 *   - discipline label routing (assignee resolution) and the ops-visibility ping;
 *   - the REST-fallback write path (scope-expiry safe — a cron tick has no ambient
 *     invocation scope, the same hazard mirror-reconcile hit in GOL-1163).
 *
 * Guard rails (mirroring `mirror-reconcile`):
 *  - `maxCreates` per run (default 20) so a first run over a backlog trickles out
 *    instead of bursting GitHub rate limits / notification spam. Budgets ATTEMPTS
 *    (created + failed) so a failing create is retried at next run's pace.
 *  - Closed issues are skipped — we never create a pre-closed mirror (matches
 *    mirror-reconcile skipping terminal work). The close leg is
 *    `inbound-close-reconcile`'s job; the two sweeps together = full inbound net.
 *  - Paperclip-origin issues (carrying the bridge's `syncLabelPaperclip`) are
 *    skipped — mirroring one would bounce an issue we created outbound.
 *  - Per-issue failures are counted and logged, never thrown — one bad issue
 *    can't kill the sweep; the whole repo-list failing is `reposFailed`, retried.
 *
 * AgenticOS keeps working event-driven and stays a near no-op here (its opened
 * issues reach the mirror before the sweep runs, so they are already mapped).
 * Idempotent and safe to run every cycle: re-scanning a settled repo only
 * produces `skipped-mapped` / `skipped-paperclip-origin`.
 */
import type { SyncLogger } from "./sync.js";

/** Minimal issue shape the create sweep needs. PRs are already filtered out
 *  upstream (GitHubClient.listIssues drops `pull_request` items). Carries the
 *  full body/title/url/labels so `createMirrorIssue` can build the mirror. */
export interface InboundCreateIssueRef {
  number: number;
  state: "open" | "closed";
  title: string;
  body: string;
  url: string;
  labels: string[];
}

/** Result of listing one repo's recent issues; `{ ok:false }` is a transient
 *  read failure (auth blip / timeout) that the next sweep retries. */
export type ListCreateIssuesResult =
  | { ok: true; issues: InboundCreateIssueRef[]; truncated: boolean }
  | { ok: false; error: string };

/** Outcome of a single create re-drive. */
export type CreateDriveOutcome =
  /** A missing mirror was created (mapping row now exists). */
  | "created"
  /** Listed issue is closed — never create a pre-closed mirror. */
  | "skipped-closed"
  /** Already has a Paperclip twin (mapping row present) — nothing to do. */
  | "skipped-mapped"
  /** Carries the bridge's Paperclip-origin label — created outbound, skip. */
  | "skipped-paperclip-origin"
  /** Repo is not in a synced bridge (dropped from config mid-run). */
  | "no-bridge"
  /** Create attempted but the mapping row is still absent (write failed). */
  | "failed";

export interface InboundCreateReconcileInput {
  /** Full `owner/repo` slugs to sweep — the bridged repos. */
  repoSlugs: readonly string[];
  /** List a repo's recently-open issues (PRs pre-filtered, capped, `since`-bounded). */
  listIssues: (repoSlug: string) => Promise<ListCreateIssuesResult>;
  /**
   * Re-drive the SAME mirror-create the inbound webhook uses for one issue. The
   * callback owns the mapping/label/state guards and returns the outcome so the
   * sweep can tally without duplicating createMirrorIssue's internals.
   */
  driveCreate: (drive: {
    repoSlug: string;
    issue: InboundCreateIssueRef;
  }) => Promise<CreateDriveOutcome>;
  /** Create budget per run; a capped run reports `capped: true` and the next continues. */
  maxCreates?: number;
  logger: SyncLogger;
}

export interface InboundCreateReconcileSummary {
  /** GitHub issues examined across all repos (post-PR-filter). */
  scanned: number;
  /** Missing mirrors created this run. */
  created: number;
  /** Issue already had a Paperclip twin — the idempotency skip. */
  skippedMapped: number;
  /** Closed issue — never mirrored (close leg is inbound-close-reconcile). */
  skippedClosed: number;
  /** Paperclip-origin issue (sync label) — created outbound, not bounced back. */
  skippedPaperclipOrigin: number;
  /** Create attempts that did not land a mapping row — next sweep retries. */
  failed: number;
  /** Repos whose issue-list call failed outright — next sweep retries. */
  reposFailed: number;
  /** Any repo hit the page cap (its older issues were not scanned this run). */
  truncated: boolean;
  /** The create budget was exhausted this run; the next run continues the backlog. */
  capped: boolean;
}

const DEFAULT_MAX_CREATES = 20;

export async function runInboundCreateReconcile(
  input: InboundCreateReconcileInput,
): Promise<InboundCreateReconcileSummary> {
  const maxCreates = input.maxCreates ?? DEFAULT_MAX_CREATES;
  const summary: InboundCreateReconcileSummary = {
    scanned: 0,
    created: 0,
    skippedMapped: 0,
    skippedClosed: 0,
    skippedPaperclipOrigin: 0,
    failed: 0,
    reposFailed: 0,
    truncated: false,
    capped: false,
  };

  for (const repoSlug of input.repoSlugs) {
    const listed = await input.listIssues(repoSlug);
    if (!listed.ok) {
      summary.reposFailed++;
      input.logger.warn("inbound-create-reconcile: issue list failed; skipping repo this run", {
        repo: repoSlug,
        error: listed.error,
      });
      continue;
    }
    if (listed.truncated) summary.truncated = true;

    for (const issue of listed.issues) {
      summary.scanned++;
      // Budget ATTEMPTS (creates + failures) so a failing GitHub/Paperclip write is
      // retried at next run's pace instead of hammered across the whole backlog.
      if (summary.created + summary.failed >= maxCreates) {
        summary.capped = true;
        return summary;
      }
      try {
        const outcome = await input.driveCreate({ repoSlug, issue });
        switch (outcome) {
          case "created":
            summary.created++;
            break;
          case "skipped-mapped":
            summary.skippedMapped++;
            break;
          case "skipped-closed":
            summary.skippedClosed++;
            break;
          case "skipped-paperclip-origin":
            summary.skippedPaperclipOrigin++;
            break;
          case "no-bridge":
            // Repo dropped out of config mid-run — nothing to mirror into.
            break;
          case "failed":
            summary.failed++;
            break;
        }
      } catch (err) {
        summary.failed++;
        input.logger.warn("inbound-create-reconcile: mirror-create re-drive failed; continuing sweep", {
          repo: repoSlug,
          number: issue.number,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return summary;
}

/** Ops-channel one-liner for a sweep that created something (or is retrying failures). */
export function buildInboundCreateReconcilePing(s: InboundCreateReconcileSummary): string {
  const capNote = s.capped ? " — capped, next run continues" : "";
  return `🪞 inbound-create-reconcile: created ${s.created} missing Paperclip twin(s), ${s.failed} failed (scanned ${s.scanned})${capNote}`;
}
