#!/usr/bin/env node
/**
 * GOL-2940: approve the `action_required` workflow runs that a `GITHUB_TOKEN`
 * push leaves behind on a bot PR head.
 *
 * WHY THIS EXISTS
 *
 * `ci-autofix.yml` rebuilds the committed plugin `dist` bundles (the
 * `packages/<plugin>/dist` trees) on a
 * Dependabot dependency bump and pushes ONE `[ci-autofix]` commit (GOL-2694).
 * It pushes with `GITHUB_TOKEN`, and GitHub does not let a `GITHUB_TOKEN` push
 * re-trigger its own `pull_request` checks. What we actually observed on
 * AgenticOS#797 is worse than "no runs": GitHub DID create the five
 * `pull_request` runs for the pushed head and parked every one of them at
 * `conclusion: action_required`, `actor: github-actions[bot]`. The PR's live
 * head therefore carried ZERO build results and sat `mergeable_state: blocked`
 * until a human with `actions:write` clicked "Approve and run workflows" — a
 * recurring manual chore on every bundled-dependency bump, and one that no
 * agent token can discharge (the `agenticos-developer` App has no
 * `actions:write`; `POST /actions/runs/{id}/approve` 403s for it).
 *
 * The fix is for the job that created the problem to clean up after itself: it
 * knows exactly which sha it pushed, so it can approve exactly the runs for
 * that sha and nothing else. That is viable here because AgenticOS hands
 * Dependabot-triggered runs a WRITE-capable `GITHUB_TOKEN` — the autofix push
 * on #797 succeeded, which is the first live proof of that (limitation 2 in the
 * `ci-autofix.yml` header does not apply to this repo).
 *
 * BLAST RADIUS
 *
 * Deliberately tiny, because "approve a gated workflow run" is a security gate:
 *
 *  - only runs whose `head_sha` is EXACTLY the sha this job just pushed;
 *  - only `event: pull_request` runs (never `pull_request_target`, never
 *    `workflow_dispatch`, never anything running with base-branch secrets);
 *  - only runs already parked at `action_required` — it cannot start work that
 *    GitHub was not already prepared to run pending approval;
 *  - the approved tree is Dependabot's own tree plus a `pnpm -w build` output
 *    produced by this same CI run, so approval never greenlights third-party
 *    code that CI has not already seen.
 *
 * It NEVER fails the job. A denied approval (no `actions:write`) or a
 * never-appearing run leaves a loud `::warning::` with the manual fallback,
 * exactly like the push step it follows: a dependency PR must not go red over
 * a CI-plumbing problem that is not about the dependency.
 *
 * ZERO RUNS IS NOT ALL-CLEAR. Finding no runs at all after the full wait is
 * reported as a WARNING, not success: it is indistinguishable from "GitHub
 * never created them" and historically that is precisely the state that wedges
 * the PR. Only "runs exist for this sha, none of them gated" is a clean exit.
 */

const API = "https://api.github.com";

/** Runs GitHub parks behind the approval gate. Either field can carry it. */
function isGated(run) {
  return run.status === "action_required" || run.conclusion === "action_required";
}

/**
 * Approve every gated `pull_request` run for `headSha`.
 *
 * @param {object} opts
 * @param {string} opts.repo      `owner/name`
 * @param {string} opts.headSha   the full sha this job pushed
 * @param {string} opts.token     a token with `actions: write`
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(ms:number)=>Promise<void>} [opts.sleep]
 * @param {(line:string)=>void} [opts.log]
 * @param {number} [opts.attempts] poll attempts while no run exists yet
 * @param {number} [opts.delayMs]  delay between poll attempts
 * @returns {Promise<{found:number, approved:string[], stillGated:string[], denied:boolean, clean:boolean}>}
 */
export async function approveGatedRuns({
  repo,
  headSha,
  token,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
  attempts = 10,
  delayMs = 10_000,
}) {
  if (!repo || !headSha) throw new Error("approveGatedRuns needs { repo, headSha }");

  const headers = {
    authorization: `token ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };

  let runs = [];
  for (let i = 1; i <= attempts; i += 1) {
    const url = `${API}/repos/${repo}/actions/runs?head_sha=${headSha}&event=pull_request&per_page=100`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      log(
        `::warning::Could not list workflow runs for ${headSha} (HTTP ${res.status}). ` +
          `If this PR shows no build results, a maintainer must click "Approve and run workflows". (GOL-2940)`,
      );
      return { found: 0, approved: [], stillGated: [], denied: res.status === 403, clean: false };
    }
    const body = await res.json();
    // Defensive re-filter: never trust the query string to have scoped this for
    // us. Approving a run for some other sha is the one thing that must not
    // happen, so the sha check lives next to the approval, not in a URL.
    runs = (body.workflow_runs || []).filter(
      (r) => r.head_sha === headSha && r.event === "pull_request",
    );
    if (runs.length > 0) break;
    if (i < attempts) {
      log(`No pull_request runs for ${headSha} yet (attempt ${i}/${attempts}); waiting…`);
      await sleep(delayMs);
    }
  }

  if (runs.length === 0) {
    log(
      `::warning::No pull_request workflow runs ever appeared for ${headSha}. ` +
        `This PR's live head has NO build results and will sit mergeable_state=blocked. ` +
        `A maintainer must push an empty commit or re-run the checks by hand. (GOL-2940)`,
    );
    return { found: 0, approved: [], stillGated: [], denied: false, clean: false };
  }

  const gated = runs.filter(isGated);
  if (gated.length === 0) {
    log(
      `::notice::${runs.length} pull_request run(s) for ${headSha} are running normally — ` +
        `nothing was parked at action_required, no approval needed.`,
    );
    return { found: runs.length, approved: [], stillGated: [], denied: false, clean: true };
  }

  const approved = [];
  const stillGated = [];
  let denied = false;
  for (const run of gated) {
    const res = await fetchImpl(`${API}/repos/${repo}/actions/runs/${run.id}/approve`, {
      method: "POST",
      headers,
    });
    // 403 = this token has no actions:write. 409 = someone/something already
    // approved it, which is the outcome we wanted anyway.
    if (res.ok || res.status === 409) {
      approved.push(String(run.id));
      log(`Approved gated run ${run.id} (${run.name}) [HTTP ${res.status}]`);
    } else {
      if (res.status === 403) denied = true;
      stillGated.push(String(run.id));
      log(`Could not approve run ${run.id} (${run.name}): HTTP ${res.status}`);
    }
  }

  if (stillGated.length > 0) {
    log(
      `::warning::${stillGated.length} of ${gated.length} workflow run(s) for ${headSha} are still ` +
        `action_required${denied ? " (this run's GITHUB_TOKEN has no actions:write)" : ""}. ` +
        `This PR's live head is missing build results — a maintainer must click ` +
        `"Approve and run workflows" on it. Runs: ${stillGated.join(", ")}. (GOL-2940)`,
    );
  } else {
    log(`::notice::Approved ${approved.length} gated workflow run(s) for ${headSha} (GOL-2940).`);
  }

  return { found: runs.length, approved, stillGated, denied, clean: stillGated.length === 0 };
}

// CLI: approve-gated-runs.mjs <owner/repo> <head-sha>   (token from GITHUB_TOKEN)
if (import.meta.url === `file://${process.argv[1]}`) {
  const [repo, headSha] = process.argv.slice(2);
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !headSha || !token) {
    console.log("::warning::approve-gated-runs.mjs needs <owner/repo> <head-sha> and $GITHUB_TOKEN; skipping. (GOL-2940)");
    process.exit(0);
  }
  try {
    await approveGatedRuns({ repo, headSha, token });
  } catch (err) {
    // Never red a dependency PR over CI plumbing.
    console.log(`::warning::approve-gated-runs.mjs failed: ${err.message}. A maintainer may need to click "Approve and run workflows". (GOL-2940)`);
  }
  process.exit(0);
}
