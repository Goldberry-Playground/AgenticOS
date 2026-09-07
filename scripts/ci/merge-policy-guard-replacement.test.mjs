#!/usr/bin/env node
// GOL-2013 replacement invariant: every repo the protected-paths guard was
// REMOVED from must declare `dismiss_stale_reviews: true`.
//
// Why this test exists. GOL-2013 removed the guard on the stated grounds that
// its one non-duplicate job — SHA-binding an approval so approve-then-push
// cannot slip a change past review — "is now done natively by branch
// protection's dismiss_stale_reviews_on_push" (see //guard-hold). The prose
// said so; the machine-readable target did not. All three guard-carrying repos
// merged their removal PRs while `dismiss_stale_reviews` was still declared —
// and live — `false`, so from each of those merges the window the directive
// claimed was covered natively was covered by nothing at all.
//
// The removal and its replacement are one change split across two files, and
// nothing tied them together. This is that tie: the guard cannot be removed
// from a repo without its native replacement being declared for that repo.
//
// Run: `node scripts/ci/merge-policy-guard-replacement.test.mjs`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const mergePolicy = JSON.parse(
  readFileSync(join(root, '.github', 'merge-policy.json'), 'utf8')
);

// The repos that actually carried protected-paths-guard.yml and had it removed
// by GOL-2013. AgriforestryOS is deliberately absent: it never carried the
// guard or the auto-approve carve-out, so it has no removed protection to
// replace and enabling this there would be a new policy decision.
const GUARD_REMOVED_FROM = [
  'AgenticOS',
  'grove-sites',
  'grove-odoo-modules',
  'odoocker-goldberrygrove',
];

for (const name of GUARD_REMOVED_FROM) {
  const entry = mergePolicy.repos.find((r) => r.repo === name);
  assert.ok(entry, `merge-policy.json has no '${name}' repo entry`);
  assert.equal(
    entry.targets?.dismiss_stale_reviews,
    true,
    `'${name}' had the protected-paths guard removed (GOL-2013), so it MUST declare ` +
      `targets.dismiss_stale_reviews: true — that setting is the guard's native ` +
      `replacement. Declaring false (or leaving it unmanaged) reopens the ` +
      `approve-then-push window with nothing covering it.`
  );
}

// The guard is gone org-wide and must never come back as a required check.
for (const entry of mergePolicy.repos) {
  const contexts = entry.required_contexts ?? [];
  const guard = contexts.find((c) => /protected[ -]paths/i.test(c));
  assert.equal(
    guard,
    undefined,
    `'${entry.repo}'.required_contexts re-adds the removed guard ('${guard}'). ` +
      `GOL-2013 deleted that workflow from every repo; requiring a context no ` +
      `workflow reports would wedge the merge queue at "Expected — waiting for status".`
  );
}

console.log(
  `merge-policy-guard-replacement: native replacement declared for all ` +
    `${GUARD_REMOVED_FROM.length} guard-removed repos; guard absent from every required_contexts set`
);
