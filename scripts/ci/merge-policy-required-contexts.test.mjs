#!/usr/bin/env node
// Lockstep invariant for GOL-1953: the required-check context list this repo
// APPLIES (.github/merge-policy.json → repos[AgenticOS].required_contexts, the
// source apply-merge-policy.sh --apply writes to live branch protection) must
// equal the list this repo DECLARES for the reconcile audit
// (.github/required-checks.json → required_contexts, what GOL-1907's reconcile
// leg compares against live and hard-fails on drift).
//
// If these two drift, `--apply` would set live protection to one set while the
// weekly reconcile asserts a different one — the reconcile goes red for a reason
// that has nothing to do with real infra drift. Both files live in THIS repo, so
// unlike the cross-repo case we can enforce their agreement in CI here.
//
// Run: `node scripts/ci/merge-policy-required-contexts.test.mjs`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const mergePolicy = JSON.parse(
  readFileSync(join(root, '.github', 'merge-policy.json'), 'utf8')
);
const requiredChecks = JSON.parse(
  readFileSync(join(root, '.github', 'required-checks.json'), 'utf8')
);

const self = mergePolicy.repos.find((r) => r.repo === 'AgenticOS');
assert.ok(self, 'merge-policy.json has no AgenticOS repo entry');
assert.ok(
  Array.isArray(self.required_contexts),
  'AgenticOS entry in merge-policy.json is missing required_contexts'
);
assert.ok(
  Array.isArray(requiredChecks.required_contexts),
  'required-checks.json is missing required_contexts'
);

// Order-insensitive set equality — the apply and the audit both treat the list
// as a set, so a reorder is not drift but a membership change is.
const a = [...self.required_contexts].sort();
const b = [...requiredChecks.required_contexts].sort();
assert.deepEqual(
  a,
  b,
  `merge-policy.json[AgenticOS].required_contexts must equal required-checks.json.required_contexts.\n` +
    `  merge-policy : ${JSON.stringify(a)}\n` +
    `  required-checks: ${JSON.stringify(b)}`
);

// No duplicate contexts in either file (a dup would over/under-count on apply).
assert.equal(new Set(a).size, a.length, 'merge-policy.json[AgenticOS].required_contexts has duplicates');
assert.equal(new Set(b).size, b.length, 'required-checks.json.required_contexts has duplicates');

console.log(`merge-policy-required-contexts: AgenticOS lockstep holds (${a.length} contexts)`);
