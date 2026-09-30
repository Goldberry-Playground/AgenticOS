#!/usr/bin/env node
// GOL-2688: the D3 failure router must attribute a MERGE-QUEUE failure to the
// pull request that caused it.
//
// A merge_group run's head branch is `gh-readonly-queue/<base>/pr-<N>-<sha>`.
// No pull request ever has that branch as its head, so the router's
// `pulls.list({ head })` lookup returns nothing and the failure was filed as an
// "Ownerless failure" — for PR #733 that produced GitHub issue #739 / GOL-2688,
// an orphan nobody could act on without hand-deriving the owner from the branch
// name. Worse, the `<sha>` suffix is fresh per queue attempt, so keying the
// dedup marker on it minted a NEW issue per attempt that `close-on-success`
// could never resolve (its green run carries a different queue branch), leaving
// only the daily sweep to reap them.
//
// The fix parses the PR number out of the queue branch and keys the failure's
// identity on the PR's own head ref. The pattern is necessarily inlined in TWO
// github-script bodies — the `route` job deliberately never checks out the repo,
// so it cannot import a shared helper. This test is the anti-drift lock on that
// duplication, and pins the parse against the real GOL-2688 branch.
//
// Run: `node scripts/ci/ci-failure-router-queue-branch.test.mjs`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const wfPath = join(root, '.github', 'workflows', 'ci-failure-router.yml');
const wf = readFileSync(wfPath, 'utf8');

// ── 1. Both copies of the queue-branch pattern exist and are IDENTICAL ───────
// Matches the regex literal in source form, e.g.
//   /^gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]{40}$/
const literals = [...wf.matchAll(/\/\^gh-readonly-queue[^/\n]*(?:\\\/[^/\n]*)*\$\//g)].map(
  (m) => m[0]
);
assert.equal(
  literals.length,
  2,
  `expected exactly 2 inlined queue-branch regex literals in ${wfPath} ` +
    `(route + close-on-success), found ${literals.length}: ${JSON.stringify(literals)}`
);
assert.equal(
  literals[0],
  literals[1],
  'the route and close-on-success queue-branch patterns have DRIFTED — a green ' +
    'merge-queue run would stop resolving the issue its own failed attempt filed.\n' +
    `  route          : ${literals[0]}\n` +
    `  close-on-success: ${literals[1]}`
);

// ── 2. The pattern parses real branches correctly ────────────────────────────
// Rebuild the RegExp from the literal the workflow actually ships, so this test
// can never pass against a pattern the router does not use.
const body = literals[0].slice(1, -1);
const QUEUE_BRANCH = new RegExp(body);
const parse = (branch) => {
  const m = branch.match(QUEUE_BRANCH);
  return m ? Number(m[1]) : null;
};

const cases = [
  // The exact branch from GOL-2688 / run 36663093855 — the regression case.
  ['gh-readonly-queue/main/pr-733-8724accacef2d9bf80b8efa56e5a4341619c6bcd', 733],
  // A second queue attempt for the SAME pr must resolve to the same number,
  // which is what collapses the per-attempt issue storm into one.
  ['gh-readonly-queue/main/pr-733-0000000000000000000000000000000000000000', 733],
  // A queue on a base branch that itself contains slashes.
  ['gh-readonly-queue/release/v2/pr-41-8724accacef2d9bf80b8efa56e5a4341619c6bcd', 41],
  // Ordinary branches must NOT be mistaken for queue branches — doing so would
  // send a real PR/ownerless failure to pulls.get() with a bogus number.
  ['main', null],
  ['gol2677-drafter-retry', null],
  ['dependabot/npm_and_yarn/vitest-5.0.0', null],
  // Queue-ish but malformed: a short sha is not a queue branch.
  ['gh-readonly-queue/main/pr-733-8724acc', null],
  // A human branch that merely shares the prefix.
  ['gh-readonly-queue/main/something-else', null],
];
for (const [branch, want] of cases) {
  assert.equal(parse(branch), want, `queue-branch parse of ${JSON.stringify(branch)}`);
}

// ── 3. Failure IDENTITY is keyed on the normalized branch, not the raw one ────
// If the marker/title ever revert to HEAD_BRANCH, the per-attempt orphan-issue
// bug comes straight back, silently.
assert.match(
  wf,
  /const marker = `<!-- d3-ci-failure:\$\{WF_NAME\}:\$\{BRANCH\} -->`;/,
  'the minted dedup marker must key on ${BRANCH} (the PR head ref for queue ' +
    'runs), not ${HEAD_BRANCH} — see GOL-2688'
);
assert.match(
  wf,
  /const title = `CI failure: \$\{WF_NAME\} on \$\{BRANCH\}`;/,
  'the minted issue title must key on ${BRANCH}, not ${HEAD_BRANCH} — see GOL-2688'
);
assert.equal(
  wf.includes('d3-ci-failure:${WF_NAME}:${HEAD_BRANCH}'),
  false,
  'a d3-ci-failure marker is still built from ${HEAD_BRANCH}; on a merge-queue ' +
    'run that is the throwaway queue branch, so the issue can never dedupe or close'
);

// ── 4. Queue attribution is gated on the merge_group EVENT, not branch shape ──
// Branch names are pushable by anyone with write access; a branch merely SHAPED
// like a queue branch must not be able to redirect failure reports onto an
// unrelated PR. Only GitHub's merge queue emits `merge_group` runs.
assert.match(
  wf,
  /if \(RUN_EVENT !== "merge_group"\) return null;/,
  'the route job must require RUN_EVENT === "merge_group" before parsing a PR ' +
    'number out of a queue-shaped branch name'
);
assert.match(
  wf,
  /RUN_EVENT === "merge_group"\s*\n\s*\? HEAD_BRANCH\.match\(/,
  'close-on-success must require RUN_EVENT === "merge_group" before normalizing ' +
    'a queue-shaped branch name'
);
assert.match(
  wf,
  /RUN_EVENT: \$\{\{ github\.event\.workflow_run\.event \}\}/,
  'close-on-success needs RUN_EVENT plumbed into its script env'
);

// ── 5. A queue failure whose PR is already settled is DROPPED, not filed ─────
assert.match(
  wf,
  /if \(queuedPrNumber !== null && !pr\) \{/,
  'the router must drop a merge-queue failure whose PR is no longer open rather ' +
    'than mint an un-actionable orphan issue — see GOL-2688'
);

console.log(
  `ci-failure-router-queue-branch: pattern ${literals[0]} is consistent across ` +
    `both jobs and parses ${cases.length} branches correctly`
);
