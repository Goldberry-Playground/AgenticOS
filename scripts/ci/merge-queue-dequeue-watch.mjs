#!/usr/bin/env node
//
// merge-queue-dequeue-watch.mjs — GOL-3079 (detection gap left open by GOL-3051)
//
// WHY THIS EXISTS
// ---------------
// When GitHub's merge queue drops an entry there is **no failure signal
// anywhere**. No check-run turns red, so ci-failure-router has nothing to
// route. The PR reverts to `open` + `APPROVED` + `CLEAN` — it looks *perfect*.
// The only trace is a `removed_from_merge_queue` event in the PR timeline, and
// nothing read that. So the next agent to look concluded "approved and green,
// just needs merging", re-enqueued, and burned another full `merge_group`
// fan-out — under exactly the runner saturation that caused the drop. The
// failure was self-amplifying, and that is what made GOL-3051 expensive rather
// than merely annoying.
//
// GOL-3051 raised `check_response_timeout_minutes` 30 → 90 on AgenticOS, which
// closes the *known* cause. This closes the *detection* gap, which also covers
// the causes the timeout does not: a real check failure on the queue branch, a
// base-branch conflict, a sibling entry in the ALLGREEN group failing, manual
// removal.
//
// THREE THINGS THAT ARE NOT OBVIOUS (all verified against PR #814, 2026-10-05)
// ---------------------------------------------------------------------------
// 1. "a `removed_` with no later `added_` and no `merged`" DOES NOT WORK. PR
//    #814 was dequeued silently at 21:09:17Z, then re-enqueued at 23:26:11Z and
//    merged at 23:29:22Z. It has both a later `added_` and a later `merged`, so
//    that rule reports zero findings on the canonical case. The timeline must
//    be segmented into **queue episodes** (`added_` → next `removed_`) and each
//    episode judged on its own: silent iff no `merged`/`closed` lands between
//    that `removed_` and the *next* `added_`. See `queueEpisodes`.
//
// 2. READING CHECK CONCLUSIONS *NOW* MISATTRIBUTES THE CAUSE. All nine
//    `merge_group` runs for #814's first episode were created 20:37:45Z and the
//    earliest of them concluded anything at 21:15:39Z — six minutes *after* the
//    21:09:17Z dequeue. Today they read `CodeQL: failure`, `E2E: failure` (both
//    concluded 21:33Z), so a naive "what is red?" alert blames CodeQL for a
//    dequeue that happened 24 minutes earlier. Every check state must be
//    evaluated **as of the removal timestamp**. See `checkStateAtRemoval`.
//
// 3. ONLY THE JOBS CAN SAY "QUEUED". A run whose jobs never got a runner looks
//    identical, at run level and after the fact, to one that ran. #814's `CI`
//    run created its first jobs at 20:37:46Z and they did not *start* until
//    21:26:49Z — 49 minutes waiting for a hosted runner, i.e. still `queued` at
//    dequeue time. "CI was still queued" is the actionable half of the alert;
//    "PR #814 was dequeued" is not. So the enrichment reads jobs, not just runs.
//
// DELIVERY, AND WHY IT IS LOUD
// ----------------------------
// Two outputs per newly-detected dequeue:
//   (a) a sticky PR comment carrying an HTML marker keyed on the
//       `removed_from_merge_queue` **event id**. It is both the dedupe store
//       (no re-alerting every 15 min for a PR that sits dequeued) and the
//       in-situ signal that stops the re-enqueue reflex — the next agent to
//       open the PR now sees why it is not merged.
//   (b) a Discord ops-webhook alert: out-of-band, so it does not depend on
//       github-sync (GOL-2585) or on anyone reading a GitHub issue.
// Discord is posted FIRST and the marker only after it succeeds, so a failed
// delivery is retried on the next tick instead of being swallowed.
//
// Unlike deploy-failure-alert.mjs — which deliberately exits 0 on an unset
// webhook because its issue-minting leg already ran — this probe exits NON-ZERO
// when it has a finding it could not deliver. A detector whose alarm fails
// silently reproduces the original problem one level up, which is precisely the
// trap GOL-3079 calls out (the Grove ops webhook secret has gone stale before).
//
// Equally: a failed *query* must never read as "no dequeues". Every API call
// goes through `gh()`, which throws on any non-2xx, and the all-clear line is
// only printed after a sweep that completed. `--self-test` replays the bundled
// PR #814 fixture and asserts the known-positive; the workflow runs it as a
// preflight, so a broken detector goes red instead of reporting all-clear.
//
// Usage:
//   node scripts/ci/merge-queue-dequeue-watch.mjs --self-test        # offline, no network
//   node scripts/ci/merge-queue-dequeue-watch.mjs --verify-delivery  # prove the webhook
//   node scripts/ci/merge-queue-dequeue-watch.mjs                    # live sweep
// env:
//   GITHUB_TOKEN / GH_TOKEN      required for the live sweep
//   GITHUB_REPOSITORY            "owner/repo" (set by Actions)
//   DISCORD_WEBHOOK_URL          Grove ops webhook
//   MQ_BASE_BRANCH               protected branch to sweep (default "main")
//   MQ_LOOKBACK_HOURS            only PRs updated this recently (default "24")
//   MQ_RULESET_TOKEN             optional; a token with `administration: read`
//                                so the live merge_queue ruleset's
//                                check_response_timeout_minutes can be read.
//                                The ambient Actions token cannot.
//   MQ_TIMEOUT_MINUTES           override the queue timeout used for cause
//                                attribution; default is read from the live
//                                merge_queue ruleset, else attribution is
//                                reported as unknown rather than guessed
//   MQ_DEQUEUE_DRY_RUN           "1" → print alerts, post nothing

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Discord rejects a message body over 2000 characters outright (HTTP 400). */
export const DISCORD_CONTENT_LIMIT = 2000;

/**
 * A `merged` event can share a second with the `removed_from_merge_queue` that
 * precedes it (#814: 23:29:21Z → 23:29:22Z) and GitHub does not guarantee the
 * two are ordered. Look back a little so a benign merge is never mistaken for a
 * silent drop because of event-ordering jitter.
 */
export const MERGE_PAIR_TOLERANCE_MS = 120_000;

const QUEUE_EVENTS = new Set([
  "added_to_merge_queue",
  "removed_from_merge_queue",
  "merged",
  "closed",
  "reopened",
]);

const ms = (iso) => Date.parse(iso);

/**
 * Human dwell time. The alert's whole value is the number, so it is rendered
 * exactly ("31m50s"), never rounded to "about half an hour".
 */
export function formatDwell(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "unknown";
  const total = Math.round(milliseconds / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/**
 * Segment a PR timeline into merge-queue episodes.
 *
 * Returns one entry per `added_to_merge_queue`, in chronological order:
 *   { addedAt, addedEventId, removedAt, removedEventId, dwellMs,
 *     resolvedAt, resolvedBy, silent, open }
 *
 * - `open: true`     — still enqueued (an `added_` with no `removed_` after it).
 *                      Never a finding; it may merge in a minute.
 * - `silent: true`   — removed with no `merged`/`closed` before the next
 *                      `added_`. THIS is the invisible failure.
 * - `resolvedBy`     — "merged" | "closed" for a benign removal.
 *
 * A `removed_` with no preceding `added_` (timeline truncated before the
 * enqueue, or pagination lost it) still yields an episode with `addedAt: null`
 * and `dwellMs: null` — reported as a finding with an unknown dwell rather than
 * dropped, because dropping it is how the detector goes quiet on exactly the
 * busy PRs where the `added_` fell off an earlier page.
 */
export function queueEpisodes(timeline) {
  const events = (Array.isArray(timeline) ? timeline : [])
    .filter((e) => e && QUEUE_EVENTS.has(e.event) && e.created_at)
    .map((e) => ({ ...e, _t: ms(e.created_at) }))
    .filter((e) => Number.isFinite(e._t))
    // id breaks ties: same-second events are ordered by issue-event id, which
    // is monotonic, so `removed_` never sorts after the `merged` it precedes.
    .sort((a, b) => a._t - b._t || Number(a.id || 0) - Number(b.id || 0));

  const episodes = [];
  let pendingAdd = null;

  for (const e of events) {
    if (e.event === "added_to_merge_queue") {
      if (pendingAdd) {
        // Two adds with no removal between them: the queue cannot hold the same
        // PR twice, so the earlier add's removal event is missing from what we
        // were given. Close it with an unknown removal rather than losing it.
        episodes.push({
          addedAt: pendingAdd.created_at,
          addedEventId: pendingAdd.id ?? null,
          removedAt: null,
          removedEventId: null,
          dwellMs: null,
          resolvedAt: null,
          resolvedBy: null,
          silent: false,
          open: false,
          incomplete: true,
        });
      }
      pendingAdd = e;
      continue;
    }
    if (e.event === "removed_from_merge_queue") {
      episodes.push({
        addedAt: pendingAdd ? pendingAdd.created_at : null,
        addedEventId: pendingAdd ? pendingAdd.id ?? null : null,
        removedAt: e.created_at,
        removedEventId: e.id ?? null,
        dwellMs: pendingAdd ? e._t - ms(pendingAdd.created_at) : null,
        resolvedAt: null,
        resolvedBy: null,
        silent: true, // provisional; the resolution pass below may clear it
        open: false,
        incomplete: !pendingAdd,
      });
      pendingAdd = null;
    }
  }
  if (pendingAdd) {
    episodes.push({
      addedAt: pendingAdd.created_at,
      addedEventId: pendingAdd.id ?? null,
      removedAt: null,
      removedEventId: null,
      dwellMs: null,
      resolvedAt: null,
      resolvedBy: null,
      silent: false,
      open: true,
      incomplete: false,
    });
  }

  // Resolution pass: a removal is benign iff the PR merged (or was closed by a
  // human) inside that episode's window — from just before the removal until
  // the NEXT enqueue. Scoping to the window is the whole point: #814's later
  // merge must not excuse its earlier silent drop.
  const closers = events.filter((e) => e.event === "merged" || e.event === "closed");
  for (let i = 0; i < episodes.length; i += 1) {
    const ep = episodes[i];
    if (ep.open || !ep.removedAt) continue;
    const from = ms(ep.removedAt) - MERGE_PAIR_TOLERANCE_MS;
    const nextAdd = episodes.slice(i + 1).find((n) => n.addedAt);
    const until = nextAdd ? ms(nextAdd.addedAt) : Number.POSITIVE_INFINITY;
    const hit = closers.find((c) => c._t >= from && c._t < until);
    if (hit) {
      ep.resolvedAt = hit.created_at;
      ep.resolvedBy = hit.event;
      ep.silent = false;
    }
  }
  return episodes;
}

/**
 * What a `merge_group` check was actually doing at the instant the queue
 * dropped the entry — the only question whose answer is actionable.
 *
 * `jobs` is optional. With jobs we can distinguish `queued` (created, never
 * got a runner — the GOL-3051 signature) from `running`; without them we
 * cannot, and say so rather than implying precision we do not have.
 *
 * Returns { name, state, detail, url } with state one of:
 *   queued | running | success | failure | cancelled | skipped | not-started | unknown
 */
export function checkStateAtRemoval(run, jobs, removedAtIso) {
  const at = ms(removedAtIso);
  const name = (run && run.name) || "(unnamed check)";
  const url = (run && run.html_url) || "";
  const out = (state, detail) => ({ name, state, detail, url });

  if (!Number.isFinite(at)) return out("unknown", "removal timestamp unparseable");

  const created = ms(run?.created_at ?? run?.run_started_at ?? "");
  if (Number.isFinite(created) && created > at) {
    return out("not-started", "run created after the dequeue");
  }

  const created_ = (Array.isArray(jobs) ? jobs : []).filter((j) => {
    const c = ms(j?.created_at ?? "");
    return Number.isFinite(c) && c <= at;
  });
  // A `skipped` job reports started_at == created_at == completed_at and never
  // touched a runner, so counting it as "started" turns a check that was wholly
  // stuck in the queue into "running". #814's `Required-checks audit` is exactly
  // this: one skipped reconcile job plus one real job that waited 54 minutes for
  // a runner. Skipped jobs carry no information about queue pressure — drop them.
  const relevant = created_.filter((j) => j?.conclusion !== "skipped");
  if (created_.length > 0 && relevant.length === 0) {
    return out("skipped", `all ${created_.length} job(s) skipped`);
  }

  if (relevant.length === 0) {
    // No job data (or none created yet). Fall back to run level, which can only
    // say "it existed and had not concluded".
    const done = ms(run?.updated_at ?? "");
    if (run?.status === "completed" && Number.isFinite(done) && done <= at) {
      return out(run.conclusion || "unknown", "run-level conclusion (no job detail)");
    }
    if (Array.isArray(jobs) && jobs.length > 0) {
      return out("not-started", `0/${jobs.length} jobs created by the dequeue`);
    }
    return out("running", "no job detail available — run had not concluded");
  }

  const started = relevant.filter((j) => {
    const s = ms(j?.started_at ?? "");
    return Number.isFinite(s) && s <= at;
  });
  const finished = relevant.filter((j) => {
    const f = ms(j?.completed_at ?? "");
    return Number.isFinite(f) && f <= at && j.status === "completed";
  });
  const failedEarly = finished.filter(
    (j) => j.conclusion === "failure" || j.conclusion === "timed_out",
  );

  if (failedEarly.length > 0) {
    return out("failure", `${failedEarly.map((j) => j.name).join(", ")} failed before the dequeue`);
  }
  if (started.length === 0) {
    // The GOL-3051 signature: jobs created, never handed a runner.
    return out("queued", `0/${relevant.length} jobs had started — waiting for a runner`);
  }
  if (finished.length === relevant.length) {
    const cancelled = finished.some((j) => j.conclusion === "cancelled");
    return out(cancelled ? "cancelled" : "success", `${finished.length}/${relevant.length} jobs done`);
  }
  return out("running", `${started.length}/${relevant.length} jobs started, ${finished.length} finished`);
}

/**
 * Why the entry was dropped, from the check states as of the removal.
 *
 * Deliberately conservative about the timeout: it is only named when the dwell
 * actually reaches the configured window AND nothing had failed. If the queue
 * timeout is unknown (we could not read the ruleset and no override was given)
 * the cause is reported as `unknown` with the evidence attached — an honest
 * "here is what was still pending" beats a confident wrong attribution, which
 * is the failure mode described in header note 2.
 */
export function classifyDequeue({ dwellMs, states = [], timeoutMinutes = null }) {
  const failed = states.filter((s) => s.state === "failure");
  if (failed.length > 0) {
    return {
      cause: "check-failure",
      headline: `a required check failed on the queue branch: ${failed.map((s) => s.name).join(", ")}`,
    };
  }
  const pending = states.filter((s) => s.state === "queued" || s.state === "running");
  const dwellMin = Number.isFinite(dwellMs) ? dwellMs / 60_000 : null;
  const timedOut =
    Number.isFinite(timeoutMinutes) &&
    timeoutMinutes > 0 &&
    dwellMin !== null &&
    // A minute of slack: GitHub evaluates the timeout on its own tick, so the
    // observed dwell lands a few seconds either side of the configured window.
    dwellMin >= timeoutMinutes - 1;

  if (timedOut && pending.length > 0) {
    return {
      cause: "timeout",
      headline:
        `the queue's check_response_timeout (${timeoutMinutes}m) expired with ` +
        `${pending.length} check(s) still unfinished — runner wait, not a code failure`,
    };
  }
  if (timedOut) {
    return {
      cause: "timeout",
      headline: `dwell reached the queue's check_response_timeout (${timeoutMinutes}m)`,
    };
  }
  if (pending.length > 0) {
    return {
      cause: "unknown",
      headline:
        `nothing had failed and ${pending.length} check(s) were still unfinished — ` +
        "likely a base-branch conflict, a failing sibling entry in the batch, or a manual removal",
    };
  }
  return {
    cause: "unknown",
    headline:
      "no merge_group check was failing or pending at the dequeue — likely a base-branch " +
      "conflict, a failing sibling entry in the batch, or a manual removal",
  };
}

const STATE_ICON = {
  failure: "❌",
  queued: "⏳",
  running: "🔄",
  success: "✅",
  cancelled: "🚫",
  skipped: "⏭️",
  "not-started": "∅",
  unknown: "❔",
};

/** Failures first, then what was still pending, then the rest: the alert's
 *  first line of check detail should be the one that explains the drop. */
const STATE_RANK = {
  failure: 0,
  queued: 1,
  running: 2,
  cancelled: 3,
  "not-started": 4,
  unknown: 5,
  skipped: 6,
  success: 7,
};

/**
 * The Discord message. Compact and phone-readable: what happened → how long →
 * why → the one instruction that breaks the self-amplifying loop → the link.
 * The PR URL is last and is never truncated away (we truncate the check list).
 */
export function buildDequeueAlert(finding) {
  const {
    repo = "(unknown repo)",
    prNumber = "?",
    prTitle = "",
    prUrl = "",
    addedAt = null,
    removedAt = null,
    dwellMs = null,
    headline = "",
    states = [],
    queueBranch = "",
    maxChecks = 12,
  } = finding || {};

  const dwell = dwellMs === null ? "an unknown time" : formatDwell(dwellMs);
  const window =
    addedAt && removedAt ? ` (${addedAt} → ${removedAt})` : removedAt ? ` (at ${removedAt})` : "";

  const lines = [
    `🔇 **SILENT MERGE-QUEUE DEQUEUE — ${repo} #${prNumber}**`,
    prTitle ? `> ${prTitle}` : null,
    `**Dropped from the queue after ${dwell}**${window} — no merge, and nothing turned red.`,
    headline ? `**Why:** ${headline}` : null,
  ].filter(Boolean);

  if (states.length > 0) {
    const sorted = [...states].sort(
      (a, b) => (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9) || a.name.localeCompare(b.name),
    );
    const shown = sorted.slice(0, maxChecks);
    lines.push("**Checks as of the dequeue:**");
    for (const s of shown) {
      lines.push(`${STATE_ICON[s.state] || "•"} ${s.name} — **${s.state}**${s.detail ? ` (${s.detail})` : ""}`);
    }
    if (sorted.length > shown.length) lines.push(`…and ${sorted.length - shown.length} more`);
  } else if (queueBranch) {
    lines.push(`No \`merge_group\` runs found for \`${queueBranch}\` — the batch may never have started.`);
  }

  lines.push(
    "⚠️ **Do not just re-enqueue.** The PR reads `open` + `APPROVED` + `CLEAN`, which is " +
      "what it looked like last time; a blind re-enqueue re-runs the whole `merge_group` " +
      "fan-out under the same conditions that dropped it (GOL-3051).",
  );
  lines.push(prUrl);

  let content = lines.join("\n");
  if (content.length > DISCORD_CONTENT_LIMIT) {
    const keep = `\n…(truncated)\n${prUrl}`;
    content = content.slice(0, DISCORD_CONTENT_LIMIT - keep.length) + keep;
  }
  return content;
}

/**
 * Dedupe key. The `removed_from_merge_queue` **event id** is the right key: it
 * is stable, unique per drop, and distinguishes a *new* drop on a PR that has
 * been dropped before from the one we already alerted on. Keying on the PR
 * number alone would go silent on the second drop, which is the one that proves
 * the loop is running.
 */
export function alertMarker(removedEventId, removedAt) {
  return `<!-- mq-dequeue-watch:${removedEventId ?? `t:${removedAt}`} -->`;
}

/** Already-alerted? Matches the marker anywhere in any existing comment body. */
export function alreadyAlerted(comments, removedEventId, removedAt) {
  const marker = alertMarker(removedEventId, removedAt);
  return (Array.isArray(comments) ? comments : []).some(
    (c) => typeof c?.body === "string" && c.body.includes(marker),
  );
}

/** The sticky PR comment: same facts as Discord, plus the dedupe marker. */
export function buildPrComment(finding) {
  return [
    "### 🔇 This PR was silently dropped from the merge queue",
    "",
    buildDequeueAlert({ ...finding, maxChecks: 20 })
      .split("\n")
      .slice(1)
      .join("\n"),
    "",
    "<sub>Posted by `merge-queue-dequeue-watch` (GOL-3079). This is the signal that " +
      "did not exist during GOL-3051.</sub>",
    alertMarker(finding.removedEventId, finding.removedAt),
  ].join("\n");
}

/** The queue branch GitHub creates for a PR's entry: one per base SHA. */
export function queueBranchPrefix(baseBranch, prNumber) {
  return `gh-readonly-queue/${baseBranch}/pr-${prNumber}-`;
}

/**
 * `merge_group` runs belonging to one episode: on this PR's queue branch, and
 * created inside the episode window. The window matters — #814's queue branch
 * name is identical across both of its episodes (same base SHA), so filtering
 * by branch alone mixes the silent drop's runs with the later successful ones.
 */
export function runsForEpisode(runs, baseBranch, prNumber, episode) {
  const prefix = queueBranchPrefix(baseBranch, prNumber);
  const from = episode.addedAt ? ms(episode.addedAt) - 60_000 : Number.NEGATIVE_INFINITY;
  const until = episode.removedAt ? ms(episode.removedAt) : Number.POSITIVE_INFINITY;
  return (Array.isArray(runs) ? runs : []).filter((r) => {
    if (!String(r?.head_branch || "").startsWith(prefix)) return false;
    const c = ms(r?.created_at ?? r?.run_started_at ?? "");
    return Number.isFinite(c) && c >= from && c <= until;
  });
}

/**
 * Collapse runs → one state per check name, keeping the worst (lowest-ranked)
 * state. A workflow can be re-run inside an episode; the alert should describe
 * the attempt that mattered, not whichever came back last.
 */
export function statesForEpisode(runs, jobsByRunId, removedAt) {
  const byName = new Map();
  for (const run of runs) {
    const jobs = jobsByRunId ? jobsByRunId[String(run.id)] : undefined;
    const st = checkStateAtRemoval(run, jobs, removedAt);
    const prev = byName.get(st.name);
    if (!prev || (STATE_RANK[st.state] ?? 9) < (STATE_RANK[prev.state] ?? 9)) byName.set(st.name, st);
  }
  return [...byName.values()];
}

/**
 * The whole detector, as a pure function over captured API data. This is what
 * the replay test drives; the CLI below only supplies the fetches.
 */
export function detectSilentDequeues({
  repo,
  prNumber,
  prTitle,
  prUrl,
  baseBranch = "main",
  timeline,
  mergeGroupRuns = [],
  jobsByRunId = {},
  timeoutMinutes = null,
}) {
  const findings = [];
  for (const ep of queueEpisodes(timeline)) {
    if (!ep.silent) continue;
    const runs = runsForEpisode(mergeGroupRuns, baseBranch, prNumber, ep);
    const states = ep.removedAt ? statesForEpisode(runs, jobsByRunId, ep.removedAt) : [];
    const { cause, headline } = classifyDequeue({ dwellMs: ep.dwellMs, states, timeoutMinutes });
    findings.push({
      repo,
      prNumber,
      prTitle,
      prUrl,
      addedAt: ep.addedAt,
      removedAt: ep.removedAt,
      removedEventId: ep.removedEventId,
      dwellMs: ep.dwellMs,
      cause,
      headline,
      states,
      timeoutMinutes,
      queueBranch: queueBranchPrefix(baseBranch, prNumber),
    });
  }
  return findings;
}

// --- network layer -----------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_814 = join(HERE, "fixtures", "pr-814-merge-queue-dequeue.json");

/**
 * Every GitHub read goes through here, and it THROWS on any non-2xx. A probe
 * that swallows an API error and prints "no dequeues found" is worse than no
 * probe: it is a false all-clear on the exact signal it exists to raise.
 */
async function gh(token, path, { paginate = false } = {}) {
  const base = "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "merge-queue-dequeue-watch",
  };
  if (!paginate) {
    const res = await fetch(`${base}${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText} for ${path}`);
    return res.json();
  }
  // Timeline pagination is load-bearing: `removed_from_merge_queue` on a busy
  // PR can sit well past the first page, and stopping at page 1 is a silent
  // false negative. Walk until a short page, with a hard page cap.
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${base}${path}${sep}per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText} for ${path} page ${page}`);
    const body = await res.json();
    const items = Array.isArray(body) ? body : body.workflow_runs || [];
    out.push(...items);
    if (items.length < 100) return out;
  }
  return out;
}

/**
 * The configured queue timeout, read from the live merge_queue ruleset so the
 * alert's cause attribution tracks reality instead of a hard-coded 30 or 90.
 * Returns null — never a guess — if no token scope can read rulesets.
 */
async function readQueueTimeoutMinutes(token, owner, repoName, baseBranch) {
  if (!token) {
    console.warn("queue timeout: no ruleset-read token (MQ_RULESET_TOKEN unset) — cause attribution will say unknown.");
    return null;
  }
  try {
    const sets = await gh(token, `/repos/${owner}/${repoName}/rulesets`);
    for (const s of Array.isArray(sets) ? sets : []) {
      const full = await gh(token, `/repos/${owner}/${repoName}/rulesets/${s.id}`);
      if (full?.enforcement !== "active") continue;
      const rule = (full.rules || []).find((r) => r.type === "merge_queue");
      const t = rule?.parameters?.check_response_timeout_minutes;
      if (Number.isFinite(t)) {
        console.log(
          `queue timeout: ${t}m (ruleset ${full.id} "${full.name}", target ${baseBranch})`,
        );
        return t;
      }
    }
    console.warn("queue timeout: no active merge_queue ruleset rule found — cause attribution will say unknown.");
  } catch (err) {
    console.warn(`queue timeout: ruleset read failed (${err.message}) — cause attribution will say unknown.`);
  }
  return null;
}

async function postDiscord(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return res.status;
}

/**
 * Prove the delivery path before anyone relies on it.
 *
 * GOL-3079 calls this out explicitly: the Grove ops webhook has been stale, and
 * an alerter whose delivery fails silently reproduces the original invisible
 * failure one level up. A webhook URL is a secret we cannot read, so the only
 * honest check is to use it.
 *
 * `?wait=true` makes Discord return the created message, whose `channel_id`
 * tells us WHICH channel the configured secret actually points at — there are
 * two live Grove ops webhooks in 1Password (`Grove Infra/discord_webhook_url` →
 * #grove-ops-webhook and `AgenticOS Infra/discord_bot_logs_webhook` →
 * #paperclip-ops), so "it returned 204" is not enough to know the alert lands
 * somewhere a human reads. Run this from `workflow_dispatch` after any secret
 * rotation.
 */
async function verifyDelivery(webhookUrl) {
  if (!webhookUrl) {
    console.error("::error::DISCORD_WEBHOOK_URL is unset — the dequeue watch has no delivery path.");
    return 1;
  }
  const sep = webhookUrl.includes("?") ? "&" : "?";
  const res = await fetch(`${webhookUrl}${sep}wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content:
        "🧪 `merge-queue-dequeue-watch` delivery self-test (GOL-3079). " +
        "No incident — this proves the ops webhook secret is live and lands here. " +
        "Real alerts from this probe start with 🔇 SILENT MERGE-QUEUE DEQUEUE.",
    }),
  });
  if (!res.ok) {
    console.error(`::error::Discord rejected the delivery self-test (HTTP ${res.status}) — the secret is stale or revoked.`);
    return 1;
  }
  let channel = "(unreported)";
  try {
    channel = (await res.json()).channel_id || channel;
  } catch {
    /* ?wait=true should return JSON; a 204 without a body is still a pass. */
  }
  console.log(`delivery self-test: PASS (HTTP ${res.status}) — delivered to channel ${channel}.`);
  return 0;
}

/** Replay the captured PR #814 data and assert the known-positive. */
export function selfTest(fixturePath = FIXTURE_814) {
  const fx = JSON.parse(readFileSync(fixturePath, "utf8"));
  const findings = detectSilentDequeues({
    repo: fx.repo,
    prNumber: fx.prNumber,
    prTitle: fx.prTitle,
    prUrl: fx.prUrl,
    baseBranch: "main",
    timeline: fx.timeline,
    mergeGroupRuns: fx.mergeGroupRuns,
    jobsByRunId: fx.jobsByRunId,
    timeoutMinutes: fx.queueTimeoutMinutesAtTheTime,
  });
  const problems = [];
  if (findings.length !== 1) problems.push(`expected exactly 1 finding, got ${findings.length}`);
  const f = findings[0];
  if (f && formatDwell(f.dwellMs) !== "31m50s") problems.push(`expected dwell 31m50s, got ${formatDwell(f?.dwellMs)}`);
  const ci = f?.states?.find((s) => s.name === "CI");
  if (!ci) problems.push("expected a 'CI' check state in the finding");
  else if (ci.state !== "queued") problems.push(`expected CI still queued, got ${ci.state}`);
  const alert = f ? buildDequeueAlert(f) : "";
  if (!alert.includes("31m50s")) problems.push("alert text does not name the dwell time");
  if (!/CI — \*\*queued\*\*/.test(alert)) problems.push("alert text does not name CI as queued");
  return { ok: problems.length === 0, problems, findings, alert };
}

async function sweep() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const slug = process.env.GITHUB_REPOSITORY || "";
  if (!token) throw new Error("GITHUB_TOKEN/GH_TOKEN is required for the live sweep");
  if (!slug.includes("/")) throw new Error("GITHUB_REPOSITORY must be owner/repo");
  const [owner, repoName] = slug.split("/");
  const baseBranch = process.env.MQ_BASE_BRANCH || "main";
  const lookbackHours = Number(process.env.MQ_LOOKBACK_HOURS || "24");
  const dryRun = process.env.MQ_DEQUEUE_DRY_RUN === "1";
  const webhook = process.env.DISCORD_WEBHOOK_URL || "";

  const override = Number(process.env.MQ_TIMEOUT_MINUTES || "");
  // The ambient Actions token has no `administration: read`, so the ruleset
  // read needs its own (optional) credential. Keeping it separate means the
  // sweep's bulk reads stay on the least-privileged token.
  const rulesetToken = process.env.MQ_RULESET_TOKEN || "";
  const timeoutMinutes = Number.isFinite(override) && override > 0
    ? override
    : await readQueueTimeoutMinutes(rulesetToken, owner, repoName, baseBranch);

  const since = Date.now() - lookbackHours * 3600_000;
  const prs = (
    await gh(token, `/repos/${owner}/${repoName}/pulls?state=open&base=${baseBranch}&sort=updated&direction=desc`, {
      paginate: true,
    })
  ).filter((pr) => !pr.draft && Date.parse(pr.updated_at) >= since);

  console.log(`sweeping ${prs.length} open non-draft PR(s) on ${baseBranch} updated in the last ${lookbackHours}h`);

  // One shared listing of recent merge_group runs: a per-PR query is not
  // possible (the queue branch name embeds a base SHA we do not know yet).
  const mergeGroupRuns = await gh(
    token,
    `/repos/${owner}/${repoName}/actions/runs?event=merge_group`,
    { paginate: true },
  );

  const findings = [];
  for (const pr of prs) {
    const timeline = await gh(token, `/repos/${owner}/${repoName}/issues/${pr.number}/timeline`, {
      paginate: true,
    });
    const hits = detectSilentDequeues({
      repo: slug,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.html_url,
      baseBranch,
      timeline,
      mergeGroupRuns,
      jobsByRunId: {},
      timeoutMinutes,
    });
    if (hits.length === 0) continue;
    const comments = await gh(token, `/repos/${owner}/${repoName}/issues/${pr.number}/comments`, {
      paginate: true,
    });
    for (const hit of hits) {
      if (alreadyAlerted(comments, hit.removedEventId, hit.removedAt)) {
        console.log(`#${pr.number}: dequeue ${hit.removedAt} already alerted — skipping`);
        continue;
      }
      // Enrich only what we are about to alert on. Jobs are the expensive call
      // and the only way to say "queued" (header note 3), so pay for it here
      // and nowhere else.
      const runs = runsForEpisode(mergeGroupRuns, baseBranch, pr.number, hit);
      const jobsByRunId = {};
      for (const run of runs) {
        try {
          const body = await gh(token, `/repos/${owner}/${repoName}/actions/runs/${run.id}/jobs`);
          jobsByRunId[String(run.id)] = body.jobs || [];
        } catch (err) {
          console.warn(`#${pr.number}: jobs for run ${run.id} unreadable (${err.message})`);
        }
      }
      hit.states = statesForEpisode(runs, jobsByRunId, hit.removedAt);
      Object.assign(hit, classifyDequeue({ dwellMs: hit.dwellMs, states: hit.states, timeoutMinutes }));
      findings.push(hit);
    }
  }

  if (findings.length === 0) {
    // Only reachable after every query above succeeded — `gh()` throws
    // otherwise. This line means "no dequeues", never "the query failed".
    console.log(`SWEPT ${prs.length} PR(s): 0 undetected silent dequeues.`);
    return 0;
  }

  let undelivered = 0;
  for (const f of findings) {
    const content = buildDequeueAlert(f);
    console.log(`\n--- finding: #${f.prNumber} dequeued after ${formatDwell(f.dwellMs)} (${f.cause}) ---`);
    console.log(content);
    if (dryRun) continue;

    // Discord first, marker second: a failed delivery must be retried next
    // tick, not swallowed by a dedupe marker we already wrote.
    if (!webhook) {
      console.error("::error::DISCORD_WEBHOOK_URL is unset — a silent dequeue was detected and could not be delivered.");
      undelivered += 1;
      continue;
    }
    const status = await postDiscord(webhook, content);
    if (status < 200 || status >= 300) {
      console.error(`::error::Discord POST failed (HTTP ${status}) for #${f.prNumber} — alert undelivered.`);
      undelivered += 1;
      continue;
    }
    console.log(`posted ops alert for #${f.prNumber} (HTTP ${status}).`);

    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/issues/${f.prNumber}/comments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "merge-queue-dequeue-watch",
          },
          body: JSON.stringify({ body: buildPrComment(f) }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`marked #${f.prNumber} (dedupe marker written).`);
    } catch (err) {
      // Non-fatal: the ops alert landed. Worst case is one duplicate next tick,
      // which is the right way round for a detector.
      console.warn(`#${f.prNumber}: dedupe marker not written (${err.message}) — may re-alert once.`);
    }
  }

  if (undelivered > 0) {
    console.error(`::error::${undelivered} of ${findings.length} dequeue alert(s) were NOT delivered.`);
    return 1;
  }
  return 0;
}

// --- CLI ---------------------------------------------------------------------
// `import.meta.main` is not on the Node 20 runner; compare resolved URLs so a
// relative, symlinked or `./scripts/...` invocation all still run the CLI.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  if (process.argv.includes("--verify-delivery")) {
    process.exit(await verifyDelivery(process.env.DISCORD_WEBHOOK_URL || ""));
  }
  if (process.argv.includes("--self-test")) {
    const { ok, problems, alert } = selfTest();
    if (!ok) {
      for (const p of problems) console.error(`::error::self-test: ${p}`);
      process.exit(1);
    }
    console.log("self-test: PR #814 replay produced exactly one alert ↓\n");
    console.log(alert);
    console.log("\nself-test: PASS (known-positive reproduced).");
    process.exit(0);
  }
  process.exit(await sweep());
}
