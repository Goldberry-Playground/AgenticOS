#!/usr/bin/env node
// Behavioural tests for scripts/agent-git/open-pr.mjs — arm auto-merge as the
// App at PR-open time (steady state for GOL-3118 / GOL-2524; the arm-sweep
// timer of GOL-3125 is the backstop).
// Run: `node scripts/ci/agent-git-open-pr.test.mjs`
//
// What is under test is not "does it call the mutation" — it is "does it apply
// exactly the guardrails of infra/scripts/vendored/merge-queue-arm-automerge.sh
// and nothing looser": App-authored only, no drafts, never re-arm someone
// else's, never an unapproved protected-path PR without the board override,
// fail-closed on any lookup it cannot trust. The protected-path cases run the
// REAL scripts/ci/protected-paths-carveout.mjs from this repo as the fetched
// base-branch carve-out, so the glob semantics are the live ones.
//
// Hermetic: GitHub is a fake fetch, the token mint is injected, nothing touches
// the network or the broker.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  API,
  CARVEOUT_PATH,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_SKIPPED,
  EXIT_USAGE,
  armPullRequest,
  classify,
  createPullRequest,
  describeErrors,
  main,
  parseArgs,
  parseRepo,
  protectedStatus,
} from "../agent-git/open-pr.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_CARVEOUT = readFileSync(join(HERE, "protected-paths-carveout.mjs"), "utf8");
const APP = "agenticos-developer";
const TOKEN = "ghs_SECRET_TOKEN_MUST_NEVER_BE_PRINTED";

// ── fixtures ────────────────────────────────────────────────────────────────
// A freshly opened agent PR: author is the App, no review yet, mergeable not
// computed (UNKNOWN is what a cold query reads), two harmless files.
const basePr = (over = {}) => ({
  number: 42,
  id: "PR_kwDOexample",
  headRefOid: "0123456789abcdef0123456789abcdef01234567",
  baseRefName: "main",
  isDraft: false,
  state: "OPEN",
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "UNKNOWN",
  author: { login: APP },
  autoMergeRequest: null,
  mergeQueueEntry: null,
  files: { totalCount: 2, nodes: [{ path: "README.md" }, { path: "packages/x/src/a.ts" }] },
  ...over,
});

/**
 * Fake GitHub: routes GraphQL reads/mutations, the base-branch carve-out fetch
 * and the REST PR create, and records every call so a test can assert that a
 * guardrail produced NO mutation — the property that matters.
 */
function fakeGithub({ pr = basePr(), carveout = REAL_CARVEOUT, mutation, create, prErrors } = {}) {
  const calls = { creates: [], mutations: [], carveoutRefs: [], queries: [], auth: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || "GET";
    calls.auth.push(opts.headers?.Authorization || "");
    if (u === `${API}/graphql`) {
      const { query, variables } = JSON.parse(opts.body);
      if (query.trimStart().startsWith("mutation")) {
        calls.mutations.push(variables);
        return json(200, mutation ?? {
          data: { enablePullRequestAutoMerge: { pullRequest: { number: pr.number, autoMergeRequest: { enabledBy: { login: APP } } } } },
        });
      }
      calls.queries.push(variables);
      return json(200, { data: { repository: { pullRequest: pr } }, ...(prErrors ? { errors: prErrors } : {}) });
    }
    if (method === "GET" && u.includes(`/contents/${CARVEOUT_PATH}?ref=`)) {
      calls.carveoutRefs.push(decodeURIComponent(u.split("?ref=")[1]));
      if (carveout == null) return json(404, { message: "Not Found" });
      return new Response(carveout, { status: 200, headers: { "content-type": "application/vnd.github.raw" } });
    }
    if (method === "POST" && u.endsWith("/pulls")) {
      const body = JSON.parse(opts.body);
      calls.creates.push(body);
      return json(201, create ?? { number: pr.number, html_url: `https://github.com/o/n/pull/${pr.number}`, draft: Boolean(body.draft) });
    }
    return json(404, { message: `unexpected ${method} ${u}` });
  };
  return { fetch, calls };
}

function harness(gh) {
  const logs = [];
  const out = [];
  const ctx = { token: TOKEN, fetch: gh.fetch, log: (m) => logs.push(m) };
  const deps = { fetch: gh.fetch, mintToken: async () => TOKEN, log: (m) => logs.push(m), stdout: (s) => out.push(s), env: {}, retryDelaysMs: [0, 0] };
  return { ctx, deps, logs, out };
}

const armed = (gh, opts = {}) => armPullRequest(harness(gh).ctx, { owner: "o", name: "n", number: 42, appLogin: APP, ...opts });

// ── 1. the happy path: a fresh agent PR is armed as the App, SQUASH, pinned head ──
test("fresh App-authored PR on harmless paths is armed with expectedHeadOid", async () => {
  const gh = fakeGithub();
  const h = harness(gh);
  const r = await armPullRequest(h.ctx, { owner: "o", name: "n", number: 42, appLogin: APP });
  assert.equal(r.armed, true);
  assert.equal(r.enabledBy, APP);
  assert.equal(gh.calls.mutations.length, 1, "exactly one enablePullRequestAutoMerge");
  assert.deepEqual(gh.calls.mutations[0], { id: "PR_kwDOexample", oid: basePr().headRefOid },
    "mutation pins the queried head so a racing push fails instead of arming a stale head");
  assert.deepEqual(gh.calls.carveoutRefs, ["main"], "carve-out read from the BASE branch, once");
  assert.ok(h.logs.some((l) => /^armed #42 \(head 012345678\) as agenticos-developer$/.test(l)), h.logs.join("\n"));
  assert.ok(gh.calls.auth.every((a) => a === `Bearer ${TOKEN}`), "every GitHub call carries the App token");
});

test("the carve-out is read from the PR's base branch, not main by assumption and never the head", async () => {
  const gh = fakeGithub({ pr: basePr({ baseRefName: "release/2026-10" }) });
  const r = await armed(gh);
  assert.equal(r.armed, true);
  assert.deepEqual(gh.calls.carveoutRefs, ["release/2026-10"]);
});

// ── 2. guardrails: each one produces NO mutation ────────────────────────────
const noMutation = (gh) => assert.equal(gh.calls.mutations.length, 0, "a guardrail skip must never reach the mutation");

test("draft: skipped, with the follow-up spelled out", async () => {
  const gh = fakeGithub({ pr: basePr({ isDraft: true }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /^draft; .*open-pr\.mjs arm/);
  noMutation(gh);
});

test("not authored by the App (a maintainer's PR): its author decides when it merges", async () => {
  const gh = fakeGithub({ pr: basePr({ author: { login: "EngineeringMoonBear" }, reviewDecision: "APPROVED" }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /authored by EngineeringMoonBear, not agenticos-developer/);
  noMutation(gh);
  assert.equal(gh.calls.carveoutRefs.length, 0, "an APPROVED PR never needs the carve-out");
});

test("APP_AUTHOR_LOGIN is resolved separately from APP_LOGIN", async () => {
  const gh = fakeGithub({ pr: basePr({ author: { login: "other-app" } }) });
  const r = await armed(gh, { appLogin: APP, appAuthorLogin: "other-app" });
  assert.equal(r.armed, true);
});

test("already armed by the App: idempotent, reported as alreadyArmed, no second mutation", async () => {
  const gh = fakeGithub({ pr: basePr({ autoMergeRequest: { enabledBy: { login: APP } } }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.equal(r.alreadyArmed, true);
  noMutation(gh);
});

test("armed by someone else: left alone (re-arming would disable theirs first)", async () => {
  const gh = fakeGithub({ pr: basePr({ autoMergeRequest: { enabledBy: { login: "EngineeringMoonBear" } } }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.equal(r.alreadyArmed, false);
  assert.match(r.reason, /armed by EngineeringMoonBear; leaving it alone/);
  noMutation(gh);
});

test("already in the merge queue: arming cannot fix an existing entry", async () => {
  const gh = fakeGithub({ pr: basePr({ mergeQueueEntry: { id: "MQE_1" } }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /already in the merge queue/);
  noMutation(gh);
});

test("conflicting: skipped; UNKNOWN mergeable is fine", async () => {
  const gh = fakeGithub({ pr: basePr({ mergeable: "CONFLICTING" }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /conflicting/);
  noMutation(gh);
});

test("closed / merged: skipped", async () => {
  const gh = fakeGithub({ pr: basePr({ state: "MERGED" }) });
  const r = await armed(gh);
  assert.match(r.reason, /not open \(state=MERGED\)/);
  noMutation(gh);
});

// ── 3. the protected-path boundary (the only semantic change pre-approval arming makes) ──
test("unapproved PR touching a protected path (real carve-out): NOT pre-armed, names the board override", async () => {
  const gh = fakeGithub({ pr: basePr({ files: { totalCount: 2, nodes: [{ path: "README.md" }, { path: ".github/workflows/ci.yml" }] } }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /unapproved and protected path\(s\) touched/);
  assert.match(r.reason, /\.github\/workflows\/ci\.yml/);
  assert.match(r.reason, /ARM_PROTECTED=1 \(board decision\)/);
  noMutation(gh);
});

test("scripts/ci/** is protected in this repo's carve-out (GOL-2051) — so an edit to this very test is not pre-armed", async () => {
  const gh = fakeGithub({ pr: basePr({ files: { totalCount: 1, nodes: [{ path: "scripts/ci/agent-git-open-pr.test.mjs" }] } }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /scripts\/ci\/agent-git-open-pr\.test\.mjs/);
  noMutation(gh);
});

test("ARM_PROTECTED=1 (board override) pre-arms a protected-path PR and skips the carve-out lookup entirely", async () => {
  const gh = fakeGithub({ pr: basePr({ files: { totalCount: 1, nodes: [{ path: ".github/workflows/ci.yml" }] } }) });
  const r = await armed(gh, { armProtected: true });
  assert.equal(r.armed, true);
  assert.equal(gh.calls.carveoutRefs.length, 0);
});

test("an already-APPROVED protected-path PR is armed: its approval already happened, nothing is left to pre-empt", async () => {
  const gh = fakeGithub({ pr: basePr({ reviewDecision: "APPROVED", files: { totalCount: 1, nodes: [{ path: ".github/workflows/ci.yml" }] } }) });
  const r = await armed(gh);
  assert.equal(r.armed, true);
  assert.equal(gh.calls.carveoutRefs.length, 0, "approved PRs do not consult the carve-out");
});

// ── 4. fail-closed: a lookup that cannot be trusted is a skip, not a finding ──
test("carve-out unavailable on the base branch (404): fail-closed, reason names the lookup not the override", async () => {
  const gh = fakeGithub({ carveout: null });
  const h = harness(gh);
  const r = await armPullRequest(h.ctx, { owner: "o", name: "n", number: 42, appLogin: APP });
  assert.equal(r.skipped, true);
  assert.match(r.reason, /carve-out unavailable/);
  assert.match(r.reason, /fail-closed/);
  assert.doesNotMatch(r.reason, /ARM_PROTECTED=1 \(board decision\) to override/);
  assert.ok(h.logs.some((l) => l.startsWith("WARN could not fetch scripts/ci/protected-paths-carveout.mjs")));
  noMutation(gh);
});

test("changed-file list truncated (totalCount > nodes): fail-closed", async () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({ path: `docs/${i}.md` }));
  const gh = fakeGithub({ pr: basePr({ files: { totalCount: 101, nodes } }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /changes 101 files and only 100 came back/);
  noMutation(gh);
});

test("changed-file list nulled by a partial GraphQL error (EXCESSIVE_PAGINATION-style): fail-closed and the error is logged", async () => {
  const gh = fakeGithub({ pr: basePr({ files: null }), prErrors: [{ type: "EXCESSIVE_PAGINATION", message: "Requesting 300 records exceeds the `first` limit of 100" }] });
  const h = harness(gh);
  const r = await armPullRequest(h.ctx, { owner: "o", name: "n", number: 42, appLogin: APP });
  assert.equal(r.skipped, true);
  assert.match(r.reason, /changed-file list is missing/);
  assert.ok(h.logs.some((l) => l.startsWith("WARN GraphQL partial errors: EXCESSIVE_PAGINATION")));
  noMutation(gh);
});

test("a carve-out that throws (exit != 1, empty stdout) is 'unknown', not 'clear'", () => {
  const broken = "throw new Error('boom');\n";
  const r = protectedStatus(basePr(), broken);
  assert.equal(r.kind, "unknown");
  const exit1NoReason = "process.exit(1);\n";
  assert.equal(protectedStatus(basePr(), exit1NoReason).kind, "unknown", "exit 1 without a reason on stdout is not a finding");
});

test("protectedStatus against the real carve-out: clear vs hit", () => {
  assert.equal(protectedStatus(basePr(), REAL_CARVEOUT).kind, "clear");
  const hit = protectedStatus(basePr({ files: { totalCount: 1, nodes: [{ path: "infra/terraform/github-app.tf" }] } }), REAL_CARVEOUT);
  assert.equal(hit.kind, "hit");
  assert.match(hit.detail, /infra\/terraform\/github-app\.tf/);
});

test("classify() is pure and skips in the documented order: draft before author before queue before armed", () => {
  const opts = { appLogin: APP, protectedStatusOf: () => ({ kind: "clear", detail: "" }) };
  assert.equal(classify(basePr({ isDraft: true, author: { login: "x" } }), opts).reason.split(";")[0], "draft");
  assert.match(classify(basePr({ author: { login: "x" }, autoMergeRequest: { enabledBy: { login: "x" } } }), opts).reason, /^authored by x/);
  assert.match(classify(basePr({ autoMergeRequest: { enabledBy: { login: "x" } } }), { ...opts, queued: new Set([42]) }).reason, /^already in the merge queue/);
  assert.equal(classify(basePr(), opts).action, "arm");
});

// ── 5. GitHub refusing the mutation is reported, not thrown ────────────────
test("mutation refused by GitHub (clean status / stale head): error result, no throw", async () => {
  const gh = fakeGithub({ mutation: { data: { enablePullRequestAutoMerge: null }, errors: [{ type: "UNPROCESSABLE", message: "Pull request is in clean status" }] } });
  const h = harness(gh);
  const r = await armPullRequest(h.ctx, { owner: "o", name: "n", number: 42, appLogin: APP });
  assert.equal(r.armed, false);
  assert.equal(r.error, true);
  assert.match(r.reason, /UNPROCESSABLE: Pull request is in clean status/);
  assert.ok(h.logs.some((l) => l.startsWith("WARN could not arm #42")));
});

test("describeErrors dedupes and caps at three", () => {
  const e = (m) => ({ type: "T", message: m });
  assert.equal(describeErrors([e("a"), e("a"), e("b"), e("c"), e("d")]), "T: a | T: b | T: c | (+1 more)");
  assert.equal(describeErrors([]), "<no error detail>");
});

// ── 6. the CLI contract ─────────────────────────────────────────────────────
test("create: POSTs the PR as the App, arms it, prints the URL on stdout like gh, exits 0", async () => {
  const gh = fakeGithub();
  const h = harness(gh);
  const code = await main(["create", "o/n", "--head", "feat/x", "--title", "feat: x", "--body", "Closes #1"], h.deps);
  assert.equal(code, EXIT_OK);
  assert.deepEqual(gh.calls.creates, [{ title: "feat: x", head: "feat/x", base: "main", body: "Closes #1", draft: false }]);
  assert.equal(gh.calls.mutations.length, 1, "armed in the same breath");
  assert.deepEqual(h.out, ["https://github.com/o/n/pull/42"]);
  assert.ok(h.logs.some((l) => l.startsWith("created o/n#42 ")));
});

test("create --draft: creates, does not arm, still exits 0 and says what to do next", async () => {
  const gh = fakeGithub({ pr: basePr({ isDraft: true }) });
  const h = harness(gh);
  const code = await main(["create", "o/n", "--head", "feat/x", "--title", "wip", "--draft", "--json"], h.deps);
  assert.equal(code, EXIT_OK);
  assert.equal(gh.calls.creates[0].draft, true);
  assert.equal(gh.calls.mutations.length, 0);
  const j = JSON.parse(h.out[0]);
  assert.equal(j.draft, true);
  assert.equal(j.arm.armed, false);
  assert.match(j.arm.reason, /^draft;/);
  assert.ok(h.logs.some((l) => l.includes("is NOT armed") && l.includes("backstop")));
});

test("create: an arm failure after a successful create is NOT fatal (a retry would open a duplicate PR)", async () => {
  const gh = fakeGithub({ mutation: { errors: [{ type: "UNPROCESSABLE", message: "nope" }] } });
  const h = harness(gh);
  const code = await main(["create", "o/n", "--head", "b", "--title", "t"], h.deps);
  assert.equal(code, EXIT_OK);
  assert.deepEqual(h.out, ["https://github.com/o/n/pull/42"]);
  assert.ok(h.logs.some((l) => l.startsWith("WARN could not arm #42")));
});

test("create: a failed create surfaces GitHub's message and nothing is armed", async () => {
  const gh = fakeGithub();
  const orig = gh.fetch;
  gh.fetch = async (u, o) => (String(u).endsWith("/pulls") ? new Response(JSON.stringify({ message: "Validation Failed", errors: [{ message: "No commits between main and feat/x" }] }), { status: 422 }) : orig(u, o));
  const h = harness(gh);
  await assert.rejects(main(["create", "o/n", "--head", "feat/x", "--title", "t"], h.deps), /POST \/repos\/o\/n\/pulls -> 422: Validation Failed \(No commits between main and feat\/x\)/);
  assert.equal(gh.calls.mutations.length, 0);
});

test("create --body-file reads the body (and '-' means stdin via the seam)", async () => {
  const gh = fakeGithub();
  const h = harness(gh);
  h.deps.readFile = (f) => (f === "-" ? "from stdin" : `from ${f}`);
  await main(["create", "o/n", "--head", "b", "--title", "t", "--body-file", "pr.md"], h.deps);
  assert.equal(gh.calls.creates[0].body, "from pr.md");
  await main(["create", "o/n", "--head", "b", "--title", "t", "--body-file", "-"], h.deps);
  assert.equal(gh.calls.creates[1].body, "from stdin");
});

test("create --dry-run creates nothing and needs no token", async () => {
  const gh = fakeGithub();
  const h = harness(gh);
  h.deps.mintToken = async () => { throw new Error("must not mint"); };
  const code = await main(["create", "o/n", "--head", "b", "--title", "t", "--dry-run"], h.deps);
  assert.equal(code, EXIT_OK);
  assert.equal(gh.calls.creates.length, 0);
  assert.ok(h.logs.some((l) => l.startsWith("DRY-RUN would create o/n PR main <- b: t")));
});

test("arm: exit 0 armed, 0 already-armed-by-App, 3 guardrail skip, 1 GitHub refusal", async () => {
  assert.equal(await main(["arm", "o/n", "42"], harness(fakeGithub()).deps), EXIT_OK);
  assert.equal(await main(["arm", "o/n", "42"], harness(fakeGithub({ pr: basePr({ autoMergeRequest: { enabledBy: { login: APP } } }) })).deps), EXIT_OK);
  assert.equal(await main(["arm", "o/n", "42"], harness(fakeGithub({ pr: basePr({ isDraft: true }) })).deps), EXIT_SKIPPED);
  assert.equal(await main(["arm", "o/n", "42"], harness(fakeGithub({ pr: basePr({ author: { login: "human" } }) })).deps), EXIT_SKIPPED);
  assert.equal(await main(["arm", "o/n", "42"], harness(fakeGithub({ mutation: { errors: [{ message: "nope" }] } })).deps), EXIT_ERROR);
});

test("arm --dry-run classifies but never mutates; --json prints the decision", async () => {
  const gh = fakeGithub();
  const h = harness(gh);
  const code = await main(["arm", "o/n", "42", "--dry-run", "--json"], h.deps);
  assert.equal(code, EXIT_OK);
  assert.equal(gh.calls.mutations.length, 0);
  const j = JSON.parse(h.out[0]);
  assert.equal(j.dryRun, true);
  assert.match(j.reason, /^eligible/);
});

test("ARM_PROTECTED=1 in the env is the board override and is announced", async () => {
  const gh = fakeGithub({ pr: basePr({ files: { totalCount: 1, nodes: [{ path: ".github/workflows/ci.yml" }] } }) });
  const h = harness(gh);
  h.deps.env = { ARM_PROTECTED: "1" };
  assert.equal(await main(["arm", "o/n", "42"], h.deps), EXIT_OK);
  assert.equal(gh.calls.mutations.length, 1);
  assert.ok(h.logs.some((l) => l.startsWith("ARM_PROTECTED=1 — board override set")));
});

test("APP_LOGIN / APP_AUTHOR_LOGIN env are honoured by the CLI", async () => {
  const gh = fakeGithub({ pr: basePr({ author: { login: "other-app" }, autoMergeRequest: { enabledBy: { login: "other-app" } } }) });
  const h = harness(gh);
  h.deps.env = { APP_LOGIN: "other-app" };
  assert.equal(await main(["arm", "o/n", "42"], h.deps), EXIT_OK, "already armed by the configured App login");
  assert.equal(gh.calls.mutations.length, 0);
});

test("usage errors exit 2 without touching GitHub or the broker", async () => {
  const gh = fakeGithub();
  const h = harness(gh);
  h.deps.mintToken = async () => { throw new Error("must not mint"); };
  assert.equal(await main([], h.deps), EXIT_USAGE);
  assert.equal(await main(["frobnicate", "o/n"], h.deps), EXIT_USAGE);
  assert.equal(await main(["create", "o/n", "--title", "t"], h.deps), EXIT_USAGE, "missing --head");
  assert.equal(await main(["create", "o/n", "--head", "b"], h.deps), EXIT_USAGE, "missing --title");
  assert.equal(await main(["create", "o/n", "--head", "b", "--title", "t", "--body", "x", "--body-file", "f"], h.deps), EXIT_USAGE);
  assert.equal(await main(["arm", "o/n"], h.deps), EXIT_USAGE, "missing number");
  assert.equal(await main(["arm", "o/n", "abc"], h.deps), EXIT_USAGE);
  assert.equal(await main(["arm", "not-a-repo", "1"], h.deps), EXIT_USAGE);
  assert.equal(await main(["arm", "o/n/extra", "1"], h.deps), EXIT_USAGE);
  assert.equal(await main(["create", "o/n", "--head"], h.deps), EXIT_USAGE, "dangling flag");
  assert.equal(gh.calls.creates.length + gh.calls.mutations.length + gh.calls.queries.length, 0);
});

test("the App token is never written to stdout or the log", async () => {
  const gh = fakeGithub({ mutation: { errors: [{ message: "nope" }] } });
  const h = harness(gh);
  await main(["create", "o/n", "--head", "b", "--title", "t", "--json"], h.deps);
  await main(["arm", "o/n", "42", "--json"], h.deps);
  const everything = [...h.logs, ...h.out].join("\n");
  assert.ok(!everything.includes(TOKEN), "token leaked into output");
  assert.ok(!everything.includes("ghs_"), "token prefix leaked into output");
});

test("parseArgs / parseRepo", () => {
  assert.deepEqual(parseArgs(["create", "o/n", "--head=feat/x", "--draft", "--title", "a b"]),
    { cmd: "create", positional: ["o/n"], flags: { head: "feat/x", draft: true, title: "a b" } });
  assert.deepEqual(parseRepo("Goldberry-Playground/odoocker-goldberrygrove"), { owner: "Goldberry-Playground", name: "odoocker-goldberrygrove" });
  assert.throws(() => parseRepo("owner"), /expected <owner>\/<repo>/);
  assert.throws(() => parseRepo("bad owner/x"), /invalid GitHub owner/);
  assert.throws(() => parseRepo("o/bad repo"), /invalid GitHub repo/);
});

test("createPullRequest returns number, url and draft from the REST response", async () => {
  const gh = fakeGithub({ create: { number: 7, html_url: "https://github.com/o/n/pull/7", draft: true } });
  const r = await createPullRequest(harness(gh).ctx, { owner: "o", name: "n", head: "b", base: "main", title: "t", body: "", draft: true });
  assert.deepEqual(r, { number: 7, url: "https://github.com/o/n/pull/7", draft: true });
});

test("protectedStatus runs the carve-out from its REAL path: a symlinked tmpdir must not read as 'clear'", () => {
  // The carve-out only runs its CLI when import.meta.url === pathToFileURL(argv[1]);
  // node realpaths the module URL, argv[1] is verbatim. With tmpdir behind a
  // symlink (macOS /var -> /private/var) the module loads as a library, exits 0
  // with no output, and a protected path would read as clear — fail-open.
  const real = mkdtempSync(join(realpathSync(tmpdir()), "open-pr-real-"));
  const link = join(realpathSync(tmpdir()), `open-pr-link-${process.pid}`);
  symlinkSync(real, link);
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = link;
  try {
    assert.equal(realpathSync(tmpdir()), real, "precondition: tmpdir() now resolves through the symlink");
    const r = protectedStatus(basePr({ files: { totalCount: 1, nodes: [{ path: ".github/workflows/ci.yml" }] } }), REAL_CARVEOUT);
    assert.equal(r.kind, "hit");
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    rmSync(link, { force: true });
    rmSync(real, { recursive: true, force: true });
  }
});

// ── 7. hardening from review ────────────────────────────────────────────────
test("an empty changed-file list (diff not computed yet) is 'unknown', never 'clear'", async () => {
  assert.equal(protectedStatus(basePr({ files: { totalCount: 0, nodes: [] } }), REAL_CARVEOUT).kind, "unknown");
  const gh = fakeGithub({ pr: basePr({ files: { totalCount: 0, nodes: [] } }) });
  const r = await armed(gh);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /changed-file list is empty/);
  noMutation(gh);
});

test("a carve-out that exits 0 in silence is 'unknown' — only the documented clear line counts", () => {
  assert.equal(protectedStatus(basePr(), "process.exit(0);\n").kind, "unknown");
  assert.equal(protectedStatus(basePr(), "").kind, "unknown");
  assert.equal(protectedStatus(basePr(), REAL_CARVEOUT).kind, "clear", "the real one prints on clear");
});

test("the carve-out runs with a minimal env and a cwd outside the worktree", () => {
  const seen = [];
  const runNode = (file, env, cwd) => { seen.push({ file, env, cwd }); return { status: 0, stdout: "carve-out clear" }; };
  assert.equal(protectedStatus(basePr(), REAL_CARVEOUT, runNode).kind, "clear");
  assert.deepEqual(Object.keys(seen[0].env).sort(), ["HOME", "PATH", "PR_FILES", "TMPDIR"]);
  assert.equal(seen[0].env.PR_FILES, "README.md\npackages/x/src/a.ts");
  assert.equal(seen[0].cwd, dirname(seen[0].file));
  assert.ok(!("GH_BROKER_API_KEY_FILE" in seen[0].env), "nothing from the agent env leaks into the fetched script");
});

test("a carve-out run that times out or fails to spawn (r.error) is 'unknown'", () => {
  const runNode = () => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }) });
  const r = protectedStatus(basePr(), REAL_CARVEOUT, runNode);
  assert.equal(r.kind, "unknown");
  assert.match(r.detail, /could not run \(ETIMEDOUT\)/);
});

test("create: a transport blip or not-yet-visible PR on the post-create read is retried, then armed", async () => {
  const gh = fakeGithub();
  const orig = gh.fetch;
  let reads = 0;
  gh.fetch = async (u, o) => {
    if (String(u).endsWith("/graphql") && !JSON.parse(o.body).query.trimStart().startsWith("mutation")) {
      reads++;
      if (reads === 1) throw new TypeError("fetch failed");
      if (reads === 2) return new Response(JSON.stringify({ data: { repository: { pullRequest: null } } }), { status: 200 });
    }
    return orig(u, o);
  };
  const h = harness(gh);
  const code = await main(["create", "o/n", "--head", "b", "--title", "t", "--json"], h.deps);
  assert.equal(code, EXIT_OK);
  assert.equal(reads, 3);
  assert.equal(gh.calls.mutations.length, 1);
  assert.equal(JSON.parse(h.out[0]).arm.armed, true);
  assert.equal(h.logs.filter((l) => /retry \d\/2$/.test(l)).length, 2);
});

test("create: retries are for throws only — a guardrail skip is final, and after the budget the create still exits 0", async () => {
  const gh = fakeGithub({ pr: basePr({ isDraft: true }) });
  const h = harness(gh);
  assert.equal(await main(["create", "o/n", "--head", "b", "--title", "t"], h.deps), EXIT_OK);
  assert.equal(gh.calls.queries.length, 1, "no retry on a skip");
  const gh2 = fakeGithub();
  gh2.fetch = async (u, o) => { if (String(u).endsWith("/graphql")) throw new TypeError("fetch failed"); return fakeGithub().fetch(u, o); };
  const h2 = harness(gh2);
  assert.equal(await main(["create", "o/n", "--head", "b", "--title", "t", "--json"], h2.deps), EXIT_OK);
  assert.equal(JSON.parse(h2.out[0]).arm.error, true);
  assert.ok(h2.logs.some((l) => l.startsWith("WARN could not arm #42")));
});

test("create: a 422 'already exists' names the arm follow-up", async () => {
  const gh = fakeGithub();
  const orig = gh.fetch;
  gh.fetch = async (u, o) => (String(u).endsWith("/pulls") ? new Response(JSON.stringify({ message: "Validation Failed", errors: [{ message: "A pull request already exists for o:b." }] }), { status: 422 }) : orig(u, o));
  const h = harness(gh);
  await assert.rejects(main(["create", "o/n", "--head", "b", "--title", "t"], h.deps), /422/);
  assert.ok(h.logs.some((l) => l.includes("arm it with: open-pr.mjs arm o/n <number>")));
});

test("APP_AUTHOR_LOGIN via the CLI env is honoured separately from APP_LOGIN", async () => {
  const gh = fakeGithub({ pr: basePr({ author: { login: "other-app" } }) });
  const h = harness(gh);
  h.deps.env = { APP_AUTHOR_LOGIN: "other-app" };
  assert.equal(await main(["arm", "o/n", "42"], h.deps), EXIT_OK);
  assert.equal(gh.calls.mutations.length, 1);
});

test("ARM_PROTECTED is only the literal '1'", async () => {
  for (const v of ["true", "yes", "0", ""]) {
    const gh = fakeGithub({ pr: basePr({ files: { totalCount: 1, nodes: [{ path: ".github/workflows/ci.yml" }] } }) });
    const h = harness(gh);
    h.deps.env = { ARM_PROTECTED: v };
    assert.equal(await main(["arm", "o/n", "42"], h.deps), EXIT_SKIPPED, `ARM_PROTECTED=${JSON.stringify(v)}`);
  }
});
