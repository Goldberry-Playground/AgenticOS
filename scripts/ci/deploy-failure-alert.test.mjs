#!/usr/bin/env node
// Behavioral tests for the out-of-band deploy-failure ops alert (GOL-2591).
// Run: `node scripts/ci/deploy-failure-alert.test.mjs`
//
// These are the invariants that make the alert worth having. The GOL-2585 outage
// was already *detected* by CI (run 35939085377 went red on its own hard gate and
// the router minted issue #710) and still ran five days, because the only delivery
// path led through the dead github-sync worker. So the thing under test is not
// "does it notice" — it is "does the message a human sees name the broken step and
// the error, and does a missing/oversized/degenerate input still produce something
// actionable instead of an empty ping".
import assert from "node:assert/strict";
import {
  extractFirstError,
  failingStepName,
  buildDeployAlert,
  DISCORD_CONTENT_LIMIT,
} from "./deploy-failure-alert.mjs";

// ── extractFirstError: the real log shape ───────────────────────────────────
// A downloaded Actions log renders `::error::` as `##[error]` behind an ISO
// timestamp. Matching only the literal `::error::` (which is what the workflow
// *author* writes) finds nothing in a real log — that regression would ship an
// alert with no error line at all, so pin it.
{
  const log = [
    "2026-09-24T00:35:17.1234567Z ok: vault-plugin",
    "2026-09-24T00:35:18.1234567Z ##[error]400 Missing package.json at /paperclip/plugins/github-sync-plugin",
    "2026-09-24T00:35:19.1234567Z ##[error]Process completed with exit code 1.",
  ].join("\n");
  assert.equal(
    extractFirstError(log),
    "400 Missing package.json at /paperclip/plugins/github-sync-plugin",
    "must read the ##[error] spelling, strip the timestamp, and take the FIRST one",
  );
}

// The `::error::` spelling must work too (annotations echoed verbatim).
assert.equal(extractFirstError("::error::boom happened"), "boom happened");

// Most of scripts/ fails as `echo FATAL ... >&2; exit 1`, which produces NO
// ::error:: annotation at all. Without this fallback those failures alert blind.
{
  const log = [
    "2026-08-05T12:00:00Z    github-sync-plugin: registry 0.11.3 != built 0.11.4",
    "2026-08-05T12:00:00Z FATAL: 2 plugin(s) did not converge",
  ].join("\n");
  assert.equal(extractFirstError(log), "FATAL: 2 plugin(s) did not converge");
}
assert.equal(extractFirstError("MISSING packages/github-sync-plugin/dist/worker.js"),
  "MISSING packages/github-sync-plugin/dist/worker.js");

// No error vocabulary, empty, or non-string → null (caller omits the line).
assert.equal(extractFirstError("everything is fine\nok: done"), null);
assert.equal(extractFirstError(""), null);
assert.equal(extractFirstError(undefined), null);
assert.equal(extractFirstError(null), null);

// One pathological line must not eat the Discord budget.
{
  const huge = `##[error]${"x".repeat(5000)}`;
  const got = extractFirstError(huge);
  assert.ok(got.length <= 300, `clamped, got ${got.length}`);
  assert.ok(got.endsWith("…"), "clamped lines are marked");
}

// ── failingStepName ────────────────────────────────────────────────────────
assert.equal(
  failingStepName([
    { name: "Configure SSH", conclusion: "success" },
    { name: "Assert plugins converged to the built version (GOL-804)", conclusion: "failure" },
    { name: "Confirm workers hot-reloaded", conclusion: "failure" },
  ]),
  "Assert plugins converged to the built version (GOL-804)",
  "the FIRST failed step is the cause; later ones are fallout",
);
// A job cancelled on timeout has no failed step — must not throw, must not lie.
assert.equal(failingStepName([{ name: "Deploy plugins", conclusion: "cancelled" }]), null);
assert.equal(failingStepName(undefined), null);
assert.equal(failingStepName([]), null);

// ── buildDeployAlert: the message a human reads at 00:35 ───────────────────
{
  const RUN = "https://github.com/Goldberry-Playground/AgenticOS/actions/runs/35939085377";
  const content = buildDeployAlert({
    workflow: "Deploy Droplet Plugins",
    branch: "main",
    sha: "c9262e4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    event: "push",
    runAttempt: 1,
    runUrl: RUN,
    failedJobs: [
      { name: "Deploy plugins", failingStep: "Assert plugins converged to the built version (GOL-804)" },
    ],
    firstError: "400 Missing package.json at /paperclip/plugins/github-sync-plugin",
  });
  // The four things the issue's success condition asks for.
  assert.ok(content.includes("Deploy Droplet Plugins"), "names the workflow");
  assert.ok(content.includes("Assert plugins converged"), "names the failing step");
  assert.ok(content.includes("Missing package.json"), "carries the first error line");
  // Last-line equality, not `.includes` — pins that the run link is the final,
  // unbroken line (and reads as a URL check to CodeQL rather than a substring
  // "sanitization", which js/incomplete-url-substring-sanitization flags).
  assert.equal(content.split("\n").at(-1), RUN, "links the run as the final line");
  assert.ok(content.includes("c9262e4") && !content.includes("c9262e4aaaa"), "sha is short-form");
}

// A run with no job detail must still be a usable alert, not a blank ping.
{
  const RUN = "https://example.test/run/1";
  const content = buildDeployAlert({
    workflow: "Recreate paperclip-server",
    runUrl: RUN,
  });
  assert.ok(content.includes("Recreate paperclip-server"));
  assert.ok(content.includes("no job-level detail"), "says so instead of rendering nothing");
  assert.equal(content.split("\n").at(-1), RUN);
}

// Called with nothing at all: still a message, still no crash.
assert.ok(buildDeployAlert().includes("unknown workflow"));
assert.ok(buildDeployAlert(null).length > 0);

// Backticks in the error must not break out of the inline code span.
{
  const content = buildDeployAlert({ firstError: "bad `cmd` here", runUrl: "u" });
  assert.ok(!/`bad `cmd` here`/.test(content), "backticks in the error are neutralised");
}

// ── Discord's 2000-char hard limit; the run URL must survive truncation ────
{
  const runUrl = "https://github.com/Goldberry-Playground/AgenticOS/actions/runs/99";
  const content = buildDeployAlert({
    workflow: "Deploy Droplet",
    runUrl,
    failedJobs: Array.from({ length: 200 }, (_, i) => ({
      name: `job-${i}`,
      failingStep: `step-${i}-${"y".repeat(40)}`,
    })),
  });
  assert.ok(
    content.length <= DISCORD_CONTENT_LIMIT,
    `Discord 400s over ${DISCORD_CONTENT_LIMIT}; got ${content.length}`,
  );
  assert.equal(
    content.split("\n").at(-1), runUrl,
    "the run link is the one thing never truncated away",
  );
  assert.ok(content.includes("(truncated)"), "truncation is disclosed");
}

console.log("deploy-failure-alert.test.mjs: all assertions passed");
