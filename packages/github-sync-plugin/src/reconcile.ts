/**
 * Mirror reconcile sweep (scheduled job `mirror-reconcile`).
 *
 * The outbound mirror is purely event-driven: an issue only gets a GitHub twin
 * if its `issue.created` event was delivered AND the handler survived (no
 * scope-expiry, no http.fetch timeout, bridge already configured). Issues
 * created BEFORE a bridge was applied, or during a drop window, are never
 * revisited — ~78 active issues across the three bridged projects had no twin
 * when this shipped. This sweep is the missing feedback loop: every run lists
 * the bridged projects' issues and mirrors any active, unmapped, non-operational
 * issue through the same handleIssueCreated path the event uses (idempotent —
 * it re-checks the mapping and honours the inbound `synced-from-github` marker,
 * so GitHub-originated issues get a provenance row, not a bounce-back).
 *
 * Guard rails:
 *  - `maxCreates` per run (default 20) so a first run over a large backlog
 *    trickles out instead of bursting GitHub rate limits / notification spam.
 *  - Terminal issues (done/cancelled) are skipped — history stays in Paperclip;
 *    mirroring closed work would only create pre-closed GitHub noise.
 *  - Plugin-operational issues (pr-review/ci-fix markers) are skipped, matching
 *    the event-path guard in handleIssueCreated.
 *  - Per-issue failures are counted and logged, never thrown — one bad issue
 *    can't kill the sweep.
 *  - A PERMANENT refusal (bridge repo has Issues disabled → 410) is counted as
 *    `unmirrorable`, not `failed`, and the rest of that project is skipped for
 *    the run. Before this, GOL-3854 alone produced "1 failed" every hour.
 */
import type { Issue } from "@paperclipai/plugin-sdk";
import { handleIssueCreated, isPluginOperationalIssue, isTerminalStatus, type SyncDeps, type SyncLogger } from "./sync.js";
import { getByPaperclipId } from "./mapping.js";

export interface ReconcileInput {
  companyId: string;
  /** Distinct bridged project ids (depsByProject keys). */
  projectIds: readonly string[];
  /**
   * Page through a project's issues in ONE status. Backed by ctx.issues.list.
   *
   * Status is a server-side filter, not a client-side skip, because the sweep is
   * reach-limited: the host returns at most one 100-row page per (project,
   * status) — a second page comes back empty regardless of `offset`. Scanning
   * unfiltered burned that single window on whatever the host returned first,
   * which in practice was overwhelmingly terminal work (273 of 300 rows on
   * 2026-08-05), leaving the actual backlog permanently out of reach.
   */
  listIssues: (projectId: string, status: string, offset: number, limit: number) => Promise<Issue[]>;
  /** The same per-project SyncDeps the event dispatch uses. */
  depsForProject: (projectId: string) => SyncDeps | undefined;
  logger: SyncLogger;
  /** Create budget per run; a capped run reports `capped: true` and the next run continues. */
  maxCreates?: number;
}

export interface ReconcileSummary {
  scanned: number;
  created: number;
  skippedMapped: number;
  skippedTerminal: number;
  skippedPluginOp: number;
  failed: number;
  /** Identifiers (GOL-123, or the id when unset) of the `failed` issues, for the ping. */
  failedIds: string[];
  /**
   * Unmapped issues in a project whose repo refused the create PERMANENTLY
   * (issues disabled). Not `failed`: retrying cannot help, so these don't drive
   * the ops ping on their own. See isPermanentCreateFailure.
   */
  unmirrorable: number;
  unmirrorableIds: string[];
  capped: boolean;
}

const PAGE_SIZE = 100;
const DEFAULT_MAX_CREATES = 20;

/**
 * Every NON-terminal issue status, queried one at a time.
 *
 * Deliberately enumerated rather than "all issues, skip terminal ones": the host
 * yields a single 100-row page per query, so an unfiltered sweep can only ever
 * see 100 issues per project — and on a mature project those are dominated by
 * closed work (the 2026-08-05 run scanned 300 rows, 273 of them terminal, and
 * therefore never reached the 36 issues actually missing a twin). Per-status
 * queries give the backlog its own window each.
 *
 * If a new status is added host-side and not listed here, the sweep silently
 * stops covering it — the trade for reach. `isTerminalStatus` still guards each
 * row, so the failure mode is under-coverage (a missing twin, which the next
 * status addition fixes) rather than mirroring closed work.
 */
const ACTIVE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;

export async function runMirrorReconcile(input: ReconcileInput): Promise<ReconcileSummary> {
  const maxCreates = input.maxCreates ?? DEFAULT_MAX_CREATES;
  const summary: ReconcileSummary = {
    scanned: 0,
    created: 0,
    skippedMapped: 0,
    skippedTerminal: 0,
    skippedPluginOp: 0,
    failed: 0,
    failedIds: [],
    unmirrorable: 0,
    unmirrorableIds: [],
    capped: false,
  };

  for (const projectId of input.projectIds) {
    const deps = input.depsForProject(projectId);
    if (!deps) continue; // bridge skipped at setup (no auth) — nothing to mirror into

    // Set once the bridge's repo refuses a create permanently. Further unmapped
    // issues in this project are tallied without calling GitHub: same repo, same
    // answer, and they must not eat the attempt budget other projects need.
    let projectUnmirrorable = false;

    for (const status of ACTIVE_STATUSES) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await input.listIssues(projectId, status, offset, PAGE_SIZE);
        for (const issue of page) {
          summary.scanned++;
          // Defence in depth: the status filter is server-side, but a host that
          // ignores the param must not make us mirror closed work.
          if (isTerminalStatus(issue.status)) {
            summary.skippedTerminal++;
            continue;
          }
          if (isPluginOperationalIssue(issue.description)) {
            summary.skippedPluginOp++;
            continue;
          }
          if (await getByPaperclipId(deps.db, issue.id)) {
            summary.skippedMapped++;
            continue;
          }
          const label = issue.identifier ?? issue.id;
          if (projectUnmirrorable) {
            summary.unmirrorable++;
            summary.unmirrorableIds.push(label);
            continue;
          }
          // Budget ATTEMPTS (not successes) so a failing GitHub API is retried at
          // next run's pace instead of hammered for the whole backlog in one sweep.
          if (summary.created + summary.failed >= maxCreates) {
            summary.capped = true;
            return summary;
          }
          try {
            // Same idempotent path as the issue.created event; records the mapping.
            const failure = await handleIssueCreated(deps, {
              issueId: issue.id,
              companyId: input.companyId,
            });
            if (failure?.permanent) {
              projectUnmirrorable = true;
              summary.unmirrorable++;
              summary.unmirrorableIds.push(label);
              input.logger.warn("mirror-reconcile: bridge repo refuses issue creates; skipping project for this run", {
                projectId,
                githubRepo: deps.config.githubRepo,
                issueId: issue.id,
                status: failure.status,
                error: failure.error,
              });
              continue;
            }
            // handleIssueCreated logs-and-returns on GitHub failure rather than
            // throwing — the mapping row is the ground truth for success.
            if (await getByPaperclipId(deps.db, issue.id)) {
              summary.created++;
            } else {
              summary.failed++;
              summary.failedIds.push(label);
            }
          } catch (err) {
            summary.failed++;
            summary.failedIds.push(label);
            input.logger.error("mirror-reconcile: mirror-create failed; continuing sweep", {
              issueId: issue.id,
              projectId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (page.length < PAGE_SIZE) break;
      }
    }
  }
  return summary;
}

/** Ops-channel one-liner for a sweep that did something noteworthy. */
export function buildReconcilePing(s: ReconcileSummary): string {
  const capNote = s.capped ? " — capped, next run continues" : "";
  const failedNote = s.failedIds.length ? `: ${listIds(s.failedIds)}` : "";
  const unmirrorableNote = s.unmirrorable
    ? `; ${s.unmirrorable} unmirrorable (repo has issues disabled): ${listIds(s.unmirrorableIds)}`
    : "";
  return `🧹 mirror-reconcile: created ${s.created} missing GitHub twin(s), ${s.failed} failed${failedNote} (scanned ${s.scanned})${unmirrorableNote}${capNote}`;
}

/** Keep the Discord line short: first few ids, then a count. */
const PING_ID_LIMIT = 5;
function listIds(ids: readonly string[]): string {
  const shown = ids.slice(0, PING_ID_LIMIT).join(", ");
  const more = ids.length - PING_ID_LIMIT;
  return more > 0 ? `${shown} +${more} more` : shown;
}
