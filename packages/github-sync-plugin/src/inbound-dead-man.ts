/**
 * Inbound dead-man tripwire (GOL-2370, Deliverable 2 of GOL-2344) — the paging
 * counterpart to the reconcile sweeps.
 *
 * The reconcile sweeps SELF-HEAL a dropped inbound delivery within an hour, but they
 * do so silently: if the *entire* inbound ingress is dead (worker down, webhook URL
 * mis-routed, the host receive-path not dispatching to the plugin at all), the sweeps
 * still run and quietly backfill — nobody is paged, and the outage can smoulder for
 * days. That is exactly what happened twice: the 2026-09-21 (grove-sites#775) and
 * 2026-09-14 (GOL-2279) outages both showed the SAME definitive signature — NO
 * `github_sync_delivery` row landed for days while GitHub kept showing PR/issue
 * activity in bridged repos. The delivery-log cliff was the tell every time.
 *
 * This tripwire turns that cliff into a page. On the hourly cadence it asks two
 * questions and pages only on the one answer that means an outage:
 *
 *   1. Did ANY delivery row (any outcome — even a rejected probe) land in the last
 *      N hours? If yes → the ingress provably reaches the plugin → `deliveries-present`,
 *      no page, and we skip the GitHub probes entirely (cheap on every healthy hour).
 *   2. If zero deliveries: does GitHub's REST API show a PR/issue updated in the same
 *      N-hour window in ANY bridged repo?
 *        - No recent activity anywhere → `quiet-fleet`: the fleet is simply idle, so a
 *          delivery drought is expected. NO page (paging here would be pure noise).
 *        - Recent activity but zero deliveries → `webhook-dead`: GitHub kept moving
 *          while nothing reached us. PAGE ⛔.
 *
 * This module is a pure decision function (no ctx, no DB, no HTTP) so the three
 * outcomes are exhaustively unit-testable; the worker wires the DB counter, the REST
 * probe, and the throttled Discord alert around it. In practice AgenticOS's own App
 * webhook (CI check_suite/workflow_run/pull_request) makes the healthy delivery rate
 * high, so "zero deliveries in N hours" is a strong, low-false-positive dead signal —
 * it means the ingress is down fleet-wide, not that one repo went quiet.
 */
import type { SyncLogger } from "./sync.js";

/** Result of probing one bridged repo for recent PR/issue activity via REST.
 *  `{ ok:false }` is a transient read failure (auth blip / timeout) the next run
 *  retries — never counted as activity, so a flaky probe can't manufacture a page. */
export type RepoActivityResult =
  | { ok: true; active: boolean; latestUpdatedAt: string | null }
  | { ok: false; error: string };

/** The discriminator that separates a genuinely quiet fleet from a dead ingress. */
export type DeadManVerdict =
  /** ≥1 delivery landed in the window — the ingress is provably alive. No page. */
  | "deliveries-present"
  /** No delivery AND no bridged repo shows recent GitHub activity — idle fleet. No page. */
  | "quiet-fleet"
  /** No delivery but ≥1 bridged repo shows recent GitHub PR/issue activity — PAGE. */
  | "webhook-dead";

export interface InboundDeadManInput {
  /** Bridged repo slugs to probe (the keys of the worker's client map). */
  repoSlugs: readonly string[];
  /** Count `github_sync_delivery` rows of ANY outcome since the window start. */
  countDeliveries: () => Promise<number>;
  /** Probe one repo for a PR/issue updated at/after the window start. */
  checkActivity: (repoSlug: string) => Promise<RepoActivityResult>;
  logger: SyncLogger;
}

export interface InboundDeadManSummary {
  /** Which of the three worlds we are in — see {@link DeadManVerdict}. */
  verdict: DeadManVerdict;
  /** True iff a ⛔ ops alert should be posted (verdict === "webhook-dead"). */
  page: boolean;
  /** Delivery rows seen in the window (the dead-man's primary signal). */
  deliveries: number;
  /** Bridged repos whose REST probe reported recent activity (the page's evidence). */
  activeRepos: string[];
  /** Bridged repos probed for activity (0 when short-circuited on live deliveries). */
  reposChecked: number;
  /** Repos whose REST probe failed outright (auth blip / timeout) — retried next run. */
  reposFailed: number;
}

export async function runInboundDeadMan(
  input: InboundDeadManInput,
): Promise<InboundDeadManSummary> {
  const deliveries = await input.countDeliveries();

  // Fast path: any delivery — even a rejected probe — proves the ingress reaches the
  // plugin, so there is no dead-man to fire. Skip the GitHub probes entirely (this is
  // the common case on every healthy hour, so it stays a single cheap COUNT query).
  if (deliveries > 0) {
    return {
      verdict: "deliveries-present",
      page: false,
      deliveries,
      activeRepos: [],
      reposChecked: 0,
      reposFailed: 0,
    };
  }

  // Zero deliveries in the window: distinguish a dead ingress from an idle fleet by
  // asking GitHub whether ANY bridged repo saw a PR/issue update in the same window.
  const activeRepos: string[] = [];
  let reposFailed = 0;
  let reposChecked = 0;
  for (const repoSlug of input.repoSlugs) {
    reposChecked++;
    const res = await input.checkActivity(repoSlug);
    if (!res.ok) {
      reposFailed++;
      input.logger.warn("inbound-dead-man: activity probe failed; skipping repo this run", {
        repo: repoSlug,
        error: res.error,
      });
      continue;
    }
    if (res.active) activeRepos.push(repoSlug);
  }

  if (activeRepos.length > 0) {
    return {
      verdict: "webhook-dead",
      page: true,
      deliveries,
      activeRepos,
      reposChecked,
      reposFailed,
    };
  }
  return {
    verdict: "quiet-fleet",
    page: false,
    deliveries,
    activeRepos,
    reposChecked,
    reposFailed,
  };
}

/**
 * The ⛔ page fired on a `webhook-dead` verdict. Error-class wording so it passes every
 * `opsPingMode`; it names the window and the active repos so the on-call knows the
 * ingress (not one repo) is down and mirrors/reviews are silently not landing.
 */
export function buildInboundDeadManPing(
  s: InboundDeadManSummary,
  windowHours: number,
): string {
  const repos = s.activeRepos.join(", ");
  return (
    `⛔ github-sync inbound DEAD: 0 webhook deliveries in ${windowHours}h, but GitHub ` +
    `shows recent PR/issue activity in ${s.activeRepos.length} bridged repo(s) ` +
    `(${repos}). The inbound ingress is down — mirrors/reviews are NOT landing. ` +
    `Check the webhook route / plugin worker.`
  );
}
