#!/usr/bin/env node
// Behavioral tests for the dashboard smoke probe.
// Run: `node scripts/ci/dashboard-smoke.test.mjs`
//
// Invariant: anything that would leave a user staring at a broken page must
// page; only a confirmed-good response (or a route on the tracked KNOWN_BROKEN
// list) may stay quiet.
import assert from "node:assert/strict";
import { classify, isAlerting, buildAlert, KNOWN_BROKEN, API_ROUTES } from "./dashboard-smoke.mjs";

const ok = (path, body = "{}", ms = 120) => ({ path, status: 200, ms, body });

// Plain success.
assert.equal(classify(ok("/memory")).verdict, "ok");

// The 2026-10-15..11-10 outage: vault routes 500.
assert.equal(classify({ path: "/api/vault/tree", status: 500, ms: 10_000, body: "" }).verdict, "fail");

// The 11-10 vault-server OOM: the dashboard's fetch dies, the browser waits.
assert.equal(classify({ path: "/api/vault/skills", status: null, ms: 20_000, error: "timeout 20000 ms" }).verdict, "fail");

// A 200 that hides a dead backend still pages.
assert.equal(classify(ok("/api/vault/stats", JSON.stringify({ pageCount: 0 }))).verdict, "fail");
assert.equal(classify(ok("/api/vault/stats", "<html>")).verdict, "fail");
assert.equal(classify(ok("/api/vault/stats", JSON.stringify({ pageCount: 172 }))).verdict, "ok");
assert.equal(
  classify(ok("/api/health/services", JSON.stringify({ services: [{ name: "Paperclip", ok: false, detail: "fetch failed" }] }))).verdict,
  "fail",
);
assert.equal(
  classify(ok("/api/health/services", JSON.stringify({ services: [{ name: "Paperclip", ok: true }] }))).verdict,
  "ok",
);

// A blind monitor is an outage of the monitor: Access login redirect → auth, which pages.
const auth = classify({ path: "/", status: 302, ms: 50, location: "https://goldberrygrove.cloudflareaccess.com/cdn-cgi/access/login/x" });
assert.equal(auth.verdict, "auth");
assert.equal(isAlerting(auth.verdict), true);
// …but an ordinary app redirect is not an auth failure.
assert.notEqual(classify({ path: "/", status: 307, ms: 50, location: "/runs" }).verdict, "auth");

// Known-broken routes report but stay quiet; a recovery is flagged so the list gets trimmed.
for (const path of Object.keys(KNOWN_BROKEN)) {
  assert.ok(API_ROUTES.includes(path), `${path} must stay in the sweep`);
  const r = classify({ path, status: 500, ms: 300, body: "" });
  assert.equal(r.verdict, "known");
  assert.equal(isAlerting(r.verdict), false);
  assert.match(classify(ok(path)).reason, /remove from KNOWN_BROKEN/);
}

// Slow is visible but does not page.
assert.equal(classify(ok("/api/lint", "{}", 9_000)).verdict, "slow");
assert.equal(isAlerting("slow"), false);

// The probe must never call a mutating route.
for (const p of API_ROUTES) assert.doesNotMatch(p, /commit|discard|promote|retry|trigger|revalidate/);

// Alert text names each failing path.
const msg = buildAlert([
  { path: "/api/vault/tree", verdict: "fail", reason: "HTTP 500" },
  { path: "/api/tasks", verdict: "known", reason: "x" },
  { path: "/", verdict: "auth", reason: "redirected" },
]);
assert.match(msg, /2 failing/);
assert.match(msg, /\/api\/vault\/tree/);
assert.doesNotMatch(msg, /\/api\/tasks/);

console.log("dashboard-smoke tests: all passed");
