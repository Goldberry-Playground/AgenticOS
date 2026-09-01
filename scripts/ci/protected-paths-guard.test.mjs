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
const PROT = '.github/workflows/protected-paths-guard.yml';
// The named PR's approved unified-diff patch for the protected file. The
// content-attribution check (GOL-1999) compares the merge-group diff for each
// protected file against this; a single-PR / clean batch reproduces it exactly.
const PATCH_A = '@@ -1,2 +1,3 @@\n line one\n line two\n+added by the named PR';

// Build a mock harness. `reviews` is the array listReviews returns;
// `protectedHit` decides whether a protected file appears in listFiles.
// merge_group scenarios (GOL-1991) additionally set `eventName: 'merge_group'`,
// an optional `headRef` (defaults to a well-formed queue ref for PR #1), and
// `groupFiles` = the merge-group diff. Each `groupFiles` entry is either a
// plain filename (its patch defaults to the named PR's own patch for that file
// — a clean single-PR / identical-content batch) or a `{ filename, patch }`
// object, used to model a co-batched edit whose content differs from (or is
// missing relative to) the named PR's approved diff (GOL-1999).
// `prPatch` overrides the patch the named PR carries for the protected file.
function harness({
  reviews = [],
  protectedHit = true,
  headSha = HEAD,
  eventName = 'pull_request_target',
  headRef,
  groupFiles,
  prPatch = PATCH_A,
}) {
  const calls = { failed: null, info: [], warn: [] };
  const core = {
    setFailed: (m) => { calls.failed = m; },
    info: (m) => calls.info.push(m),
    warning: (m) => calls.warn.push(m),
  };
  const files = protectedHit
    ? [{ filename: PROT, patch: prPatch }]
    : [{ filename: 'README.md', patch: PATCH_A }];
  // Named PR's patch per file, so a `groupFiles` filename string reproduces the
  // named PR's exact change (clean batch); undefined for files the named PR
  // does not touch (they can only reach the uncovered/co-batched branch).
  const prPatchByName = new Map(files.map((f) => [f.filename, f.patch]));
  const cmpFiles = (groupFiles ?? files.map((f) => f.filename)).map((g) =>
    typeof g === 'string'
      ? { filename: g, patch: prPatchByName.get(g) }
      : { filename: g.filename, patch: g.patch }
  );
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
      groupFiles: [PROT, 'docs/notes.md'],
    },
    pass: true,
  },

  // ── same-file co-batch: content attribution (GOL-1999) ───────────────────
  // The residual gap #654's filename-only check left open: a co-batched PR
  // edits a protected file the NAMED PR also touches, on non-overlapping lines,
  // so the queue merges them into one file diff. Filename attribution passes
  // (the file IS in the named PR); content attribution must catch the extra
  // hunk and fail closed.
  {
    name: 'MERGE_GROUP SAME-FILE CO-BATCH: extra co-batched hunk on a protected file the named PR also touches -> fail closed (GOL-1999)',
    setup: {
      eventName: 'merge_group',
      reviews: [review({ state: 'APPROVED', commit_id: HEAD })],
      // named PR #1's approved change is PATCH_A; the merge group carries
      // PATCH_A PLUS a non-overlapping hunk injected by a co-batched PR.
      groupFiles: [
        { filename: PROT, patch: PATCH_A + '\n@@ -40,1 +41,2 @@\n forty\n+injected by a co-batched PR' },
      ],
    },
    pass: false,
    expect: /not covered by the SHA-bound approval|CONTENT/,
  },
  {
    name: 'MERGE_GROUP SAME-FILE: identical protected content in group and named PR -> pass (no false positive) (GOL-1999)',
    setup: {
      eventName: 'merge_group',
      reviews: [review({ state: 'APPROVED', commit_id: HEAD })],
      groupFiles: [{ filename: PROT, patch: PATCH_A }],
    },
    pass: true,
  },
  {
    name: 'MERGE_GROUP SAME-FILE: reordered hunks, same +/- content -> pass (line-shift tolerant) (GOL-1999)',
    setup: {
      eventName: 'merge_group',
      reviews: [review({ state: 'APPROVED', commit_id: HEAD })],
      // named PR patch has two added lines; the merge-group diff presents the
      // SAME two added lines in the opposite hunk order (a benign shift). The
      // signature sorts +/- lines, so it must still match.
      prPatch: '@@ -1,1 +1,2 @@\n a\n+first\n@@ -9,1 +10,2 @@\n b\n+second',
      groupFiles: [
        { filename: PROT, patch: '@@ -9,1 +10,2 @@\n b\n+second\n@@ -1,1 +1,2 @@\n a\n+first' },
      ],
    },
    pass: true,
  },
  {
    name: 'MERGE_GROUP SAME-FILE: protected file patch missing from merge-group diff -> fail closed (unprovable) (GOL-1999)',
    setup: {
      eventName: 'merge_group',
      reviews: [review({ state: 'APPROVED', commit_id: HEAD })],
      groupFiles: [{ filename: PROT, patch: undefined }],
    },
    pass: false,
    expect: /not covered by the SHA-bound approval|unprovable|CONTENT/,
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
