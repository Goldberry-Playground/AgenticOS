#!/usr/bin/env node
/**
 * GOL-2694: behavioural test for the ci-autofix.yml author/mode gate.
 *
 * The gate is a bash `case` inside a workflow, so it has never been executable
 * anywhere but on a runner. It slices the real `run:` block out of the YAML and
 * runs it, which is how this test caught the bug it now pins:
 *
 *   case "$AUTHOR" in
 *     agenticos-developer|agenticos-developer[bot]|...)
 *
 * Unquoted, `agenticos-developer[bot]` is a GLOB — `agenticos-developer`
 * followed by ONE character from the class {b,o,t}. It therefore never matched
 * the App bot's actual login, `agenticos-developer[bot]`, and since every agent
 * PR in this repo is authored by that bot, ci-autofix had been silently
 * skipping 100% of the PRs it exists to heal. Quoting the patterns fixes it;
 * these cases stop it regressing.
 *
 * Reading the live workflow rather than a copy is the point: a future edit to
 * the gate is tested automatically, and a rename of the step reds this test
 * instead of silently testing nothing.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "ci-autofix.yml");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

/** Slice the `run:` body of the step named `Gate (...)` out of the workflow. */
function extractGateScript() {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s*- name: Gate \(/.test(l));
  assert.notEqual(start, -1, "no step named 'Gate (…)' in ci-autofix.yml");
  const runAt = lines.findIndex((l, i) => i > start && /^\s*run: \|\s*$/.test(l));
  assert.notEqual(runAt, -1, "the Gate step has no 'run: |' block");
  const indent = lines[runAt + 1].match(/^\s*/)[0];
  const body = [];
  for (let i = runAt + 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== "" && !lines[i].startsWith(indent)) break;
    body.push(lines[i].slice(indent.length));
  }
  return body.join("\n");
}

const GATE = extractGateScript();

/**
 * Run the gate with a given PR author and head-commit subject.
 * @returns {Record<string,string>} the parsed $GITHUB_OUTPUT
 */
function runGate(author, headSubject = "feat: something") {
  const dir = mkdtempSync(join(tmpdir(), "ci-autofix-gate-"));
  try {
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("commit", "-q", "--allow-empty", "-m", headSubject);
    const out = join(dir, "gh_output");
    writeFileSync(out, "");
    writeFileSync(join(dir, "gate.sh"), GATE);
    execFileSync("bash", ["gate.sh"], {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, AUTHOR: author, GITHUB_OUTPUT: out },
    });
    return Object.fromEntries(
      readFileSync(out, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split("=")),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("ci-autofix gate — the author routing");

test("the App bot login 'agenticos-developer[bot]' proceeds in agent mode", () => {
  // The regression. Before GOL-2694 this fell through to the catch-all.
  assert.deepEqual(runGate("agenticos-developer[bot]"), { mode: "agent", proceed: "true" });
});

test("'dependabot[bot]' proceeds in deps mode", () => {
  assert.deepEqual(runGate("dependabot[bot]"), { mode: "deps", proceed: "true" });
});

test("agent and deps modes are disjoint", () => {
  // A dependency bump must never get `eslint --fix` / `vitest -u`, and an
  // agent PR must never get a full `pnpm -w build`; the steps key off `mode`.
  assert.notEqual(runGate("agenticos-developer[bot]").mode, runGate("dependabot[bot]").mode);
});

console.log("ci-autofix gate — negative controls (must NOT proceed)");

for (const author of ["octocat", "renovate[bot]", "agenticos-developert", "", "dependabot-preview[bot]"]) {
  test(`'${author}' is refused`, () => {
    const got = runGate(author);
    assert.equal(got.proceed, "false", `author '${author}' should not proceed`);
    assert.equal(got.mode, undefined, `author '${author}' should not set a mode`);
  });
}

console.log("ci-autofix gate — the loop guard");

test("a head commit already marked [ci-autofix] does not proceed", () => {
  const got = runGate("dependabot[bot]", "chore(deps): rebuild committed plugin dist [ci-autofix]");
  assert.equal(got.proceed, "false");
});

test("…but an ordinary head commit from the same author does", () => {
  // Negative control for the loop guard itself: without this, a guard that
  // refused everything would still pass the test above.
  assert.equal(runGate("dependabot[bot]", "chore(deps): bump zod").proceed, "true");
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
