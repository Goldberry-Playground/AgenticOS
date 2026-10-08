#!/usr/bin/env node
// Behavioral tests for the maintainer-path approve decision (GOL-3225).
// Run: `node scripts/ci/maintainer-approve-gate.test.mjs`
//
// The AgenticOS#867 deadlock: a Josh-authored PR touching a protected path was
// withheld forever, because the only human who could approve it was its author.
// Now agent-review/* success on the current head clears it — and nothing else.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide } from "./maintainer-approve-gate.mjs";

const WF = [".github/workflows/deploy-paperclip-server.yml"]; // the #867 file
const DOCS = ["docs/pr-policy.md", "packages/dashboard/src/x.ts"];

// ── protected + agent-review not yet success => withhold, say what unblocks ──
for (const state of ["pending", "absent", "completed-not-success", "", undefined, "SUCCESS", "neutral"]) {
  const d = decide({ files: WF, reviewState: state });
  assert.equal(d.approve, false, `protected + review '${state}' must NOT approve`);
  assert.equal(d.protected, true);
  assert.match(d.reason, /waiting on agent-review\/ada/, "decline must name what unblocks it");
  assert.match(d.reason, /deploy-paperclip-server\.yml/, "decline must list the protected hit");
}

// ── protected + agent-review success => approve ─────────────────────────────
{
  const d = decide({ files: WF, reviewState: "success" });
  assert.equal(d.approve, true);
  assert.equal(d.protected, true);
}
// a mixed change set is still protected, still gated on the review
assert.equal(decide({ files: [...DOCS, ...WF], reviewState: "pending" }).approve, false);
assert.equal(decide({ files: [...DOCS, ...WF], reviewState: "success" }).approve, true);
// every carve-out glob routes through the same gate, not just workflows
assert.equal(decide({ files: ["scripts/ci/protected-paths-carveout.mjs"], reviewState: "pending" }).approve, false);
assert.equal(decide({ files: ["infra/terraform/github-branch-protection.tf"], reviewState: "absent" }).approve, false);

// ── unprotected => unchanged: approve regardless of agent-review state ──────
for (const state of ["pending", "absent", "success", undefined]) {
  const d = decide({ files: DOCS, reviewState: state });
  assert.equal(d.approve, true, `unprotected must approve (review '${state}')`);
  assert.equal(d.protected, false);
}

// ── CLI contract: exit code + reason on stdout, as auto-approve.yml uses it ──
const SCRIPT = fileURLToPath(new URL("./maintainer-approve-gate.mjs", import.meta.url));
function run(files, state) {
  const env = { ...process.env, PR_FILES: files.join("\n") };
  if (state === undefined) delete env.AGENT_REVIEW_STATE;
  else env.AGENT_REVIEW_STATE = state;
  try {
    return { code: 0, out: execFileSync("node", [SCRIPT], { env, encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: e.stdout };
  }
}
assert.equal(run(WF, "pending").code, 1);
assert.match(run(WF, "pending").out, /waiting on agent-review\/ada/);
assert.equal(run(WF, undefined).code, 1, "unset AGENT_REVIEW_STATE must fail closed");
assert.equal(run(WF, "success").code, 0);
assert.equal(run(DOCS, undefined).code, 0);

console.log("maintainer-approve-gate: all assertions passed");
