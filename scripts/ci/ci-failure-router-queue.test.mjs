#!/usr/bin/env node
// Behavioral tests for the D3 failure router's MERGE-QUEUE routing (GOL-2687).
// Run: `node scripts/ci/ci-failure-router-queue.test.mjs`
//
// WHY THIS TEST EXISTS
// --------------------
// A `merge_group` run's `head_branch` is an ephemeral queue branch,
// `gh-readonly-queue/<base>/pr-<N>-<baseSha>`, which is never any PR's head ref.
// The router resolved owners with `pulls.list({ head })`, so every merge-queue
// failure came back ownerless AND — because the volatile `<baseSha>` was part of
// the dedup marker — each requeue attempt minted a BRAND-NEW issue. On
// 2026-09-30 that produced 15 GitHub issues in 35 minutes (4 for PR #733
// alone), every one of them mirrored into Paperclip and spawning an agent run.
//
// This test loads the REAL `route` step out of ci-failure-router.yml and
// executes it against stubbed Octokit/core objects, so it asserts on what the
// shipped workflow actually does rather than on a copy of its logic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wfPath = resolve(here, '../../.github/workflows/ci-failure-router.yml');
const wf = readFileSync(wfPath, 'utf8');

// ── Extract the `route` step's inline github-script body ─────────────────────
// No YAML dependency (scripts/ is not a pnpm workspace — node builtins only):
// take everything after the route job's `script: |` up to the next job comment.
function extractRouteScript(src) {
  const start = src.indexOf('const { RUN_ID, WF_NAME,');
  assert.ok(start > 0, 'route script not found — did the env destructure change?');
  const end = src.indexOf('\n  # ──', start);
  assert.ok(end > start, 'end of route job not found');
  const body = src.slice(start, end);
  // Strip the uniform 12-space block indent so it is valid standalone JS.
  return body
    .split('\n')
    .map((l) => (l.startsWith('            ') ? l.slice(12) : l))
    .join('\n');
}
const routeSrc = extractRouteScript(wf);

// ── Harness: run the route script with stubbed github/context/core ───────────
async function runRoute({ event, branch, sha = 'a'.repeat(40), wfName = 'CI', conclusion = 'failure',
                          failedJobs = [{ name: 'Build', conclusion: 'failure', html_url: 'u' }],
                          pulls = {}, openPrByHead = null, baseCommitSubject = null,
                          branchHistory = [], openIssues = [], prComments = [] }) {
  const calls = { created: [], comments: [], updatedComments: [], closed: [], info: [] };
  const github = {
    paginate: async (method, params) => method(params).then((r) => r.data),
    rest: {
      pulls: {
        list: async () => ({ data: openPrByHead ? [openPrByHead] : [] }),
        get: async ({ pull_number }) => {
          const pr = pulls[pull_number];
          if (!pr) { const e = new Error('Not Found'); e.status = 404; throw e; }
          return { data: pr };
        },
      },
      actions: {
        listJobsForWorkflowRun: async () => ({ data: failedJobs }),
        listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: branchHistory } }),
      },
      repos: {
        getCommit: async () => {
          if (baseCommitSubject === null) { const e = new Error('Not Found'); e.status = 404; throw e; }
          return { data: { commit: { message: `${baseCommitSubject}\n\nbody` } } };
        },
      },
      issues: {
        listForRepo: async () => ({ data: openIssues }),
        listComments: async () => ({ data: prComments }),
        create: async (p) => { calls.created.push(p); return { data: { number: 999 } }; },
        createComment: async (p) => { calls.comments.push(p); },
        updateComment: async (p) => { calls.updatedComments.push(p); },
        update: async (p) => { calls.closed.push(p); },
        createLabel: async () => {},
      },
    },
  };
  const core = { info: (m) => calls.info.push(m) };
  const context = { repo: { owner: 'Goldberry-Playground', repo: 'AgenticOS' } };
  const env = {
    RUN_ID: '1', WF_NAME: wfName, HEAD_BRANCH: branch, HEAD_SHA: sha,
    RUN_URL: 'https://run', RUN_EVENT: event, RUN_ATTEMPT: '1', RUN_CONCLUSION: conclusion,
  };
  const fn = new Function('github', 'context', 'core', 'process',
    `return (async () => {\n${routeSrc}\n})();`);
  await fn(github, context, core, { env });
  return calls;
}

const QUEUE_711 = 'gh-readonly-queue/main/pr-711-bb9bfed3c330665cb290bf1bc49b8030779be696';
const OPEN_PR = (n) => ({ [n]: { number: n, state: 'open' } });
const MERGED_PR = (n) => ({ [n]: { number: n, state: 'closed', merged: true } });

// ── 1. A merge_group failure is NEVER routed as "ownerless" ──────────────────
// The PR number is right there in the branch name.
{
  const c = await runRoute({ event: 'merge_group', branch: QUEUE_711, pulls: OPEN_PR(711) });
  assert.equal(c.created.length, 0, 'must not mint an ownerless issue for a queue failure');
  assert.equal(c.comments.length, 1, 'must sticky-comment the owning PR');
  assert.equal(c.comments[0].issue_number, 711, 'owner resolved from pr-<N> in the queue branch');
  assert.ok(/❌ CI failed/.test(c.comments[0].body));
}

// ── 2. A SUPERSEDED queue commit files nothing ───────────────────────────────
// PR #711 failed inside a batch, was dequeued, requeued alone, and merged green.
// There is no defect left and no owner to page; filing would be pure churn.
// (A merge that really breaks main still fails the `push` run on main, which
// routes as genuinely ownerless — that path is asserted in test 5.)
{
  const c = await runRoute({ event: 'merge_group', branch: QUEUE_711, pulls: MERGED_PR(711) });
  assert.equal(c.created.length, 0, 'merged PR: no issue');
  assert.equal(c.comments.length, 0, 'merged PR: no comment');
  assert.ok(c.info.some((m) => /superseded queue commit for PR #711/.test(m)),
    'must log why it declined to file');
}
{ // PR deleted outright (404) — same silence, no crash.
  const c = await runRoute({ event: 'merge_group', branch: QUEUE_711, pulls: {} });
  assert.equal(c.created.length + c.comments.length, 0, '404 PR: file nothing');
}

// ── 3. Dedup key is STABLE across requeue attempts of the same PR ────────────
// Escalate on a deterministic-only failure so mintOrUpdateIssue is reached, then
// check the marker carries no base sha. Four different base shas → one marker.
{
  const markers = new Set();
  const bases = ['8724accacef2d9bf80b8efa56e5a4341619c6bcd',
                 '7b0431a9a412bb708187176989cea70e310759a2',
                 'dd980180e0cea1f9f7716ff9e511363870019b45',
                 'e5175fd98417afc66ae59009d3da9fa4acd0df71'];
  for (const base of bases) {
    const c = await runRoute({
      event: 'merge_group', branch: `gh-readonly-queue/main/pr-733-${base}`,
      pulls: OPEN_PR(733),
      failedJobs: [{ name: 'Lint', conclusion: 'failure', html_url: 'u' }], // deterministic → escalates
    });
    assert.equal(c.created.length, 1, 'deterministic-only queue failure escalates once');
    markers.add(/<!-- (d3-ci-failure:[^ ]+) -->/.exec(c.created[0].body)[1]);
    assert.ok(!c.created[0].body.includes(`:gh-readonly-queue/`),
      'marker must not embed the ephemeral queue branch');
    assert.ok(!c.created[0].title.includes(base), 'title must not embed the base sha');
  }
  assert.deepEqual([...markers], ['d3-ci-failure:CI:merge-queue/main/pr-733'],
    'all four requeue attempts of PR #733 must share ONE dedup marker');
}

// ── 4. Batch-base attribution names the real owner ──────────────────────────
// Queue commit `pr-711-<sha>` is STACKED on <sha> = the queued merge of #713.
// #711 is a one-line codeql-action bump; the 820-line stale-dist Build failure
// was #713's. Point the reader at the base PR instead of the innocent diff.
{
  const c = await runRoute({
    event: 'merge_group', branch: QUEUE_711, pulls: OPEN_PR(711),
    baseCommitSubject: 'chore(deps)(deps): bump the production-dependencies group with 12 updates (#713)',
  });
  const body = c.comments[0].body;
  assert.ok(/\*\*Batch base:\*\*/.test(body), 'must surface the batch base');
  assert.ok(/may be owned by #713/.test(body), 'must name #713 as the likely owner');
  assert.ok(/not #711/.test(body), 'must say it is probably not #711');
}
{ // Base is the PR's OWN commit, or has no `(#N)` suffix → no misleading note.
  for (const subject of [
    'chore(deps)(deps): bump github/codeql-action in the actions group (#711)',
    'a plain commit with no PR suffix',
    null, // dropped batch: the base commit is GC'd and unreadable
  ]) {
    const c = await runRoute({
      event: 'merge_group', branch: QUEUE_711, pulls: OPEN_PR(711), baseCommitSubject: subject,
    });
    assert.ok(!/Batch base/.test(c.comments[0].body),
      `no batch note expected for base subject: ${subject}`);
  }
}

// ── 5. Non-merge_group routing is UNCHANGED ─────────────────────────────────
{ // main push with no PR → still genuinely ownerless, still mints immediately.
  const c = await runRoute({ event: 'push', branch: 'main' });
  assert.equal(c.created.length, 1, 'main failure must still mint an issue');
  assert.ok(/Ownerless failure/.test(c.created[0].body));
  assert.ok(c.created[0].body.includes('<!-- d3-ci-failure:CI:main -->'),
    'main keeps its unnormalized marker');
}
{ // A queue-shaped branch on a NON-merge_group event must not be reinterpreted.
  const c = await runRoute({ event: 'push', branch: QUEUE_711, pulls: MERGED_PR(711) });
  assert.equal(c.created.length, 1, 'push event keeps the old ownerless behavior');
  assert.ok(c.created[0].body.includes(`<!-- d3-ci-failure:CI:${QUEUE_711} -->`));
}
{ // Ordinary PR branch → sticky comment, no issue (Build is not deterministic).
  const c = await runRoute({
    event: 'pull_request', branch: 'gol2687-mergequeue-router',
    openPrByHead: { number: 800, state: 'open' },
  });
  assert.equal(c.created.length, 0);
  assert.equal(c.comments[0].issue_number, 800);
}

// ── 6. A malformed queue branch degrades to the old behavior, never crashes ──
for (const bad of [
  'gh-readonly-queue/main/pr-711',                 // no base sha
  'gh-readonly-queue/main/pr-abc-8724acca',        // non-numeric PR
  'gh-readonly-queue/main/pr-711-NOTHEX',          // non-hex base
  'gh-readonly-queue/main',                        // no pr segment
]) {
  const c = await runRoute({ event: 'merge_group', branch: bad });
  assert.equal(c.created.length, 1, `malformed queue branch must fall back to ownerless: ${bad}`);
  assert.ok(/Ownerless failure/.test(c.created[0].body));
}

// ── 7. close-on-success normalizes identically, or a green requeue can never
//      close the issue a red requeue minted (different base sha = no match) ──
{
  const closeStep = wf.slice(wf.indexOf('close-on-success:'));
  const routeRe = /RUN_EVENT === "merge_group"\s*\?\s*(\/\^gh-readonly-queue.+?\/)\.exec/s.exec(routeSrc);
  const closeRe = /RUN_EVENT === "merge_group"\s*\?\s*(\/\^gh-readonly-queue.+?\/)\.exec/s.exec(closeStep);
  assert.ok(routeRe && closeRe, 'both jobs must parse the queue branch');
  assert.equal(closeRe[1], routeRe[1],
    'close-on-success must use the SAME queue-branch regex as route');
  assert.ok(/merge-queue\/\$\{queueMatch\[1\]\}\/pr-\$\{Number\(queueMatch\[2\]\)\}/.test(closeStep),
    'close-on-success must build the same merge-queue/<base>/pr-<N> key');
  assert.ok(/RUN_EVENT: \$\{\{ github\.event\.workflow_run\.event \}\}/.test(closeStep),
    'close-on-success needs RUN_EVENT in its env or the normalization is dead code');
}

// ── 8. The daily sweep resolves merge-queue keys by PR state, not by branch ──
// `merge-queue/<base>/pr-<N>` names no real branch, so repos.getBranch always
// 404s. Without an explicit arm the sweep would reap OPEN PRs' issues and only
// look correct by accident.
{
  const sweep = wf.slice(wf.indexOf('  sweep:'));
  assert.ok(/\/\^merge-queue\\\/\.\+\\\/pr-\(\\d\+\)\$\//.test(sweep),
    'sweep must recognize merge-queue keys');
  const arm = sweep.slice(sweep.indexOf('merge-queue\\/'));
  assert.ok(/pulls\.get/.test(arm), 'sweep must resolve merge-queue keys via pulls.get');
  assert.ok(/prState === "open"\) continue/.test(arm), 'an OPEN PR must keep its issue');
  assert.ok(arm.indexOf('continue;') < arm.indexOf('let exists = true'),
    'the merge-queue arm must short-circuit before the getBranch existence check');
}

console.log('ci-failure-router merge-queue routing: all assertions passed');
