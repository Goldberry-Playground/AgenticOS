#!/usr/bin/env node
// Behavioral tests for the github-sync worker heartbeat tripwire (GOL-2591 item 3).
// Run: `node scripts/ci/github-sync-heartbeat-probe.test.mjs`
//
// The invariant that matters is asymmetric: a MISSED outage costs five days of
// un-reviewed PRs (GOL-2585), while a FALSE page costs credibility and trains
// everyone to ignore the next real one. So every ambiguous input must resolve to
// "alert and say why", and only a confirmed-fresh timestamp may resolve to ok.
import assert from "node:assert/strict";
import {
  parseReading,
  evaluateHeartbeat,
  isAlerting,
  buildHeartbeatAlert,
  DEFAULT_STALE_MINUTES,
} from "./github-sync-heartbeat-probe.mjs";

const NOW = Date.parse("2026-09-29T21:15:00.000Z");
const at = (iso) => `HEARTBEAT ok ${iso} 2026-09-29T20:44:31.476Z 0.16.9`;

// ── parseReading: the on-box contract ──────────────────────────────────────
assert.deepEqual(parseReading(at("2026-09-29T21:10:00.000Z")), {
  kind: "ok",
  updatedAt: "2026-09-29T21:10:00.000Z",
  workerBootedAt: "2026-09-29T20:44:31.476Z",
  workerVersion: "0.16.9",
});
assert.equal(parseReading("HEARTBEAT no_table").kind, "no_table");
assert.equal(parseReading("HEARTBEAT missing").kind, "missing");
{
  const r = parseReading("HEARTBEAT unreadable psql-rc2:could not connect");
  assert.equal(r.kind, "unreadable");
  assert.equal(r.detail, "psql-rc2:could not connect");
}
// SSH prepends banners/warnings; the reading is the LAST HEARTBEAT line, and
// surrounding noise must not make a healthy box look broken (or vice versa).
assert.equal(
  parseReading(`Warning: Permanently added host\n${at("2026-09-29T21:10:00.000Z")}\n`).kind,
  "ok",
);
// Anything unrecognised is NEVER silently healthy.
for (const bad of ["", "   ", undefined, null, "totally unexpected output", "HEARTBEAT ok"]) {
  assert.equal(parseReading(bad).kind, "unparseable", `must not trust: ${JSON.stringify(bad)}`);
}

// ── evaluateHeartbeat: fresh vs stale ──────────────────────────────────────
{
  const r = evaluateHeartbeat(parseReading(at("2026-09-29T21:10:00.000Z")), { now: NOW });
  assert.equal(r.verdict, "ok");
  assert.equal(r.ageSeconds, 300);
  assert.equal(isAlerting(r.verdict), false);
}
// The measured-real case: on 2026-09-29 the row was 20 min old while the worker
// was demonstrably alive (webhook deliveries still landing). The plugin's own
// 15-min threshold calls that dead; ours must NOT — that is the false page.
{
  const r = evaluateHeartbeat(parseReading(at("2026-09-29T20:55:21.088Z")), { now: NOW });
  assert.equal(r.verdict, "ok", "20 min must stay OK at the 90-min default");
}
// Just under / just over the boundary.
assert.equal(
  evaluateHeartbeat(parseReading(at("2026-09-29T19:46:00.000Z")), { now: NOW }).verdict,
  "ok",
  "89 min is under the 90-min threshold",
);
{
  const r = evaluateHeartbeat(parseReading(at("2026-09-29T19:44:00.000Z")), { now: NOW });
  assert.equal(r.verdict, "stale", "91 min is over the threshold");
  assert.equal(isAlerting(r.verdict), true);
  // A stale row has TWO causes and the page must name both, or the responder
  // wastes the outage chasing a worker that is actually running.
  assert.match(r.message, /worker is dead/i);
  assert.match(r.message, /worker-heartbeat.*paused|paused.*worker-heartbeat/is);
  assert.match(r.message, /0\.16\.9/, "names the manifest version that owns the job");
}
// The GOL-2585 shape: five days of silence.
{
  const r = evaluateHeartbeat(parseReading(at("2026-09-24T00:35:19.000Z")), { now: NOW });
  assert.equal(r.verdict, "stale");
  assert.ok(r.ageSeconds > 5 * 24 * 3600 - 3600);
}
assert.equal(DEFAULT_STALE_MINUTES, 90);
// Threshold is injectable (the workflow's dispatch self-test drives it to 0).
assert.equal(
  evaluateHeartbeat(parseReading(at("2026-09-29T21:14:59.000Z")), { now: NOW, staleMinutes: 0 }).verdict,
  "stale",
);

// Clock skew: a heartbeat "from the future" is not extra-fresh, and must not
// produce a negative age that could underflow a comparison.
{
  const r = evaluateHeartbeat(parseReading(at("2026-09-29T23:00:00.000Z")), { now: NOW });
  assert.equal(r.verdict, "ok");
  assert.equal(r.ageSeconds, 0, "future timestamps clamp to age 0, never negative");
}
// A garbage timestamp is unparseable, not fresh.
assert.equal(
  evaluateHeartbeat(parseReading("HEARTBEAT ok not-a-date 2026-09-29T20:44:31Z 0.16.9"), { now: NOW }).verdict,
  "unparseable",
);

// ── The disarmed verdicts all alert and all explain themselves ─────────────
for (const [line, verdict, needle] of [
  ["HEARTBEAT missing", "missing", /never stamped/i],
  ["HEARTBEAT no_table", "no_table", /migration 007/i],
  ["HEARTBEAT unreadable psql-rc1:boom", "unreadable", /psql-rc1:boom/],
  ["garbage", "unparseable", /unrecognised/i],
]) {
  const r = evaluateHeartbeat(parseReading(line), { now: NOW });
  assert.equal(r.verdict, verdict, line);
  assert.equal(isAlerting(r.verdict), true, `${line} must page`);
  assert.match(r.message, needle, line);
}

// ── The page itself ────────────────────────────────────────────────────────
{
  const r = evaluateHeartbeat(parseReading(at("2026-09-24T00:35:19.000Z")), { now: NOW });
  const content = buildHeartbeatAlert(r, { runUrl: "https://example.test/run/7" });
  assert.match(content, /STALE/);
  assert.ok(content.includes("https://example.test/run/7"), "links the run");
  assert.match(content, /agent-review/, "says what breaks downstream");
  assert.match(content, /runbook/i, "points at the runbook");
  assert.ok(content.length <= 2000, "Discord rejects a body over 2000 chars");
}
// No run URL (hand-run) must still produce a valid page, not a trailing blank.
assert.ok(!buildHeartbeatAlert(evaluateHeartbeat(parseReading("HEARTBEAT missing"))).endsWith("\n"));

console.log("github-sync-heartbeat-probe.test.mjs: all assertions passed");
