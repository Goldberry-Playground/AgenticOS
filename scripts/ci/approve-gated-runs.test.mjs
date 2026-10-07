#!/usr/bin/env node
/**
 * GOL-2940: behavioural test for scripts/ci/approve-gated-runs.mjs and for the
 * ci-autofix.yml wiring that calls it.
 *
 * Approving a workflow run is a security gate, so the cases below are mostly
 * about what the script must REFUSE to approve, and about the two ways a
 * self-healing step like this fails silently:
 *
 *  - it reports success when it actually found nothing (zero runs is NOT
 *    all-clear — it is the exact state that wedges the PR); and
 *  - the YAML stops calling it, or loses `actions: write`, and the unit tests
 *    keep passing while the live workflow no longer does anything. The wiring
 *    assertions read the real workflow file, so that drift reds this test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { approveGatedRuns } from "./approve-gated-runs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(HERE, "..", "..", ".github", "workflows", "ci-autofix.yml");
const SHA = "8348a064187ad301523a67b6994d2fcd5e2cd7fd";

let failures = 0;
const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

/**
 * A stub GitHub API. `listPages` is consumed one entry per list call, so a test
 * can model "runs do not exist yet, then they do".
 */
function stubApi({ listPages, approve = () => ({ status: 200 }), listStatus = 200 }) {
  const calls = { list: 0, approvals: [] };
  const pages = [...listPages];
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes("/approve")) {
      const id = url.match(/runs\/(\d+)\/approve/)[1];
      assert.equal(opts.method, "POST", "approval must be a POST");
      calls.approvals.push(id);
      const { status } = approve(id);
      return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
    }
    calls.list += 1;
    const page = pages.length > 1 ? pages.shift() : pages[0];
    return {
      ok: listStatus === 200,
      status: listStatus,
      json: async () => ({ workflow_runs: page }),
    };
  };
  return { fetchImpl, calls };
}

const run = (id, over = {}) => ({
  id,
  name: `run-${id}`,
  head_sha: SHA,
  event: "pull_request",
  status: "completed",
  conclusion: "action_required",
  ...over,
});

const call = (stub, over = {}) =>
  approveGatedRuns({
    repo: "Goldberry-Playground/AgenticOS",
    headSha: SHA,
    token: "t",
    fetchImpl: stub.fetchImpl,
    sleep: async () => {},
    log: () => {},
    attempts: 3,
    delayMs: 0,
    ...over,
  });

test("approves every gated pull_request run for the pushed sha", async () => {
  const stub = stubApi({ listPages: [[run(1), run(2)]] });
  const res = await call(stub);
  assert.deepEqual(stub.calls.approvals, ["1", "2"]);
  assert.deepEqual(res.approved, ["1", "2"]);
  assert.equal(res.clean, true);
  assert.equal(res.denied, false);
});

test("accepts `status: action_required` as well as `conclusion`", async () => {
  const stub = stubApi({ listPages: [[run(7, { status: "action_required", conclusion: null })]] });
  const res = await call(stub);
  assert.deepEqual(res.approved, ["7"]);
});

test("NEVER approves a run for a different sha, even if the API returns one", async () => {
  const stub = stubApi({ listPages: [[run(1, { head_sha: "deadbeef".repeat(5) }), run(2)]] });
  const res = await call(stub);
  assert.deepEqual(stub.calls.approvals, ["2"], "foreign sha must not be approved");
  assert.equal(res.found, 1);
});

test("NEVER approves a pull_request_target run (base-branch secrets)", async () => {
  const stub = stubApi({ listPages: [[run(1, { event: "pull_request_target" }), run(2)]] });
  await call(stub);
  assert.deepEqual(stub.calls.approvals, ["2"]);
});

test("does not approve runs that are already running", async () => {
  const stub = stubApi({ listPages: [[run(1, { status: "in_progress", conclusion: null })]] });
  const res = await call(stub);
  assert.deepEqual(stub.calls.approvals, []);
  assert.equal(res.found, 1);
  assert.equal(res.clean, true, "runs exist and none are gated — that IS all-clear");
});

test("zero runs after every attempt is NOT reported as all-clear", async () => {
  const stub = stubApi({ listPages: [[]] });
  const logs = [];
  const res = await call(stub, { log: (l) => logs.push(l) });
  assert.equal(res.found, 0);
  assert.equal(res.clean, false, "empty must never read as success (GOL-2940)");
  assert.equal(stub.calls.list, 3, "must exhaust its poll attempts before giving up");
  assert.ok(
    logs.some((l) => l.startsWith("::warning::")),
    "a never-appearing run must warn, not pass quietly",
  );
});

test("polls until the runs exist (the push/run-creation race)", async () => {
  const stub = stubApi({ listPages: [[], [run(5)]] });
  const res = await call(stub);
  assert.equal(stub.calls.list, 2);
  assert.deepEqual(res.approved, ["5"]);
});

test("403 on approve warns with the manual fallback and never throws", async () => {
  const stub = stubApi({ listPages: [[run(1)]], approve: () => ({ status: 403 }) });
  const logs = [];
  const res = await call(stub, { log: (l) => logs.push(l) });
  assert.equal(res.denied, true);
  assert.equal(res.clean, false);
  assert.deepEqual(res.stillGated, ["1"]);
  const warn = logs.find((l) => l.startsWith("::warning::"));
  assert.ok(warn, "a denied approval must warn");
  assert.ok(/actions:write/.test(warn), "the warning must name the missing permission");
  assert.ok(/Approve and run workflows/.test(warn), "the warning must name the manual fallback");
});

test("409 (already approved) counts as approved, not as a failure", async () => {
  const stub = stubApi({ listPages: [[run(1)]], approve: () => ({ status: 409 }) });
  const res = await call(stub);
  assert.deepEqual(res.approved, ["1"]);
  assert.equal(res.clean, true);
});

test("a failed run listing warns and reports not-clean", async () => {
  const stub = stubApi({ listPages: [[]], listStatus: 500 });
  const logs = [];
  const res = await call(stub, { log: (l) => logs.push(l) });
  assert.equal(res.clean, false);
  assert.ok(logs.some((l) => l.startsWith("::warning::")));
});

// --- wiring: the YAML must actually call this, with the permission it needs ---

test("ci-autofix.yml grants actions: write", async () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const perms = yml.slice(yml.indexOf("\npermissions:"), yml.indexOf("\nconcurrency:"));
  assert.ok(/^\s+actions: write$/m.test(perms), "the approval step is inert without actions: write");
});

test("ci-autofix.yml invokes the script with the sha the push step recorded", async () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  assert.ok(
    /run: node scripts\/ci\/approve-gated-runs\.mjs "\$GITHUB_REPOSITORY" "\$PUSHED_SHA"/.test(yml),
    "no step invokes approve-gated-runs.mjs",
  );
  assert.ok(
    /PUSHED_SHA: \$\{\{ steps\.push\.outputs\.pushed_sha \}\}/.test(yml),
    "the step must take its sha from the push step's output, never from github.sha",
  );
  assert.ok(
    /if: steps\.push\.outputs\.pushed_sha != ''/.test(yml),
    "the step must be gated on a sha this job actually pushed",
  );
  assert.ok(
    /echo "pushed_sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/.test(yml),
    "the push step must export pushed_sha",
  );
  assert.ok(
    /id: push\b/.test(yml),
    "the push step needs `id: push` for the output reference to resolve",
  );
});

test("pushed_sha is exported only AFTER a successful push", async () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const pushFail = yml.indexOf('::warning::Could not push the [ci-autofix] commit');
  const export_ = yml.indexOf('echo "pushed_sha=');
  assert.ok(pushFail !== -1 && export_ !== -1);
  assert.ok(
    export_ > pushFail,
    "pushed_sha must be set after the push-failure early return, or a read-only token would " +
      "still hand the approval step a sha that was never pushed",
  );
});

for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}
console.log(failures === 0 ? "approve-gated-runs: all pass" : `approve-gated-runs: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
