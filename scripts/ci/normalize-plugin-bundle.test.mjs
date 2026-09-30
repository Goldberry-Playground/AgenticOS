#!/usr/bin/env node
/**
 * GOL-2694: behavioural test + live gate for the plugin-bundle normalizer.
 *
 * Part 1 pins the transform against synthetic fixtures, including a
 * reconstruction of the failure it exists to kill (GOL-2685: a pure patch bump
 * of `@paperclipai/plugin-sdk` rewrote 820 provenance-only comment lines and
 * red the stale-dist guard) and NEGATIVE CONTROLS proving the rewrite is
 * narrow enough not to touch code.
 *
 * Part 2 runs `--check` semantics against the real committed
 * `packages/*\/dist/**` bundles. That is the part that keeps main honest: add a
 * plugin whose `build` script forgets the normalize step and this job reds,
 * instead of the drift surfacing later as an unexplained `Build` failure on
 * somebody else's dependency bump.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBundle } from "../normalize-plugin-bundle.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES = join(REPO_ROOT, "packages");

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

console.log("normalizeBundle — rewrites");

test("a pnpm store path collapses to the package-relative path", () => {
  const src = "a();\n\n// ../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/util.js\nb();";
  assert.equal(
    normalizeBundle(src),
    "a();\n\n// node_modules/zod/v4/core/util.js\nb();",
  );
});

test("a scoped package keeps its scope, and the peer-hash suffix is dropped", () => {
  // The exact line from the bundles, including pnpm's `_react@19.3.0` peer
  // suffix — a react bump alone used to churn every worker through this line.
  const src =
    "\n// ../../node_modules/.pnpm/@paperclipai+plugin-sdk@2026.916.0_react@19.3.0" +
    "/node_modules/@paperclipai/plugin-sdk/dist/define-plugin.js\nx();";
  assert.equal(
    normalizeBundle(src),
    "\n// node_modules/@paperclipai/plugin-sdk/dist/define-plugin.js\nx();",
  );
});

test("GOL-2685: a version-only bump becomes a byte-identical bundle", () => {
  const at = (v) =>
    `\n// ../../node_modules/.pnpm/@paperclipai+plugin-sdk@${v}_react@19.3.0` +
    `/node_modules/@paperclipai/plugin-sdk/dist/define-plugin.js\nsame();`;
  assert.equal(normalizeBundle(at("2026.916.0")), normalizeBundle(at("2026.916.1")));
});

test("a real code change still moves the bundle (the guard must stay armed)", () => {
  const a = "\n// ../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/x.js\nold();";
  const b = "\n// ../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/x.js\nnew_();";
  assert.notEqual(normalizeBundle(a), normalizeBundle(b));
});

test("the transform is idempotent", () => {
  const src = "\n// ../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/util.js\nb();";
  const once = normalizeBundle(src);
  assert.equal(normalizeBundle(once), once);
});

console.log("normalizeBundle — negative controls (must NOT rewrite)");

test("a workspace-relative module comment is left alone", () => {
  // These paths carry no version, so they never churn — and rewriting them
  // would throw away the only signal that a chunk is first-party source.
  const src = "\n// ../shared/src/logger.ts\nb();";
  assert.equal(normalizeBundle(src), src);
});

test("a store path inside CODE is not a comment and is never touched", () => {
  const src = '\nconst p = "/app/node_modules/.pnpm/zod@4.6.5/node_modules/zod/x.js";\n';
  assert.equal(normalizeBundle(src), src);
});

test("a comment NOT preceded by a blank line is not a module boundary", () => {
  // Anchor 3. Without it, a `// …` line inside a template literal or a
  // hand-written comment block could be rewritten.
  const src = "a();\n// ../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/x.js\nb();";
  assert.equal(normalizeBundle(src), src);
});

test("a comment with trailing prose is not a module boundary", () => {
  const src = "\n// ../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/x.js is stale\nb();";
  assert.equal(normalizeBundle(src), src);
});

test("an empty bundle and a bundle with no store paths are unchanged", () => {
  assert.equal(normalizeBundle(""), "");
  assert.equal(normalizeBundle("\n// keep me\nx();\n"), "\n// keep me\nx();\n");
});

console.log("live gate — committed packages/*/dist bundles are normalized");

const bundles = [];
if (existsSync(PACKAGES)) {
  for (const pkg of readdirSync(PACKAGES)) {
    const dist = join(PACKAGES, pkg, "dist");
    if (!existsSync(dist)) continue;
    for (const f of readdirSync(dist)) {
      if (f.endsWith(".js")) bundles.push(join(dist, f));
    }
  }
}

test("at least one committed plugin bundle was found (the gate is live)", () => {
  // A path/rename refactor that stops finding the bundles would silently turn
  // the rest of this section into a no-op. Fail instead.
  assert.ok(bundles.length > 0, `no packages/*/dist/*.js found under ${PACKAGES}`);
});

for (const file of bundles) {
  const rel = file.slice(REPO_ROOT.length + 1);
  test(`${rel} carries no pnpm store paths`, () => {
    const text = readFileSync(file, "utf8");
    // Report the offending LINES, never a whole-file diff: these bundles are
    // 1.5 MB each and assert.equal would flood the job log with the entire
    // artifact, burying the one line that says what to do about it.
    const offenders = text
      .split("\n")
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line !== normalizeBundle(`\n${line}`).slice(1));
    assert.equal(
      offenders.length,
      0,
      `${rel} still embeds node_modules/.pnpm paths on ${offenders.length} line(s), ` +
        `e.g. ${offenders.slice(0, 3).map(([n, l]) => `L${n}: ${l.slice(0, 90)}`).join(" | ")}. ` +
        `Its package 'build' script is missing the ` +
        `'node ../../scripts/normalize-plugin-bundle.mjs' step, so every dependency ` +
        `bump will red the stale-dist guard for no reason (GOL-2694).`,
    );
  });
}

console.log(failures === 0 ? "\nall passed" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
