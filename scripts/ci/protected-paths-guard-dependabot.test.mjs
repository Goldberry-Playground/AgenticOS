#!/usr/bin/env node
// Behavioral tests for the Dependabot `uses:`-only carve-out in the
// protected-paths guard (GOL-1905). Run:
//   node scripts/ci/protected-paths-guard-dependabot.test.mjs
//
// The carve-out lets a Dependabot action bump pass the (otherwise Tier-0)
// protected-paths guard WITHOUT a human SHA-bound approval, but ONLY when the
// change is narrow enough that it cannot become a workflow-edit backdoor. This
// test extracts the exact `usesOnlyWorkflowBump` predicate out of the shipped
// guard workflow (the same code github-script runs) and asserts the acceptance
// matrix — so a future generator edit that widens or breaks the carve-out fails
// CI here. The predicate is a pure function of (prUser, changedFiles), so it can
// be pulled from the YAML and evaluated standalone.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  join(here, '..', '..', '.github', 'workflows', 'protected-paths-guard.yml'),
  'utf8'
);

// Extract `function usesOnlyWorkflowBump(...) { … }` verbatim from the guard,
// delimited by the `// end-usesOnlyWorkflowBump` sentinel that ships beside it.
function extractPredicate(src) {
  const startMarker = 'function usesOnlyWorkflowBump(prUser, changedFiles) {';
  const endMarker = '// end-usesOnlyWorkflowBump';
  const i = src.indexOf(startMarker);
  assert.ok(i !== -1, 'guard has no usesOnlyWorkflowBump');
  const j = src.indexOf(endMarker, i);
  assert.ok(j !== -1, 'guard has no end-usesOnlyWorkflowBump sentinel');
  const body = src
    .slice(i, j)
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn usesOnlyWorkflowBump;`)();
}
const usesOnlyWorkflowBump = extractPredicate(workflow);

const DBOT = { login: 'dependabot[bot]', type: 'Bot' };

// A realistic single-action bump patch (the codeql-action bump from #628-shape).
const usesBumpPatch = [
  '@@ -12,7 +12,7 @@ jobs:',
  '       - name: Run CodeQL',
  '-        uses: github/codeql-action@f0000000000000000000000000000000000000aa # v4.37.8',
  '+        uses: github/codeql-action@f0000000000000000000000000000000000000bb # v4.37.9',
  '         with:',
].join('\n');

// Same, but the action is written as a YAML sequence item (`- uses:`).
const usesSeqPatch = [
  '@@ -3,3 +3,3 @@ runs:',
  '   steps:',
  '-    - uses: actions/checkout@1111111111111111111111111111111111111111 # v4',
  '+    - uses: actions/checkout@2222222222222222222222222222222222222222 # v5',
].join('\n');

// A patch that ALSO edits a non-`uses:` line (a `permissions:` grant).
const mixedPatch = [
  '@@ -1,6 +1,7 @@',
  ' name: CI',
  ' permissions:',
  '-  contents: read',
  '+  contents: write',
  '-        uses: actions/checkout@1111111111111111111111111111111111111111 # v4',
  '+        uses: actions/checkout@2222222222222222222222222222222222222222 # v5',
].join('\n');

const wf = (patch, extra = {}) => ({
  filename: '.github/workflows/ci.yml',
  status: 'modified',
  patch,
  ...extra,
});

// ── AC1: a Dependabot action bump passes the guard ──────────────────────────
assert.equal(
  usesOnlyWorkflowBump(DBOT, [wf(usesBumpPatch)]),
  true,
  'AC1: dependabot uses:-only bump must pass'
);
assert.equal(
  usesOnlyWorkflowBump(DBOT, [{ filename: '.github/workflows/reusable/x.yml', status: 'modified', patch: usesSeqPatch }]),
  true,
  'AC1: YAML `- uses:` sequence form must pass'
);

// ── AC2: any other author touching a workflow does NOT get the carve-out ────
for (const author of [
  { login: 'agenticos-developer[bot]', type: 'Bot' },
  { login: 'EngineeringMoonBear', type: 'User' },
  { login: 'dependabot[bot]', type: 'User' }, // right name, wrong (spoofable) type
  { login: 'dependabot', type: 'Bot' }, // short spelling is not the PR-author login
  null,
]) {
  assert.equal(
    usesOnlyWorkflowBump(author, [wf(usesBumpPatch)]),
    false,
    `AC2: author ${JSON.stringify(author)} must NOT get the carve-out`
  );
}

// ── AC3: a Dependabot PR editing a non-`uses:` line still fails ─────────────
assert.equal(
  usesOnlyWorkflowBump(DBOT, [wf(mixedPatch)]),
  false,
  'AC3: a non-uses: changed line (permissions:) must fail the carve-out'
);

// ── Fail-closed on everything ambiguous ─────────────────────────────────────
// A non-workflow file in the same PR.
assert.equal(
  usesOnlyWorkflowBump(DBOT, [wf(usesBumpPatch), { filename: 'package.json', status: 'modified', patch: '@@\n-x\n+y' }]),
  false,
  'a non-workflow file in the change set must fail'
);
// A newly-added or removed or renamed workflow file (whole-file, not a pin bump).
for (const status of ['added', 'removed', 'renamed', 'copied', 'changed']) {
  assert.equal(
    usesOnlyWorkflowBump(DBOT, [wf(usesBumpPatch, { status })]),
    false,
    `status='${status}' must fail (only 'modified' is a pin bump)`
  );
}
// A binary/too-large file with no patch to inspect.
assert.equal(
  usesOnlyWorkflowBump(DBOT, [{ filename: '.github/workflows/ci.yml', status: 'modified', patch: undefined }]),
  false,
  'a missing patch must fail closed'
);
// No files at all.
assert.equal(usesOnlyWorkflowBump(DBOT, []), false, 'empty change set must fail');
// A `run:` line that merely mentions "uses:" as text must not slip through.
assert.equal(
  usesOnlyWorkflowBump(DBOT, [wf('@@ -1,1 +1,1 @@\n-        run: echo "uses: x"\n+        run: echo "uses: y"')]),
  false,
  'a run: line quoting "uses:" must fail'
);

console.log('protected-paths-guard-dependabot: all assertions passed');
