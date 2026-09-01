#!/usr/bin/env node
// Behavioral matrix for the shared protected-paths-guard (GOL-1406 / GOL-1478).
//
// Extracts the exact `script:` block that ships in the generated workflow and
// drives it against mocked github/context/core so we test the shipped logic,
// not a copy. Run: `node scripts/ci/protected-paths-guard.test.mjs`
//
// The load-bearing case is the BACKDATE bypass (GOL-1478): an approving review
// bound to an old SHA must NOT satisfy the guard for a newer (even backdated)
// head commit, because the gate binds to the server-set review `commit_id`,
// not to a pusher-controlled commit date.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  join(here, '..', '..', '.github', 'workflows', 'protected-paths-guard.yml'),
  'utf8'
);

// The `script: |` block is the final block in the generated file; take
// everything after it and de-indent the 12-space YAML literal indent.
const marker = 'script: |\n';
const idx = workflow.indexOf(marker);
assert.ok(idx !== -1, 'could not find `script: |` block in workflow');
const raw = workflow.slice(idx + marker.length);
const body = raw
  .split('\n')
  .map((l) => (l.startsWith('            ') ? l.slice(12) : l))
  .join('\n');
// eslint-disable-next-line no-new-func
const guard = new Function(
  'github',
  'context',
  'core',
  `return (async () => { ${body} })();`
);

const HEAD = 'a'.repeat(40); // current head SHA in most scenarios
const OLD = 'b'.repeat(40); // an earlier commit SHA
const HUMAN = 'EngineeringMoonBear';

// Build a mock harness. `reviews` is the array listReviews returns;
// `protectedHit` decides whether a protected file appears in listFiles.
// merge_group scenarios (GOL-1991) additionally set `eventName: 'merge_group'`,
// an optional `headRef` (defaults to a well-formed queue ref for PR #1), and
// `groupFiles` = the merge-group diff (defaults to the named PR's own files, a
// single-PR group). `compareCommitsWithBasehead` returns those group files.
function harness({
  reviews = [],
  protectedHit = true,
  headSha = HEAD,
  eventName = 'pull_request_target',
  headRef,
  groupFiles,
}) {
  const calls = { failed: null, info: [], warn: [] };
  const core = {
    setFailed: (m) => { calls.failed = m; },
    info: (m) => calls.info.push(m),
    warning: (m) => calls.warn.push(m),
  };
  const files = protectedHit
    ? [{ filename: '.github/workflows/protected-paths-guard.yml' }]
    : [{ filename: 'README.md' }];
  const cmpFiles = (groupFiles ?? files.map((f) => f.filename)).map((fn) => ({ filename: fn }));
  const github = {
    paginate: async (fn) => fn.__data,
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha: headSha } } }),
        listFiles: Object.assign(async () => files, { __data: files }),
        listReviews: Object.assign(async () => reviews, { __data: reviews }),
      },
      repos: {
        compareCommitsWithBasehead: async () => ({ data: { files: cmpFiles } }),
      },
    },
  };
  const mgHeadRef =
    headRef ?? 'refs/heads/gh-readonly-queue/main/pr-1-' + 'c'.repeat(40);
  const context = {
    eventName,
    repo: { owner: 'o', repo: 'r' },
    payload:
      eventName === 'merge_group'
        ? { merge_group: { head_ref: mgHeadRef, base_sha: 'd'.repeat(40), head_sha: 'e'.repeat(40) } }
        : { pull_request: { number: 1 } },
  };
  return { github, context, core, calls };
}

const review = (o) => ({
  user: { login: o.login ?? HUMAN, type: o.type ?? 'User' },
  state: o.state,
  commit_id: o.commit_id,
});

const scenarios = [
  {
    name: 'no protected path touched -> pass',
    setup: { protectedHit: false },
    pass: true,
  },
  {
    name: 'protected path, no reviews -> fail',
    setup: { reviews: [] },
    pass: false,
  },
  {
    name: 'approving review by allowlisted human at HEAD -> pass',
    setup: { reviews: [review({ state: 'APPROVED', commit_id: HEAD })] },
    pass: true,
  },
  {
    name: 'BACKDATE BYPASS: approval bound to OLD sha, newer head -> fail',
    setup: { reviews: [review({ state: 'APPROVED', commit_id: OLD })] },
    pass: false,
    expect: /current head is/,
  },
  {
    name: 'approving review by NON-allowlisted user at HEAD -> fail',
    setup: { reviews: [review({ login: 'randobot', state: 'APPROVED', commit_id: HEAD })] },
    pass: false,
  },
  {
    name: 'approving review by a Bot identity at HEAD -> fail',
    setup: { reviews: [review({ type: 'Bot', state: 'APPROVED', commit_id: HEAD })] },
    pass: false,
  },
  {
    name: 'CHANGES_REQUESTED by allowlisted human at HEAD -> fail',
    setup: { reviews: [review({ state: 'CHANGES_REQUESTED', commit_id: HEAD })] },
    pass: false,
  },
  {
    name: 'approve at HEAD then dismiss -> fail',
    setup: { reviews: [review({ state: 'DISMISSED', commit_id: HEAD })] },
    pass: false,
  },
  {
    name: 'approve OLD then re-approve at HEAD -> pass',
    setup: {
      reviews: [
        review({ state: 'APPROVED', commit_id: OLD }),
        review({ state: 'APPROVED', commit_id: HEAD }),
      ],
    },
    pass: true,
  },
  {
    name: 'COMMENTED review does not dislodge a prior APPROVED at HEAD -> pass',
    setup: {
      reviews: [
        review({ state: 'APPROVED', commit_id: HEAD }),
        review({ state: 'COMMENTED', commit_id: HEAD }),
      ],
    },
    pass: true,
  },

  // ── merge_group enforcement (GOL-1991) ──────────────────────────────────
  {
    name: 'MERGE_GROUP: protected path, approved at HEAD, single-PR group -> pass',
    setup: {
      eventName: 'merge_group',
      reviews: [review({ state: 'APPROVED', commit_id: HEAD })],
    },
    pass: true,
  },
  {
    name: 'MERGE_GROUP: protected path, NO approval -> fail (would have merged before)',
    setup: { eventName: 'merge_group', reviews: [] },
    pass: false,
  },
  {
    name: 'MERGE_GROUP: protected path, approval bound to OLD sha -> fail',
    setup: {
      eventName: 'merge_group',
      reviews: [review({ state: 'APPROVED', commit_id: OLD })],
    },
    pass: false,
  },
  {
    name: 'MERGE_GROUP: no protected path anywhere in the group -> pass',
    setup: { eventName: 'merge_group', protectedHit: false },
    pass: true,
  },
  {
    name: 'MERGE_GROUP: unparseable head_ref -> fail closed',
    setup: {
      eventName: 'merge_group',
      headRef: 'refs/heads/gh-readonly-queue/main/not-a-pr-ref',
      reviews: [review({ state: 'APPROVED', commit_id: HEAD })],
    },
    pass: false,
    expect: /cannot parse the queued PR number/,
  },
  {
    name: 'MERGE_GROUP BATCH: co-batched PR touches a protected path not in named PR -> fail closed',
    setup: {
      eventName: 'merge_group',
      protectedHit: false, // named PR #1 touches only README.md
      groupFiles: ['README.md', '.github/workflows/coworker.yml'],
      reviews: [review({ state: 'APPROVED', commit_id: HEAD })],
    },
    pass: false,
    expect: /co-batched PR/,
  },
  {
    name: 'MERGE_GROUP BATCH: co-batched PR touches only unprotected paths -> pass',
    setup: {
      eventName: 'merge_group',
      reviews: [review({ state: 'APPROVED', commit_id: HEAD })],
      groupFiles: ['.github/workflows/protected-paths-guard.yml', 'docs/notes.md'],
    },
    pass: true,
  },
];

let failures = 0;
for (const s of scenarios) {
  const h = harness(s.setup);
  let threw = null;
  try {
    await guard(h.github, h.context, h.core);
  } catch (e) {
    threw = e;
  }
  const passed = h.calls.failed === null && !threw;
  const ok = passed === s.pass && (!s.expect || (h.calls.failed && s.expect.test(h.calls.failed)));
  if (!ok) {
    failures++;
    console.error(`FAIL: ${s.name}`);
    console.error(`  expected ${s.pass ? 'PASS' : 'FAIL'}, got ${passed ? 'PASS' : 'FAIL'}`);
    if (threw) console.error(`  threw: ${threw.message}`);
    if (h.calls.failed) console.error(`  setFailed: ${h.calls.failed}`);
  } else {
    console.log(`ok: ${s.name}`);
  }
}

if (failures) {
  console.error(`\n${failures} scenario(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${scenarios.length} scenarios passed.`);
