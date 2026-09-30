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

// ── 2b. The SHIPPED normalizeBranch is what collapses the per-attempt storm ───
// Section 2 above rebuilds only the RegExp. The dedup key itself is built by
// `normalizeBranch`, and asserting that against a re-implementation here would be
// a tautology: the key construction could regress to returning the raw branch and
// a hand-written copy of the function would happily keep passing. So lift the real
// function body out of the workflow and drive THAT.
const fnSrc = /function normalizeBranch\(branch\) \{\n([\s\S]*?)\n\s*\}\n/.exec(wf);
assert.ok(fnSrc, `${wfPath} no longer declares function normalizeBranch(branch)`);
// Both the pattern and the function body are first-party source from a workflow in
// this repo, not input; there is no other way to execute the shipped code.
const normalizeBranch = new Function(
  'branch',
  `const MQ_BRANCH_RE = ${literals[0]};\n${fnSrc[1]}`
);

// The whole point of the key: every attempt for one PR collapses to ONE value, so
// dedup fires and close-on-success can resolve what a failed attempt filed.
const attempts = [
  'gh-readonly-queue/main/pr-733-8724accacef2d9bf80b8efa56e5a4341619c6bcd',
  'gh-readonly-queue/main/pr-733-0000000000000000000000000000000000000000',
  'gh-readonly-queue/main/pr-733-e5175fd98417afc66ae59009d3da9fa4acd0df71',
];
const keys = new Set(attempts.map((b) => normalizeBranch(b).branch));
assert.equal(
  keys.size,
  1,
  'the three real PR #733 queue attempts must collapse to ONE dedup key, else ' +
    `every requeue mints a fresh issue nothing can close: got ${JSON.stringify([...keys])}`
);
const [key] = keys;
assert.equal(
  key,
  'merge-queue/pr-733',
  'the dedup key must be the stable synthetic `merge-queue/pr-<N>`, not the ' +
    'per-attempt queue branch — see GOL-2691'
);
assert.notEqual(
  key,
  attempts[0],
  'normalizeBranch returned the raw per-attempt branch — the dedup key is not stable'
);
// ...and the key it produces must be the one the sweep recognizes, or the issues
// it mints become immortal: there is no such branch for getBranch to 404 on.
const MQ_KEY_RE = new RegExp(
  /const MQ_KEY_RE = (\/[^\n]+\/);/.exec(wf)?.[1]?.slice(1, -1) ??
    assert.fail('the sweep no longer declares MQ_KEY_RE')
);
assert.equal(
  MQ_KEY_RE.exec(key)?.[1],
  '733',
  `the sweep's MQ_KEY_RE cannot recover a PR number from the key route mints (${key}), ` +
    'so a merge-queue failure issue could never be swept'
);
// Ordinary branches must pass through untouched, or a normal PR failure would be
// filed under a bogus synthetic key.
for (const b of ['main', 'gol2677-drafter-retry']) {
  assert.deepEqual(normalizeBranch(b), { branch: b, prNumber: null }, `${b} must pass through`);
}

// ── 3. Failure IDENTITY is keyed on the normalized branch, not the raw one ────
// If the marker ever reverts to HEAD_BRANCH, the per-attempt orphan-issue bug
// comes straight back, silently. Both the minting job (route) and the resolving
// job (close-on-success) must build the marker from the SAME normalized key, or
// a green requeue can never close what its own failed attempt filed.
const markers = [
  ...wf.matchAll(/const marker = `<!-- d3-ci-failure:\$\{WF_NAME\}:\$\{(\w+)\} -->`;/g),
].map((m) => m[1]);
assert.deepEqual(
  markers,
  ['DEDUP_BRANCH', 'DEDUP_BRANCH'],
  'both the route and close-on-success d3-ci-failure markers must key on ' +
    '${DEDUP_BRANCH} (the stable `merge-queue/pr-<N>` key for queue runs) — ' +
    `see GOL-2688/GOL-2691; found ${JSON.stringify(markers)}`
);
assert.equal(
  wf.includes('d3-ci-failure:${WF_NAME}:${HEAD_BRANCH}'),
  false,
  'a d3-ci-failure marker is still built from ${HEAD_BRANCH}; on a merge-queue ' +
    'run that is the throwaway queue branch, so the issue can never dedupe or close'
);
// The title must name the PR, not the synthetic key — `merge-queue/pr-733` is a
// dedup key, not something a human should have to decode off a board card.
assert.match(
  wf,
  /\? `CI failure: \$\{WF_NAME\} on the merge queue for PR #\$\{MQ_PR\}`/,
  'a merge-queue failure issue must be TITLED with its PR number — see GOL-2688'
);

// ── 4. Queue attribution is gated on the merge_group EVENT, not branch shape ──
// Branch names are pushable by anyone with write access; a branch merely SHAPED
// like a queue branch must not be able to redirect failure reports onto an
// unrelated PR. Only GitHub's merge queue emits `merge_group` runs.
assert.match(
  wf,
  /RUN_EVENT === "merge_group"\s*\n\s*\? normalizeBranch\(HEAD_BRANCH\)\s*\n\s*: \{ branch: HEAD_BRANCH, prNumber: null \};/,
  'the route job must require RUN_EVENT === "merge_group" before normalizing a ' +
    'queue-shaped branch name into a PR number'
);
assert.match(
  wf,
  /const mq = RUN_EVENT === "merge_group" \? MQ_BRANCH_RE\.exec\(HEAD_BRANCH \?\? ""\) : null;/,
  'close-on-success must require RUN_EVENT === "merge_group" before normalizing ' +
    'a queue-shaped branch name — otherwise it keys differently from route'
);
// Both gating script bodies need the event in their env, or the gate above is
// comparing against undefined and silently never attributes anything. Asserted
// via each job's own destructure (job-specific) rather than by counting `env:`
// keys, which `page-ops` also plumbs for its own unrelated use.
assert.match(
  wf,
  /const \{ RUN_ID, WF_NAME, HEAD_BRANCH, HEAD_SHA, RUN_URL, RUN_EVENT, RUN_ATTEMPT, RUN_CONCLUSION \} = process\.env;/,
  'the route job must destructure RUN_EVENT out of process.env'
);
assert.match(
  wf,
  /const \{ WF_NAME, HEAD_BRANCH, RUN_URL, RUN_EVENT \} = process\.env;/,
  'close-on-success must destructure RUN_EVENT out of process.env'
);
assert.ok(
  (wf.match(/RUN_EVENT: \$\{\{ github\.event\.workflow_run\.event \}\}/g) ?? []).length >= 2,
  'RUN_EVENT must be plumbed into at least the route and close-on-success envs'
);

// ── 5. A queue failure whose PR is already settled is DROPPED, not filed ─────
assert.match(
  wf,
  /if \(MQ_PR !== null && !pr\) \{/,
  'the router must drop a merge-queue failure whose PR is no longer open rather ' +
    'than mint an un-actionable orphan issue — see GOL-2688'
);
// ...and the ownerless path must therefore no longer claim a merge-queue failure
// is ownerless: reaching it implies MQ_PR === null.
assert.equal(
  wf.includes('Merge-queue rejection for PR #${MQ_PR}'),
  false,
  'the ownerless mint still has a merge-queue arm, which is now unreachable ' +
    'dead code behind the settled-PR drop — see GOL-2688'
);

console.log(
  `ci-failure-router-queue-branch: pattern ${literals[0]} is consistent across ` +
    `both jobs and parses ${cases.length} branches correctly`
);
