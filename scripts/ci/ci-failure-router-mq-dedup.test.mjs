#!/usr/bin/env node
// GOL-2691 — merge-queue dedup invariants for .github/workflows/ci-failure-router.yml.
//
// A merge_group run's head_branch is `gh-readonly-queue/<base>/pr-<N>-<base-sha>`,
// and GitHub mints a FRESH base sha for every requeue. The router used that raw
// branch name as its dedup key, so the key was unique per attempt: dedup could
// never fire, every requeue minted a new "ownerless" GitHub issue, and each of
// those mirrored into Paperclip and woke an agent. On 2026-09-30 one stale-dist PR
// (#713) at the head of a stacked batch amplified into 14 mirrored issues in 18
// minutes — 13 of which were cascade noise from other people's PRs being stacked
// behind it.
//
// The router now keys on `merge-queue/pr-<N>`. This test pins that behavior by
// reading the regexes out of the shipped workflow source (not a copy) and
// replaying the real 2026-09-30 queue storm through them.
//
// Run: `node scripts/ci/ci-failure-router-mq-dedup.test.mjs`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = readFileSync(
  join(root, '.github', 'workflows', 'ci-failure-router.yml'),
  'utf8'
);

// Pull each regex literal straight from the workflow so the test fails if the
// shipped pattern changes without the invariants being re-checked.
function regexFromWorkflow(constName) {
  const m = new RegExp(`const ${constName} = (/[^\\n]+/);`).exec(src);
  assert.ok(m, `ci-failure-router.yml no longer declares ${constName}`);
  // The captured text is a regex literal from a first-party workflow in this
  // repo, not input — there is no other way to evaluate it as a RegExp.
  return new Function(`return ${m[1]};`)();
}

const MQ_BRANCH_RE = regexFromWorkflow('MQ_BRANCH_RE');
const MQ_KEY_RE = regexFromWorkflow('MQ_KEY_RE');
const MARKER_RE = regexFromWorkflow('MARKER_RE');

const normalize = (branch) => {
  const m = MQ_BRANCH_RE.exec(branch ?? '');
  return m
    ? { branch: `merge-queue/pr-${m[1]}`, prNumber: Number(m[1]) }
    : { branch, prNumber: null };
};

// Both copies of the normalization (route + close-on-success) must agree, or a
// green requeue can never resolve the issue the failure minted.
assert.equal(
  (src.match(/const MQ_BRANCH_RE = /g) ?? []).length,
  2,
  'expected MQ_BRANCH_RE in both the route and close-on-success jobs'
);
assert.equal(
  (src.match(/merge-queue\/pr-\$\{/g) ?? []).length >= 2,
  true,
  'expected the `merge-queue/pr-<N>` dedup key in both jobs'
);

// ── 1. real queue branches normalize to a per-PR key ────────────────────────
// Verbatim head_branch values from the 2026-09-30 03:03–03:33Z merge-queue storm.
const STORM = [
  ['CI', 'gh-readonly-queue/main/pr-713-dfc09e101cafa7d8d5a231451c219a2d2a26ac46', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-711-bb9bfed3c330665cb290bf1bc49b8030779be696', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-711-dfc09e101cafa7d8d5a231451c219a2d2a26ac46', 'success'],
  ['CI', 'gh-readonly-queue/main/pr-733-8724accacef2d9bf80b8efa56e5a4341619c6bcd', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-713-8724accacef2d9bf80b8efa56e5a4341619c6bcd', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-733-7b0431a9a412bb708187176989cea70e310759a2', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-724-265655482e8d9f78b8380af8ace5460020a5abb3', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-724-8724accacef2d9bf80b8efa56e5a4341619c6bcd', 'success'],
  ['CI', 'gh-readonly-queue/main/pr-733-dd980180e0cea1f9f7716ff9e511363870019b45', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-712-a424956faeb3b6027ea9a9ac6ae59676627c4b22', 'failure'],
  ['CodeQL', 'gh-readonly-queue/main/pr-712-a424956faeb3b6027ea9a9ac6ae59676627c4b22', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-712-dd980180e0cea1f9f7716ff9e511363870019b45', 'success'],
  ['CodeQL', 'gh-readonly-queue/main/pr-733-e5175fd98417afc66ae59009d3da9fa4acd0df71', 'failure'],
  ['CI', 'gh-readonly-queue/main/pr-733-e5175fd98417afc66ae59009d3da9fa4acd0df71', 'success'],
  ['CodeQL', 'gh-readonly-queue/main/pr-733-e5175fd98417afc66ae59009d3da9fa4acd0df71', 'success'],
];
for (const [, branch] of STORM) {
  const n = normalize(branch);
  assert.ok(n.prNumber !== null, `failed to resolve a PR number from ${branch}`);
  assert.equal(n.branch, `merge-queue/pr-${n.prNumber}`);
  assert.ok(MQ_KEY_RE.test(n.branch), `sweep cannot recognize key ${n.branch}`);
  assert.equal(MQ_KEY_RE.exec(n.branch)[1], String(n.prNumber));
}

// The same PR across different batch base shas must collapse to ONE key.
const pr733 = new Set(
  STORM.filter(([, b]) => b.includes('/pr-733-')).map(([, b]) => normalize(b).branch)
);
assert.deepEqual([...pr733], ['merge-queue/pr-733'], 'PR #733 batches did not collapse');

// ── 2. ordinary branches are untouched ─────────────────────────────────────
for (const branch of [
  'main',
  'gol2677-drafter-retry',
  'dependabot/npm_and_yarn/production-dependencies-ec8a941180',
  // near-misses that must NOT be treated as a merge-queue branch
  'gh-readonly-queue/main/pr-733',
  'gh-readonly-queue/main/pr-abc-8724accacef2d9bf80b8efa56e5a4341619c6bcd',
  'feature/pr-733-8724accacef2d9bf80b8efa56e5a4341619c6bcd',
]) {
  const n = normalize(branch);
  assert.equal(n.prNumber, null, `${branch} must not normalize as a merge-queue branch`);
  assert.equal(n.branch, branch, `${branch} must pass through unchanged`);
}

// ── 3. replay the storm: the new key must collapse it to the one real bug ──
function replay(keyOf) {
  const open = new Set();
  let minted = 0;
  for (const [wf, branch, conclusion] of STORM) {
    const key = `${wf}:${keyOf(branch)}`;
    if (conclusion === 'failure') {
      if (!open.has(key)) {
        open.add(key);
        minted++;
      }
    } else {
      open.delete(key); // close-on-success
    }
  }
  return { minted, stillOpen: [...open] };
}

const before = replay((b) => b); // raw head_branch — the old behavior
const after = replay((b) => normalize(b).branch); // per-PR key — this router

assert.equal(before.minted, 10, 'storm fixture drifted: expected 10 raw-key mints');
assert.equal(before.stillOpen.length, 9, 'raw keys should leave 9 issues open');
assert.ok(
  after.minted < before.minted,
  'per-PR key must mint strictly fewer issues than the raw branch key'
);
// #711/#712/#724/#733 all reached a green batch, so close-on-success clears them.
assert.deepEqual(
  after.stillOpen.sort(),
  ['CI:merge-queue/pr-713', 'CodeQL:merge-queue/pr-712'],
  'only PRs without a later green batch may still hold an open issue'
);

// Then the PRs merged, and close-on-branch-gone clears their merge-queue keys.
const MERGED = ['711', '712', '724', '733'];
const afterMerges = after.stillOpen.filter((key) => {
  const m = MQ_KEY_RE.exec(key.slice(key.indexOf(':') + 1));
  return !(m && MERGED.includes(m[1]));
});
assert.deepEqual(
  afterMerges,
  ['CI:merge-queue/pr-713'],
  'the storm must reduce to exactly the one PR that was actually broken'
);

// ── 4. the marker the close/sweep jobs parse round-trips ───────────────────
for (const [wf, branch] of [
  ['CI', 'main'],
  ['CI', 'merge-queue/pr-733'],
  ['CodeQL', 'merge-queue/pr-712'],
  ['Deploy Droplet Plugins', 'gol2677-drafter-retry'],
  ['Sync new GitHub issues → Paperclip', 'main'],
]) {
  const body = `<!-- d3-ci-failure:${wf}:${branch} -->\nOwnerless failure — ...`;
  const m = MARKER_RE.exec(body);
  assert.ok(m, `marker for ${wf}:${branch} did not parse`);
  assert.equal(m[1], wf, `workflow half mis-parsed for ${wf}:${branch}`);
  assert.equal(m[2], branch, `branch half mis-parsed for ${wf}:${branch}`);
}

console.log(
  `ci-failure-router-mq-dedup: ${STORM.length} real queue runs replayed — ` +
    `${before.minted} issues minted on the raw branch key vs ${after.minted} on the ` +
    `per-PR key, reducing to ${afterMerges.length} once the merged PRs close.`
);
