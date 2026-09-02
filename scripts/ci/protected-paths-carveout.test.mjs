#!/usr/bin/env node
// Behavioral tests for the Tier-0 auto-approve carve-out (GOL-1406-A).
// Run: `node scripts/ci/protected-paths-carveout.test.mjs`
//
// The carve-out is called by auto-approve.yml before it stamps its approval and
// WITHHOLDS approval whenever a PR's changed files intersect PROTECTED_GLOBS —
// so an agent-authored PR touching `.github/workflows/**`, `infra/terraform/**`,
// etc. can never be auto-approved by the bot and sail into the merge queue.
//
// GOL-2013 removed the protected-paths guard workflow and its single-source
// generator; branch protection's `dismiss_stale_reviews_on_push` now closes the
// approve-then-push hole that the guard's SHA-binding used to. The carve-out is
// no longer generated and no longer mirrors a guard, so the old CARVE-OUT ≡ GUARD
// invariants are gone — this test now exercises the module's own behavior.
import assert from 'node:assert/strict';
import { protectedHits, globToRe, PROTECTED_GLOBS } from './protected-paths-carveout.mjs';

// ── Guard-rail: the shared, self-protecting glob must always be present ──────
// `.github/workflows/**` covers this file, auto-approve.yml, and every other
// workflow; losing it would let a workflow edit be auto-approved. Fail loudly.
assert.ok(
  PROTECTED_GLOBS.includes('.github/workflows/**'),
  'PROTECTED_GLOBS must include .github/workflows/** (self-protecting)'
);

// ── glob → RegExp semantics ─────────────────────────────────────────────────
// `**` matches nested and root; `*` does not cross `/`; literals are anchored.
assert.ok(globToRe('.github/workflows/**').test('.github/workflows/ci.yml'));
assert.ok(globToRe('.github/workflows/**').test('.github/workflows/nested/x.yml'));
assert.ok(!globToRe('a/*.ts').test('a/b/c.ts'), "'*' must not cross '/'");
assert.ok(globToRe('a/*.ts').test('a/b.ts'));
assert.ok(!globToRe('*.md').test('docs/x.md'), "leading '*' does not cross '/'");
assert.ok(globToRe('*.md').test('README.md'));

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
