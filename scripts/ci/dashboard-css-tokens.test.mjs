#!/usr/bin/env node
/**
 * GOL-2650: behavioural test + live gate for the undefined-token guard.
 *
 * Part 1 pins the collector semantics against synthetic fixtures, including a
 * reconstruction of the original bug (`border-color: var(--border)` where only
 * `--border-brand` exists) so a future refactor cannot silently stop catching it.
 *
 * Part 2 runs the guard against the real apps/dashboard tree. That is the part
 * that keeps main honest: a new `var(--typo)` reds this job.
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditDirectory, collectDefinitions, collectReferences, stripComments } from "./dashboard-css-tokens.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DASHBOARD = join(REPO_ROOT, "apps", "dashboard");

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

console.log("stripComments");

test("a commented-out declaration is NOT a definition", () => {
  // The blind spot this closes: retiring a token by commenting it out used to
  // register --border as defined, so every live var(--border) went unflagged.
  assert.equal(collectDefinitions("/* --border: #2e2925; retired */").has("--border"), false);
  assert.equal(collectDefinitions("// borderColor: \"var(--border)\",").has("--border"), false);
});

test("a commented-out reference is NOT a live reference", () => {
  assert.deepEqual(collectReferences("/* borderColor: var(--border) */"), []);
});

test("keeps line numbers stable while blanking comments", () => {
  const src = '/* line one\n   line two */\n.x { color: var(--nope); }';
  assert.deepEqual(collectReferences(src), [{ name: "--nope", line: 3 }]);
});

test("does not mistake a URL or a quoted path for a line comment", () => {
  // CSS has no `//` comment; eating one would blank real declarations and red
  // CI on a false positive, which is worse than the hole it closes.
  assert.ok(stripComments("background: url(https://cdn/x.png); --a: 1;").includes("--a: 1"));
  assert.ok(collectDefinitions('a { background: url("//cdn/x.png"); --b: 2; }').has("--b"));
});

console.log("collectDefinitions");

test("picks up CSS declarations", () => {
  const defs = collectDefinitions(":root {\n  --border-brand: #2e2925;\n  --text: #f0ebe4;\n}");
  assert.ok(defs.has("--border-brand"));
  assert.ok(defs.has("--text"));
});

test("picks up inline style-object keys", () => {
  const defs = collectDefinitions('style={{ "--normal-bg": "var(--surface-elevated)" }}');
  assert.ok(defs.has("--normal-bg"));
});

test("picks up next/font variable declarations", () => {
  const defs = collectDefinitions('const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });');
  assert.ok(defs.has("--font-inter"), "next/font-injected names must count as defined");
});

test("a var() reference is not itself a definition", () => {
  // `--surface-elevated` is only *read* here; reading must not vouch for it.
  assert.ok(!collectDefinitions("border-color: var(--surface-elevated);").has("--surface-elevated"));
});

console.log("collectReferences");

test("reports fallback-less references with line numbers", () => {
  const refs = collectReferences("a {\n  color: red;\n}\nb {\n  border-color: var(--border);\n}");
  assert.deepEqual(refs, [{ name: "--border", line: 5 }]);
});

test("ignores references that carry a fallback", () => {
  // An explicit fallback is the author declaring the name may be absent.
  assert.deepEqual(collectReferences("font-family: var(--font-jetbrains-mono, monospace);"), []);
});

test("tolerates whitespace inside var()", () => {
  assert.deepEqual(collectReferences("color: var( --text );"), [{ name: "--text", line: 1 }]);
});

console.log("auditDirectory");

test("reproduces GOL-2650: var(--border) against a --border-brand-only scale", () => {
  // The exact shape of the shipped bug: the scale is named, the bare name is not.
  const defined = collectDefinitions("--border-brand: #2e2925; --border-subtle: #201d1a;");
  const [ref] = collectReferences('style={{ borderColor: "var(--border)" }}');
  assert.equal(ref.name, "--border");
  assert.ok(!defined.has("--border"), "--border must read as undefined against the named scale");
});

test("apps/dashboard has zero undefined custom-property references", () => {
  const { files, undefinedRefs } = auditDirectory(DASHBOARD);
  assert.ok(files > 50, `expected to walk the dashboard tree, saw ${files} files`);
  assert.deepEqual(
    undefinedRefs,
    [],
    `undefined token reference(s):\n${undefinedRefs.map((r) => `  ${r.file}:${r.line} ${r.name}`).join("\n")}`
  );
});

if (failures > 0) {
  console.error(`\n✗ ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ dashboard-css-tokens: all checks passed");
