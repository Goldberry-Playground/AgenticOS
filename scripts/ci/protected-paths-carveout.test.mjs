#!/usr/bin/env node
// Behavioral + invariant tests for the Tier-0 auto-approve carve-out
// (GOL-1406-A). Run: `node scripts/ci/protected-paths-carveout.test.mjs`
//
// The load-bearing assertion is CARVE-OUT ≡ GUARD: the carve-out's
// PROTECTED_GLOBS and its glob→RegExp matcher must be identical to the
// protected-paths-guard.yml the merge gate runs. If they drift, auto-approve
// could stamp a PR the guard would block (or vice-versa) — the exact hole this
// item closes. Both are generated from scripts/ci/gen-protected-paths-guard.py,
// and this test fails CI if a hand-edit desyncs them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { protectedHits, globToRe, PROTECTED_GLOBS } from './protected-paths-carveout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  join(here, '..', '..', '.github', 'workflows', 'protected-paths-guard.yml'),
  'utf8'
);

// ── Invariant 1: same PROTECTED_GLOBS as the guard ──────────────────────────
// Extract the guard's `const PROTECTED_GLOBS = [ … ];` string literals.
function guardGlobs(src) {
  const start = src.indexOf('const PROTECTED_GLOBS = [');
  assert.ok(start !== -1, "guard has no PROTECTED_GLOBS");
  const end = src.indexOf('];', start);
  const block = src.slice(start, end);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
assert.deepEqual(
  PROTECTED_GLOBS,
  guardGlobs(workflow),
  'carve-out PROTECTED_GLOBS drifted from the guard — regenerate from the generator'
);

// ── Invariant 2: identical glob→RegExp matcher as the guard ─────────────────
// Compile the guard's globToRe out of the shipped workflow and compare the
// RegExp source it produces for every glob against the carve-out's matcher.
function guardGlobToReSource(src) {
  const marker = 'function globToRe(g) {';
  const i = src.indexOf(marker);
  assert.ok(i !== -1, 'guard has no globToRe');
  const j = src.indexOf('return new RegExp(re + ', i);
  const k = src.indexOf('}', j);
  const bodyRaw = src.slice(i + marker.length, k);
  const body = bodyRaw.split('\n').map((l) => l.trim()).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('g', body + '\nreturn new RegExp(re + "$");');
}
const guardGlobToRe = guardGlobToReSource(workflow);
for (const g of [
  '.github/workflows/**',
  'infra/terraform/github-*.tf',
  'packages/github-sync-plugin/**/manifest*',
  'a/b/c.ts',
  '*.md',
]) {
  assert.equal(
    globToRe(g).source,
    guardGlobToRe(g).source,
    `globToRe drift for '${g}'`
  );
}

// ── Behavioral matrix ───────────────────────────────────────────────────────
// AC2: only non-protected paths -> no hits (auto-approve proceeds).
assert.deepEqual(protectedHits(['README.md', 'apps/hub/page.tsx']), []);
// AC1: a protected path -> a hit (auto-approve withholds).
assert.deepEqual(
  protectedHits(['README.md', '.github/workflows/ci.yml']),
  ['.github/workflows/ci.yml']
);
// `**` matches nested and root; `*` does not cross `/`.
assert.deepEqual(protectedHits(['.github/workflows/nested/x.yml']), [
  '.github/workflows/nested/x.yml',
]);
// Blank / whitespace lines from `gh` output are ignored, not treated as hits.
assert.deepEqual(protectedHits(['', '  ', 'README.md']), []);

console.log('protected-paths-carveout: all assertions passed');
