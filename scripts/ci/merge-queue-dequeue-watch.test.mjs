#!/usr/bin/env node
// Behavioral tests for the silent merge-queue dequeue detector (GOL-3079).
// Run: `node scripts/ci/merge-queue-dequeue-watch.test.mjs`
//
// The thing under test is not "does it notice an event" — it is "does it notice
// the ONE case that cost us GOL-3051, and stay quiet on the benign one that
// looks identical". So the centrepiece is a replay of PR #814's real captured
// timeline (scripts/ci/fixtures/pr-814-merge-queue-dequeue.json), which happens
// to carry both:
//
//   episode 1  added 20:37:27Z → removed 21:09:17Z  (31m50s)  no merge → SILENT
//   episode 2  added 23:26:11Z → removed 23:29:21Z  (3m10s)   merged 23:29:22Z → benign
//
// That single PR is therefore both the known-positive and the known-negative,
// and the "exactly one alert" assertion below is the Done-when from the ticket.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  queueEpisodes,
  formatDwell,
  checkStateAtRemoval,
  classifyDequeue,
  buildDequeueAlert,
  buildPrComment,
  alertMarker,
  alreadyAlerted,
  runsForEpisode,
  detectSilentDequeues,
  selfTest,
  FIXTURE_814,
  DISCORD_CONTENT_LIMIT,
} from "./merge-queue-dequeue-watch.mjs";

const fx = JSON.parse(readFileSync(FIXTURE_814, "utf8"));

// ── formatDwell: the number IS the alert ────────────────────────────────────
// "PR #814 was dequeued" is not actionable; "dequeued after 31m50s with CI
// still queued" is. Rounding the dwell destroys the only datum that lets a
// human tell a timeout from a check failure, so pin the exact rendering.
assert.equal(formatDwell(1_910_000), "31m50s", "31m50s is the GOL-3051 signature");
assert.equal(formatDwell(190_000), "3m10s");
assert.equal(formatDwell(45_000), "45s");
assert.equal(formatDwell(3_600_000), "1h00m00s");
assert.equal(formatDwell(5_430_000), "1h30m30s");
assert.equal(formatDwell(null), "unknown", "never render a missing dwell as 0s");
assert.equal(formatDwell(-5), "unknown");

// ── queueEpisodes: the rule in the ticket is WRONG, and this is the proof ───
// The ticket specifies "a `removed_` with no later `added_to_merge_queue` and
// no `merged` event". #814 has BOTH a later add and a later merge, so that rule
// reports zero findings on the canonical case. Episodes must be judged in their
// own window. If this assertion ever flips to 0 findings, the detector has
// regressed to the naive rule and is blind to the thing it exists to catch.
{
  const eps = queueEpisodes(fx.timeline);
  assert.equal(eps.length, 2, "#814 has exactly two queue episodes");

  assert.equal(eps[0].addedAt, "2026-10-05T20:37:27Z");
  assert.equal(eps[0].removedAt, "2026-10-05T21:09:17Z");
  assert.equal(eps[0].dwellMs, 1_910_000);
  assert.equal(eps[0].silent, true, "episode 1 is the silent dequeue — a LATER merge must not excuse it");
  assert.equal(eps[0].resolvedBy, null);

  assert.equal(eps[1].removedAt, "2026-10-05T23:29:21Z");
  assert.equal(eps[1].silent, false, "episode 2 merged 1s after the removal — benign, must not alert");
  assert.equal(eps[1].resolvedBy, "merged");
}

// A clean PR that merged on its first pass produces no episode findings at all.
{
  const eps = queueEpisodes([
    { id: 1, event: "added_to_merge_queue", created_at: "2026-10-05T10:00:00Z" },
    { id: 2, event: "removed_from_merge_queue", created_at: "2026-10-05T10:04:00Z" },
    { id: 3, event: "merged", created_at: "2026-10-05T10:04:01Z" },
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].silent, false, "a clean PR produces none — the other half of the Done-when");
}

// A PR sitting IN the queue right now is not a finding. Alerting on it would
// fire ~15 min into every single merge and train everyone to ignore the channel.
{
  const eps = queueEpisodes([
    { id: 1, event: "added_to_merge_queue", created_at: "2026-10-05T10:00:00Z" },
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].open, true);
  assert.equal(eps[0].silent, false, "still enqueued is not yet a dequeue");
}

// Event-ordering jitter: GitHub does not guarantee `removed_` sorts before the
// `merged` it precedes, and the two can share a second. A merge recorded one
// second BEFORE the removal is still a merge, not a silent drop.
{
  const eps = queueEpisodes([
    { id: 1, event: "added_to_merge_queue", created_at: "2026-10-05T10:00:00Z" },
    { id: 9, event: "merged", created_at: "2026-10-05T10:03:59Z" },
    { id: 2, event: "removed_from_merge_queue", created_at: "2026-10-05T10:04:00Z" },
  ]);
  assert.equal(eps[0].silent, false, "a merge within the tolerance window resolves the episode");
}

// A removal whose `added_` fell off an earlier timeline page still reports,
// with an unknown dwell. Dropping it would make the detector go quiet on
// precisely the long, busy PRs where pagination bites.
{
  const eps = queueEpisodes([
    { id: 2, event: "removed_from_merge_queue", created_at: "2026-10-05T10:04:00Z" },
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].silent, true);
  assert.equal(eps[0].dwellMs, null);
  assert.equal(eps[0].incomplete, true);
}

// Non-queue timeline noise (#814 has 13 other events) must not shift anything.
{
  const noisy = [
    { id: 1, event: "added_to_merge_queue", created_at: "2026-10-05T10:00:00Z" },
    { id: 5, event: "cross-referenced", created_at: "2026-10-05T10:01:00Z" },
    { id: 6, event: "commented", created_at: "2026-10-05T10:02:00Z" },
    { id: 7, event: "committed", created_at: null }, // `committed` carries no created_at at all
    { id: 2, event: "removed_from_merge_queue", created_at: "2026-10-05T10:40:00Z" },
  ];
  const eps = queueEpisodes(noisy);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].silent, true);
  assert.equal(formatDwell(eps[0].dwellMs), "40m00s");
}

// ── checkStateAtRemoval: "as of the removal", never "as of now" ─────────────
// This is the misattribution trap. #814's CodeQL and E2E runs read `failure`
// TODAY, but both concluded at 21:33Z — 24 minutes AFTER the 21:09:17Z dequeue.
// A detector that reads current conclusions blames CodeQL for a drop it did not
// cause, and the operator "fixes" CodeQL instead of the runner queue.
{
  const removedAt = "2026-10-05T21:09:17Z";
  const codeql = fx.mergeGroupRuns.find(
    (r) => r.name === "CodeQL" && r.created_at === "2026-10-05T20:37:45Z",
  );
  assert.equal(codeql.conclusion, "failure", "fixture precondition: CodeQL reads failure today");
  const st = checkStateAtRemoval(codeql, fx.jobsByRunId[String(codeql.id)], removedAt);
  assert.notEqual(st.state, "failure", "must NOT report a conclusion reached after the dequeue");
  assert.equal(st.state, "queued");
}

// The job-level truth that makes the alert worth reading: CI's jobs were
// created at 20:37:46Z and did not start until 21:26:49Z — 49 minutes waiting
// for a hosted runner, so at 21:09:17Z every one of them was still `queued`.
// Run-level data cannot express this; only jobs can.
{
  const ci = fx.mergeGroupRuns.find(
    (r) => r.name === "CI" && r.created_at === "2026-10-05T20:37:45Z",
  );
  const st = checkStateAtRemoval(ci, fx.jobsByRunId[String(ci.id)], "2026-10-05T21:09:17Z");
  assert.equal(st.state, "queued");
  assert.match(st.detail, /0\/3 jobs had started/, "names how many jobs never got a runner");
}

// A `skipped` job reports started_at == created_at == completed_at and never
// touched a runner. Counting it as "started" turned #814's `Required-checks
// audit` — whose real job waited 54 minutes — into "running", i.e. understated
// the starvation. Skipped jobs must not vote.
{
  const audit = fx.mergeGroupRuns.find(
    (r) => r.name === "Required-checks audit" && r.created_at === "2026-10-05T20:37:45Z",
  );
  const jobs = fx.jobsByRunId[String(audit.id)];
  assert.ok(jobs.some((j) => j.conclusion === "skipped"), "fixture precondition: one skipped job");
  const st = checkStateAtRemoval(audit, jobs, "2026-10-05T21:09:17Z");
  assert.equal(st.state, "queued", "a skipped job must not make a starved check look like it ran");
}

// A genuine pre-dequeue failure IS reported as a failure — this is the class of
// dequeue the GOL-3051 timeout fix does not cover, and it must stay visible.
{
  const run = { id: 1, name: "CI", created_at: "2026-10-05T10:00:00Z", status: "completed", conclusion: "failure", updated_at: "2026-10-05T10:20:00Z" };
  const jobs = [
    { name: "Unit tests", status: "completed", conclusion: "failure", created_at: "2026-10-05T10:00:01Z", started_at: "2026-10-05T10:00:30Z", completed_at: "2026-10-05T10:05:00Z" },
  ];
  const st = checkStateAtRemoval(run, jobs, "2026-10-05T10:10:00Z");
  assert.equal(st.state, "failure");
  assert.match(st.detail, /Unit tests failed before the dequeue/);
}

// A run created after the removal belongs to a later episode, not this one.
{
  const st = checkStateAtRemoval(
    { name: "CI", created_at: "2026-10-05T23:26:30Z", status: "completed", conclusion: "success" },
    [],
    "2026-10-05T21:09:17Z",
  );
  assert.equal(st.state, "not-started");
}

// ── classifyDequeue: never a confident wrong cause ─────────────────────────
{
  const pending = [{ name: "CI", state: "queued" }, { name: "E2E", state: "queued" }];
  const t = classifyDequeue({ dwellMs: 1_910_000, states: pending, timeoutMinutes: 30 });
  assert.equal(t.cause, "timeout");
  assert.match(t.headline, /check_response_timeout \(30m\)/);
  assert.match(t.headline, /runner wait, not a code failure/);

  // A real check failure outranks the clock, even past the timeout: the
  // operator needs to fix the check, not raise the window.
  const f = classifyDequeue({
    dwellMs: 1_910_000,
    states: [...pending, { name: "CodeQL", state: "failure" }],
    timeoutMinutes: 30,
  });
  assert.equal(f.cause, "check-failure");
  assert.match(f.headline, /CodeQL/);

  // With the timeout raised to 90m (GOL-3051's applied fix), the same 31m50s
  // dwell is NOT a timeout — it is a conflict / sibling failure / manual
  // removal, and must not be mislabelled.
  const u = classifyDequeue({ dwellMs: 1_910_000, states: pending, timeoutMinutes: 90 });
  assert.equal(u.cause, "unknown");
  assert.match(u.headline, /base-branch conflict|sibling|manual removal/);

  // Unknown timeout (no ruleset read scope) → honest unknown, never a guess.
  const n = classifyDequeue({ dwellMs: 1_910_000, states: pending, timeoutMinutes: null });
  assert.equal(n.cause, "unknown");
}

// ── runsForEpisode: branch name alone is not enough ────────────────────────
// Both of #814's episodes share the SAME queue branch (same base SHA), so
// filtering on the branch mixes the silent drop's starved runs with the later
// successful ones and the alert reads "everything was green".
{
  const eps = queueEpisodes(fx.timeline);
  const r1 = runsForEpisode(fx.mergeGroupRuns, "main", 814, eps[0]);
  const r2 = runsForEpisode(fx.mergeGroupRuns, "main", 814, eps[1]);
  assert.equal(r1.length, 9, "episode 1 has its own nine merge_group runs");
  assert.equal(r2.length, 9);
  assert.equal(
    new Set([...r1, ...r2].map((r) => r.head_branch)).size,
    1,
    "…and the branch name cannot tell them apart — the window has to",
  );
  assert.ok(r1.every((r) => r.created_at.startsWith("2026-10-05T20:37")));
}

// ── the Done-when, end to end ──────────────────────────────────────────────
{
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
  assert.equal(findings.length, 1, "exactly one alert for PR #814");
  const f = findings[0];
  assert.equal(formatDwell(f.dwellMs), "31m50s");
  assert.equal(f.cause, "timeout");
  assert.equal(f.states.find((s) => s.name === "CI").state, "queued");
  assert.ok(
    f.states.every((s) => s.state === "queued"),
    "all nine checks were starved — the alert should say total runner starvation",
  );

  const alert = buildDequeueAlert(f);
  assert.ok(alert.includes("31m50s"), "the alert names the dwell");
  assert.ok(/CI — \*\*queued\*\*/.test(alert), "the alert names CI as queued");
  assert.ok(alert.includes("#814"));
  assert.ok(alert.includes("Do not just re-enqueue"), "the alert carries the instruction that breaks the loop");
  assert.equal(alert.split("\n").at(-1), f.prUrl, "the PR link is the last line");
  assert.ok(alert.length <= DISCORD_CONTENT_LIMIT, `got ${alert.length} chars`);
}

// `selfTest()` is what the workflow runs as a preflight, so that a broken
// detector or a missing fixture goes RED instead of reporting all-clear (the
// `gh ... | grep || echo none` false-all-clear trap). Pin that it passes AND
// that it is capable of failing.
{
  const r = selfTest();
  assert.equal(r.ok, true, `self-test must pass: ${r.problems.join("; ")}`);
  assert.equal(r.findings.length, 1);

  let threw = false;
  try {
    selfTest("/nonexistent/fixture.json");
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "a missing fixture must THROW, never report a quiet pass");
}

// ── Discord's hard 2000-char limit; the link survives ──────────────────────
{
  const f = {
    repo: "Goldberry-Playground/AgenticOS",
    prNumber: 999,
    prTitle: "t".repeat(400),
    prUrl: "https://github.com/Goldberry-Playground/AgenticOS/pull/999",
    addedAt: "2026-10-05T10:00:00Z",
    removedAt: "2026-10-05T10:40:00Z",
    dwellMs: 2_400_000,
    headline: "h".repeat(500),
    states: Array.from({ length: 60 }, (_, i) => ({
      name: `check-${i}-${"n".repeat(30)}`,
      state: "queued",
      detail: "0/4 jobs had started — waiting for a runner",
    })),
  };
  const content = buildDequeueAlert(f);
  assert.ok(content.length <= DISCORD_CONTENT_LIMIT, `Discord 400s over the limit; got ${content.length}`);
  assert.equal(content.split("\n").at(-1), f.prUrl, "the PR link is never truncated away");
  assert.ok(content.includes("(truncated)"), "truncation is disclosed");
}

// ── dedupe: keyed on the removal EVENT, not the PR ─────────────────────────
// A PR dropped twice must alert twice — the second drop is the evidence that
// the re-enqueue loop is actually running. Keying on the PR number would hide
// exactly that.
{
  const m1 = alertMarker(32545045960, "2026-10-05T21:09:17Z");
  const m2 = alertMarker(32553427691, "2026-10-05T23:29:21Z");
  assert.notEqual(m1, m2, "two drops on one PR get two distinct markers");
  assert.match(m1, /^<!-- mq-dequeue-watch:32545045960 -->$/);

  const comments = [{ body: "lgtm" }, { body: `some text\n${m1}` }];
  assert.equal(alreadyAlerted(comments, 32545045960, "2026-10-05T21:09:17Z"), true, "no re-alert every 15 min");
  assert.equal(alreadyAlerted(comments, 32553427691, "2026-10-05T23:29:21Z"), false, "a NEW drop still alerts");
  assert.equal(alreadyAlerted([], 32545045960, "x"), false);
  assert.equal(alreadyAlerted([{ body: null }, null], 32545045960, "x"), false, "malformed comments are survivable");

  // Fallback key when the timeline event carries no id.
  assert.match(alertMarker(null, "2026-10-05T21:09:17Z"), /mq-dequeue-watch:t:2026-10-05T21:09:17Z/);
}

// The sticky PR comment must carry the marker (it IS the dedupe store) and the
// facts, so the next agent to open the PR sees why it is not merged.
{
  const f = selfTest().findings[0];
  const body = buildPrComment(f);
  assert.ok(body.includes(alertMarker(f.removedEventId, f.removedAt)), "marker present or we re-alert forever");
  assert.ok(body.includes("31m50s"));
  assert.ok(/CI — \*\*queued\*\*/.test(body));
  assert.ok(body.includes("Do not just re-enqueue"));
}

console.log("merge-queue-dequeue-watch.test.mjs: all assertions passed");
