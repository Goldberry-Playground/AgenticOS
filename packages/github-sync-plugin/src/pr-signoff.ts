/**
 * Phase 3 prerequisite (GOL-186) — plugin-side agent-review sign-off completion.
 *
 * The PR review pipeline (pr-review.ts / worker.ts) only ever SEEDS a pending
 * `agent-review/*` check-run (seedPendingCheck). Nothing completed it to success:
 * the seed docblock assumed the reviewing agent's own tooling would post the
 * sign-off check, and that tooling does not exist in the reviewer runtime. So a
 * `agent-review/*` check stays `in_progress` forever even after the reviewer's
 * Paperclip issue closes (verified on PR #295 — the reviewer's check never left pending).
 * Phase 3 (GOL-159) makes `agent-review/ada` the single globally-required check
 * (fail-closed); against a pending-forever check that would block every merge.
 *
 * This module completes the check-run SERVER-SIDE and event-driven (Option 2):
 * when a Paperclip review issue reaches its terminal `done` state, an
 * `issue.updated` dispatch calls handleReviewSignoff, which re-evaluates the gate
 * for the PR and posts the green check-run(s) using the Developer App's
 * `checks:write` (GOL-175). Least-privilege: keeps `checks:write` OFF the broad
 * "agents" App and needs no reviewer-side HMAC endpoint.
 */
import type { SyncDeps } from "./sync.js";
import {
  buildPipelineErrorPing,
  buildSignoffPing,
  CHECK_CONTEXT,
  evaluateSignoffGate,
  isSignoffGateGreen,
  shortSha,
  type Reviewer,
} from "./pr-review.js";
import { getReviewRecord, getReviewRecordByIssueId, type PrReviewRow } from "./pr-review-store.js";

/**
 * Complete `agent-review/*` check-runs when a review issue reaches sign-off.
 *
 * Registered as a SECOND `issue.updated` dispatch alongside handleIssueUpdated and
 * independent of it: the mirror path early-returns on unmapped issues (review
 * issues carry no github_sync_mapping row), and this path early-returns on issues
 * with no github_pr_review row (mirror issues). So the two never collide.
 *
 * Flow:
 *  1. Reverse-look up the review record for the updated issue. None → not a review
 *     issue, ignore quietly.
 *  2. Act only when the triggering review issue is `done` (its terminal sign-off).
 *     This ties the check-run post + Discord ping to a real transition, not every
 *     metadata edit; a reopen-to-`todo` (synchronize) or a `cancelled`
 *     non-approval leaves the check pending — fail-closed under the Phase 3 gate.
 *  3. Load both reviewers' rows for the (repo, PR), read each reviewer's issue
 *     status, and evaluate the pure gate (evaluateSignoffGate). Each reviewer's
 *     check greens on its OWN done-state — an advisory reviewer (Iris) that is
 *     pending/blocked never withholds the required `agent-review/ada` (GOL-2390).
 *  4. Post each greenlit check-run on ITS row's current head SHA. A synchronize
 *     resets rows + reopens issues to `todo`, so a `done` issue is necessarily done
 *     against the current head — a stale head can't satisfy the gate. Re-posting is
 *     idempotent (the latest check-run of a name wins); we ✅-ping the checks this
 *     event greenlit.
 */
export async function handleReviewSignoff(
  deps: SyncDeps,
  input: { issueId: string; companyId: string },
): Promise<void> {
  const { db, logger, getIssue } = deps;

  const record = await getReviewRecordByIssueId(db, input.issueId);
  if (!record) return; // not a review issue — the mirror path owns the rest

  const triggerIssue = await getIssue(input.issueId, input.companyId);
  if (!triggerIssue) {
    logger.warn("signoff: review issue not readable; skipping", { issueId: input.issueId });
    return;
  }
  if (triggerIssue.status !== "done") return; // sign-off is the review issue closing `done`

  const adaRow = await getReviewRecord(db, record.githubRepo, record.prNumber, "ada");
  const irisRow = await getReviewRecord(db, record.githubRepo, record.prNumber, "iris");

  const adaDone = adaRow ? await isIssueDone(deps, adaRow, input.companyId) : false;
  const irisDone = irisRow ? await isIssueDone(deps, irisRow, input.companyId) : false;

  const gateInput = { adaDone, irisPresent: irisRow !== null, irisDone };
  const greenlit = evaluateSignoffGate(gateInput);
  if (greenlit.length === 0) {
    logger.info("signoff: no reviewer done yet; no check-run posted", {
      repo: record.githubRepo,
      prNumber: record.prNumber,
      ...gateInput,
    });
    return;
  }
  if (!isSignoffGateGreen(gateInput)) {
    // Advisory checks still post; the merge stays held on the required reviewer(s).
    logger.info("signoff: posting advisory check(s); required gate not yet green", {
      repo: record.githubRepo,
      prNumber: record.prNumber,
      greenlit,
      ...gateInput,
    });
  }

  const posted: Reviewer[] = [];
  for (const reviewer of greenlit) {
    const row = reviewer === "ada" ? adaRow : irisRow;
    if (!row) continue; // the gate never greenlights a reviewer without a row; be safe
    if ((await postSignoffCheck(deps, row, reviewer)) === "posted") posted.push(reviewer);
  }
  // ONE ✅ per sign-off event covering every check this dispatch greened —
  // per-reviewer pings doubled the channel noise on ada+iris PRs.
  if (posted.length > 0) {
    await deps.postOpsPing?.(buildSignoffPing(posted, record.githubRepo, record.prNumber));
  }
}

async function isIssueDone(deps: SyncDeps, row: PrReviewRow, companyId: string): Promise<boolean> {
  const issue = await deps.getIssue(row.paperclipIssueId, companyId);
  return issue?.status === "done";
}

/**
 * Post a green `agent-review/<reviewer>` check-run on the row's head SHA. The
 * target repo + client come from the ROW's stored `owner/repo` slug via
 * deps.resolveRepoClient — NOT from deps.config/deps.github. Those are keyed by
 * paperclipProjectId, and two bridges can share one project; the deps entry then
 * belongs to whichever bridge registered last, so completing with its config
 * posted grove-odoo-modules checks to odoocker-goldberrygrove ("No commit found
 * for SHA", PRs #44/#46) — and the same mixup aims the getPull gate below at the
 * wrong repo's PR number. A resolver miss 🔥-pings and posts nothing rather than
 * guessing a repo; without a resolver (legacy callers) we still derive the bare
 * repo name from the row. Returns "posted" on a recorded check-run so the caller
 * can send ONE ✅ per sign-off event; on API failure we log and 🔥-ping so a
 * stuck-pending required check is never silent.
 *
 * We ALWAYS attempt the post — even when the PR is already merged/closed (GOL-798).
 * The gate frequently greens AFTER the PR merges: a review issue can reach `done`
 * after the merge (pre-GOL-2390 the coupled ada+iris gate made this common), and
 * an agent reviewer that has
 * bumped its issue to `in_progress` can only reach `done` via `in_progress → done`
 * (the API rejects `→ in_review` for agent reviewers). That transition still fires
 * handleReviewSignoff, but a PR whose merge raced ahead of the last sign-off would,
 * under the old pre-merge short-circuit, have its check stranded `in_progress`
 * FOREVER (verified on grove-sites#200/#211/#214 — heads still live, checks stuck).
 * Under the Phase 3 required-check gate that stranded-pending state blocks the merge
 * button on every subsequent PR, so we must drive the check to a terminal state.
 *
 * GitHub happily records a completed check-run on a merged PR's head as long as that
 * commit still exists — so posting greens the strand. The one genuinely-doomed post
 * is a head that no longer exists (a synchronize/force-push superseded it, or the
 * branch was deleted): GitHub answers `422 "No commit found for SHA"` (GOL-781).
 * That row is stale — there is nothing left to gate — so we classify it as benign
 * and suppress the alert (this is the false `🔥 sign-off check-run failed` alarm
 * GOL-781 first squashed, on grove-odoo-modules#44/47/48). Any other failure on a
 * still-open PR is a real stuck-pending gate → 🔥. A `getPull` hiccup
 * (network/permission) never suppresses a real alert: we only mute on a definitive
 * merged/closed, or on the unambiguous missing-commit signature.
 */
async function postSignoffCheck(
  deps: SyncDeps,
  row: PrReviewRow,
  reviewer: Reviewer,
): Promise<"posted" | "skipped"> {
  const { logger } = deps;

  const resolved = deps.resolveRepoClient?.(row.githubRepo) ?? null;
  if (deps.resolveRepoClient && !resolved) {
    logger.error("signoff: no bridge for the review row's repo — check-run not posted", {
      repo: row.githubRepo,
      prNumber: row.prNumber,
      reviewer,
      headSha: row.headSha,
    });
    await deps.postOpsPing?.(
      buildPipelineErrorPing(
        `sign-off check-run skipped for ${row.githubRepo}#${row.prNumber} (${reviewer}): repo is not bridged`,
      ),
      "error",
    );
    return "skipped";
  }
  const github = resolved ? resolved.github : deps.github;
  const repo = resolved ? resolved.repo : bareRepoName(row.githubRepo);

  const res = await github.createCheckRun(repo, {
    name: CHECK_CONTEXT[reviewer],
    headSha: row.headSha,
    conclusion: "success",
    title: `Agent review complete (${reviewer})`,
    summary: `${reviewer} signed off ${row.githubRepo}#${row.prNumber} @ \`${shortSha(row.headSha)}\` (GOL-186).`,
  });
  if (res.ok) {
    logger.info("signoff: posted green check-run", {
      repo: row.githubRepo,
      prNumber: row.prNumber,
      reviewer,
      headSha: row.headSha,
      checkRunId: res.data.id,
    });
    return "posted";
  }

  // The reviewed head no longer exists (superseded/force-pushed/deleted branch) →
  // GitHub 422 "No commit found for SHA". The row is stale; nothing to gate. Benign.
  if (isMissingCommitError(res)) {
    logSkipped(deps, row, reviewer, "reviewed head no longer exists (superseded/deleted)", res.error);
    return "skipped";
  }
  // Any other failure: if the PR is no longer open it is not a live merge gate, so
  // the stuck check is moot — mute. Otherwise it is a genuinely stuck required gate.
  const state = await github.getPull(repo, row.prNumber);
  if (state.ok && isClosedPull(state.data)) {
    logSkipped(deps, row, reviewer, state.data.merged ? "PR merged" : "PR closed", res.error);
    return "skipped";
  }
  // A transient auth/transport failure (a broker-token 401 window, a 429/5xx, or a
  // network blip) is NOT a stuck gate: handleReviewSignoff re-fires on the next
  // issue.updated and the retry greens the check once the token/API recovers
  // (GOL-802 — a ~12:45–12:50Z broker 401 window self-healed by 13:03Z, but every
  // retry meanwhile fired a 🔥 ping, turning one blip into a 59-ping storm across 5
  // open PRs). Log at warn WITH the status (which was being swallowed into an empty
  // `error`) and skip the alert; a genuinely persistent outage still surfaces via
  // the mirror path's 401s + broker health monitors, not this per-retry ping.
  if (isTransientFailure(res)) {
    logger.warn("signoff: check-run completion failed (transient; will retry)", {
      repo: row.githubRepo,
      prNumber: row.prNumber,
      reviewer,
      headSha: row.headSha,
      status: res.status,
      error: res.error,
    });
    return "skipped";
  }
  // Definitive failure on a live open PR — a real stuck required gate (e.g. 403
  // checks:write revoked, or an unexpected 422). Surface the status + GitHub
  // errors[] so it is triageable at a glance, and 🔥 so it is never silent.
  logger.error("signoff: check-run completion failed", {
    repo: row.githubRepo,
    prNumber: row.prNumber,
    reviewer,
    headSha: row.headSha,
    status: res.status,
    error: res.error,
    errors: res.errors,
  });
  await deps.postOpsPing?.(
    buildPipelineErrorPing(
      `sign-off check-run failed for ${row.githubRepo}#${row.prNumber} (${reviewer}): ` +
        `HTTP ${res.status ?? "?"} ${res.error}`,
    ),
    "error",
  );
  return "skipped";
}

/**
 * A retryable failure that does NOT represent a stuck merge gate: a transient auth
 * blip (401 — an expired / half-rotated broker token, GOL-802), a timeout (408),
 * rate-limiting (429), a GitHub 5xx, or a transport-level error (no HTTP status —
 * network/abort). The event-driven retry re-posts and greens the check once the
 * condition clears, so we mute the 🔥 and let the loop self-heal. A 403 (permission
 * genuinely revoked) is deliberately NOT transient — that is a real stuck gate that
 * must alert.
 */
function isTransientFailure(res: { status?: number }): boolean {
  const s = res.status;
  if (s === undefined) return true; // transport-level (network / timeout / broker throw)
  return s === 401 || s === 408 || s === 429 || s >= 500;
}

/** Bare repo name from a full `owner/repo` slug (tolerates a bare name too). */
function bareRepoName(slug: string): string {
  const idx = slug.lastIndexOf("/");
  return idx === -1 ? slug : slug.slice(idx + 1);
}

/** A PR whose head is no longer a live merge gate — merged, or otherwise closed. */
function isClosedPull(pull: { state: "open" | "closed"; merged: boolean }): boolean {
  return pull.merged || pull.state === "closed";
}

/**
 * GitHub's Checks API rejects a completion on a head SHA that no longer resolves in
 * the repo with `422 "No commit found for SHA: <sha>"`. Match on the message (the
 * distinctive, stable signature) so we classify it as benign whether or not the
 * transport populated `status`.
 */
function isMissingCommitError(err: { error: string }): boolean {
  return /no commit found for sha/i.test(err.error);
}

function logSkipped(
  deps: SyncDeps,
  row: PrReviewRow,
  reviewer: Reviewer,
  reason: string,
  detail?: string,
): void {
  deps.logger.info("signoff: skipping check-run completion (benign, nothing to gate)", {
    repo: row.githubRepo,
    prNumber: row.prNumber,
    reviewer,
    headSha: row.headSha,
    reason,
    detail,
  });
}
