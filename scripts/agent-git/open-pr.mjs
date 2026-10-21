#!/usr/bin/env node
// open-pr.mjs — open an agent PR and ARM AUTO-MERGE AS THE APP in the same breath.
// Dependency-free (Node built-ins only); runs from the read-only mount at
// /paperclip/agent-git/ inside paperclip-server, next to github-app-token.mjs.
//
// WHY (GOL-2524 → GOL-3118 → GOL-3125 → this)
//
// GitHub never creates workflow runs for events triggered by the default Actions
// `GITHUB_TOKEN`. With a merge queue on `main`, auto-approve.yml's
// `gh pr merge --squash` is an ENQUEUE, and an enqueue made on `GITHUB_TOKEN`
// builds a merge group that no `merge_group` workflow ever runs on: no required
// check reports, GitHub ejects the PR unmerged, and because the queue is
// sequential that one dead entry stalls every healthy entry behind it (GOL-2524).
//
// GOL-3118 measured the fix: AUTO-MERGE INHERITS THE IDENTITY OF WHOEVER ARMED
// IT. Arm a PR as the agent App and the enqueue GitHub performs later carries the
// App identity and creates runs normally. GOL-3125 added a 5-minute host timer
// (infra/scripts/merge-queue-arm-sweep.sh) that sweeps open agent PRs and arms
// them. That timer is the BACKSTOP — and five minutes is too slow to be the
// steady state: on 2026-10-21 odoocker-goldberrygrove #924 and #925 were opened,
// bot-approved and bot-enqueued within ~3 minutes, before any tick saw them, and
// both built dead groups.
//
// The steady state the arm-sweep runbook asks for is "whatever opens an agent PR
// arms it in the same breath, with the broker-minted App token the agent already
// holds". That is this file: the agent-side counterpart of the sweep, applying
// the same guardrails as infra/scripts/vendored/merge-queue-arm-automerge.sh:
//
//   - only PRs AUTHORED BY THE APP. auto-approve.yml approves maintainer PRs but
//     never enqueues them, so a human keeps control over WHEN their PR merges;
//     arming theirs would take that away.
//   - never a DRAFT. GitHub rejects enablePullRequestAutoMerge on a draft, and a
//     draft is an explicit "not yet" from its author.
//   - never RE-ARM a PR someone else armed: that would mean disabling theirs
//     first, silently taking a merge decision away from its owner.
//   - never a PR already IN THE QUEUE (arming cannot fix an existing entry) and
//     never a CONFLICTING one.
//   - never pre-arm an UNAPPROVED PR that touches the TARGET repo's PROTECTED
//     PATHS, as defined by the BASE branch's scripts/ci/protected-paths-carveout.mjs
//     (never the PR head, so a PR cannot edit the carve-out to un-protect
//     itself) — unless the board override ARM_PROTECTED=1 is set. auto-approve.yml
//     withholds its approval there and a human reviews by hand; pre-arming would
//     make that human's approval BE the merge. Fail-closed: a carve-out that
//     cannot be fetched or run, or a truncated changed-file list, skips the arm
//     rather than guessing.
//
// This bypasses NO gate. Auto-merge is GitHub's own mechanism and still requires
// every required review and every required status check before it merges.
// Arming only decides WHO enqueues the PR, not WHETHER it may merge.
//
// USAGE (node builtins only — no `gh`, no install)
//
//   node /paperclip/agent-git/open-pr.mjs create <owner>/<repo> \
//        --head <branch> [--base main] --title "…" (--body "…" | --body-file <f>|-) \
//        [--draft] [--json] [--dry-run]
//     Creates the PR through the REST API as the App, then arms it. Prints the
//     PR URL on stdout (the `gh pr create` contract); the arm outcome goes to
//     stderr. Exits 0 whenever the PR was created — an arm skip or failure is
//     reported, never fatal, so a retry can never open a duplicate PR.
//     --draft creates the PR but cannot arm it: run `arm` after `gh pr ready`.
//
//   node /paperclip/agent-git/open-pr.mjs arm <owner>/<repo> <number> [--dry-run] [--json]
//     Arms an existing PR — one opened with `gh pr create`, or a draft you just
//     marked ready. Exit 0 = armed (or already armed by the App), 3 = skipped by
//     a guardrail (reason on stderr), 1 = error. --json prints the decision.
//
// ENV
//   GH_TOKEN_BROKER_URL, GH_BROKER_API_KEY_FILE
//                     read by github-app-token.mjs, which this file shells out to
//                     for a repo-scoped App token (never printed, never logged)
//   APP_LOGIN         arming identity to recognise         (default agenticos-developer)
//   APP_AUTHOR_LOGIN  PR-author login that may be armed    (default $APP_LOGIN)
//   ARM_PROTECTED=1   board override: also pre-arm unapproved protected-path PRs.
//                     HONOUR-SYSTEM here: it is read from the agent's own env, so
//                     unlike the host sweep (whose root wrapper REFUSES it) nothing
//                     stops an agent setting it. Do not set it without the board's
//                     sign-off; every required review and check still applies.
//   OPEN_PR_DRY_RUN=1 same as --dry-run
//
// Do NOT run this from a GitHub Actions job on the default GITHUB_TOKEN: that is
// the identity that causes the wedge, so it would arm as `github-actions` and
// rebuild the same dead group. It has no broker access there anyway.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const API = "https://api.github.com";
export const DEFAULT_APP_LOGIN = "agenticos-developer";
/** Path of the Tier-0 carve-out every Goldberry repo ships, read from the BASE branch. */
export const CARVEOUT_PATH = "scripts/ci/protected-paths-carveout.mjs";
/** `files(first:N)` caps at 100 server-side and truncates silently above it. */
export const FILES_PAGE = 100;

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_SKIPPED = 3;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const HERE = dirname(fileURLToPath(import.meta.url));

const defaultLog = (m) => process.stderr.write(`[open-pr] ${m}\n`);

export function parseRepo(s) {
  const [owner, name, ...rest] = String(s || "").split("/");
  if (!owner || !name || rest.length) throw new Error(`expected <owner>/<repo>, got '${s || ""}'`);
  if (!OWNER_RE.test(owner)) throw new Error(`invalid GitHub owner: '${owner}'`);
  if (!REPO_RE.test(name)) throw new Error(`invalid GitHub repo: '${name}'`);
  return { owner, name };
}

/**
 * Mint a repo-scoped App installation token by shelling out to the credential
 * helper next to this file. Reuses its broker client (bearer key file, retry
 * with backoff on broker restarts, disk cache) rather than re-implementing it,
 * and keeps a single place that knows how to talk to gh-token-broker.
 */
export function mintTokenViaHelper(owner, name) {
  const r = spawnSync(process.execPath, [join(HERE, "github-app-token.mjs"), "token", `${owner}/${name}`], {
    encoding: "utf8",
    // Longer than the helper's own worst case (four 15s broker attempts plus
    // 1+3+10s backoff ≈ 74s), so a broker restart surfaces as the helper's
    // message, not as a spawn timeout.
    timeout: 90_000,
  });
  const token = (r.stdout || "").trim();
  if (r.status !== 0 || !token) {
    const why = (r.stderr || "").trim() || (r.error ? r.error.message : `exit ${r.status}`);
    throw new Error(`could not mint an App token for ${owner}/${name}: ${why}`);
  }
  return token;
}

// --- GitHub transport --------------------------------------------------------

function authHeaders(ctx, extra = {}) {
  return {
    Authorization: `Bearer ${ctx.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agenticos-open-pr",
    ...extra,
  };
}

async function rest(ctx, method, path, body) {
  const res = await ctx.fetch(`${API}${path}`, {
    method,
    headers: authHeaders(ctx, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    // GitHub's error bodies are safe to surface (message + field errors), and
    // they are the difference between "head branch not pushed" and "no access".
    const msg = json?.message ? `: ${json.message}` : "";
    const errs = Array.isArray(json?.errors) && json.errors.length
      ? ` (${json.errors.map((e) => e?.message || e?.code || JSON.stringify(e)).join("; ")})`
      : "";
    const err = new Error(`${method} ${path} -> ${res.status}${msg}${errs}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function graphql(ctx, query, variables) {
  const res = await ctx.fetch(`${API}/graphql`, {
    method: "POST",
    headers: authHeaders(ctx, { "Content-Type": "application/json" }),
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`graphql -> ${res.status}: non-JSON response`); }
  if (!res.ok) throw new Error(`graphql -> ${res.status}${json?.message ? `: ${json.message}` : ""}`);
  return json; // { data, errors? } — a GraphQL error is HTTP 200, so callers must look at `errors`
}

/** Dedupe + cap GraphQL errors the way the vendored sweep logs them. */
export function describeErrors(errors) {
  if (!Array.isArray(errors) || !errors.length) return "<no error detail>";
  const seen = new Set();
  const out = [];
  for (const e of errors) {
    const m = `${e?.type || "ERROR"}: ${e?.message || JSON.stringify(e)}`;
    if (!seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out.slice(0, 3).join(" | ") + (out.length > 3 ? ` | (+${out.length - 3} more)` : "");
}

// --- protected-paths carve-out (TARGET repo, BASE branch) -------------------

/**
 * The protected-paths carve-out, read from the TARGET repo's BASE branch — never
 * the PR head, otherwise a PR could edit the carve-out to un-protect itself (the
 * same property auto-approve.yml preserves by checking out base-branch scripts).
 * Every Goldberry repo ships this file at the same path with its own
 * PROTECTED_GLOBS, so a cross-repo arm gets each repo's real definition.
 * Returns the source text, or null when it cannot be fetched (fail-closed).
 */
export async function fetchCarveout(ctx, owner, name, ref) {
  try {
    const res = await ctx.fetch(
      `${API}/repos/${owner}/${name}/contents/${CARVEOUT_PATH}?ref=${encodeURIComponent(ref)}`,
      { headers: authHeaders(ctx, { Accept: "application/vnd.github.raw" }), signal: AbortSignal.timeout(30_000) },
    );
    const text = await res.text();
    if (!res.ok || !text.trim()) return null;
    return text;
  } catch {
    return null;
  }
}

function defaultRunNode(file, env, cwd) {
  return spawnSync(process.execPath, [file], { env, cwd, encoding: "utf8", timeout: 60_000 });
}

/**
 * -> { kind: "clear"|"hit"|"unknown", detail }. Fail-closed: the caller treats
 * "unknown" exactly like "hit", because a false "clear" pre-arms a PR whose
 * human approval would then merge it on the spot. The two are reported
 * separately only so the skip reason names the real cause — being told to set
 * a board-gated override when the actual problem is a failed lookup sends the
 * operator the wrong way.
 */
export function protectedStatus(pr, carveoutSource, runNode = defaultRunNode) {
  if (!carveoutSource) {
    return { kind: "unknown", detail: "its protected-path status is unknown (carve-out unavailable)" };
  }
  const files = pr.files || {};
  const nodes = Array.isArray(files.nodes) ? files.nodes : [];
  const total = files.totalCount;
  if (!Number.isInteger(total)) {
    return { kind: "unknown", detail: "its changed-file list is missing from the GraphQL response" };
  }
  if (total > nodes.length) {
    return {
      kind: "unknown",
      detail: `it changes ${total} files and only ${nodes.length} came back (GitHub caps \`files(first:)\` at ${FILES_PAGE})`,
    };
  }
  // An empty list right after `create` is far more likely "GitHub has not
  // computed the diff yet" than "a PR with no changes" — and an empty PR_FILES
  // makes the carve-out exit 0, which would pre-arm a protected-path PR on a
  // lookup that said nothing. Unknown, not clear.
  if (total === 0 || nodes.length === 0) {
    return { kind: "unknown", detail: "its changed-file list is empty (not computed yet, or an empty PR)" };
  }
  const paths = nodes.map((n) => (n && n.path) || "");
  // realpath, not the path mkdtemp returned: the carve-out only runs its CLI
  // when `import.meta.url` equals `pathToFileURL(process.argv[1])`, and node
  // resolves the module URL through symlinks while argv[1] is passed verbatim.
  // On a host whose tmpdir is a symlink (macOS /var -> /private/var) the two
  // differ, the module loads as a library, exits 0 with no output — and a
  // protected path would read as "clear". Fail-open by accident; pinned in
  // scripts/ci/agent-git-open-pr.test.mjs.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "protected-paths-carveout-")));
  let r;
  try {
    const file = join(dir, "protected-paths-carveout.mjs");
    writeFileSync(file, carveoutSource, { mode: 0o600 });
    // Minimal env and a cwd outside the agent worktree: the carve-out is code
    // fetched from the target repo's base branch (exactly what the vendored
    // sweep and auto-approve.yml execute too), so give it nothing it does not need.
    r = runNode(file, { PATH: process.env.PATH || "", HOME: process.env.HOME || dir, TMPDIR: dir, PR_FILES: paths.join("\n") }, dir);
  } catch (e) {
    return { kind: "unknown", detail: `the protected-path check could not run (${e?.name || "error"})` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!r || r.error) {
    return { kind: "unknown", detail: `the protected-path check could not run (${r?.error?.code || r?.error?.name || "error"})` };
  }
  const stdout = (r.stdout || "").trim();
  const detail = (stdout || (r.stderr || "").trim()).replace(/\n/g, " ").slice(0, 220);
  // exit 0 WITH its "carve-out clear" line is the documented clear. Exit 0 and
  // SILENCE is the signature of the module loading as a library instead of
  // running its CLI (see the realpath note above) — every Goldberry carve-out
  // prints on the clear path, so silence is a check that did not run.
  if (r.status === 0 && stdout) return { kind: "clear", detail: "" };
  if (r.status === 0) return { kind: "unknown", detail: "the protected-path check exited 0 without reporting (did its CLI run?)" };
  // exit 1 WITH a reason on stdout is the carve-out's documented "protected path
  // touched". Any other non-zero, or a throw (empty stdout), is a check we could
  // not trust — not a finding.
  if (r.status === 1 && stdout) return { kind: "hit", detail };
  return { kind: "unknown", detail: detail || `the protected-path check exited ${r.status}` };
}

// --- the decision ------------------------------------------------------------

const skip = (reason, extra = {}) => ({ action: "skip", reason, ...extra });

/**
 * -> { action: "arm"|"skip", reason, alreadyArmed? }. Conservative in every
 * unclear case. Mirrors `classify()` in the vendored sweep with
 * ARM_UNAPPROVED=1 (the only setting under which arming at PR-open time is
 * useful — by the time a PR is approved, auto-approve.yml has already enqueued
 * it on GITHUB_TOKEN, which is the wedge).
 */
export function classify(pr, { appLogin, appAuthorLogin = appLogin, armProtected = false, queued = new Set(), protectedStatusOf }) {
  if (pr.state !== "OPEN") return skip(`not open (state=${pr.state})`);
  if (pr.isDraft) return skip("draft; GitHub cannot arm a draft — run `open-pr.mjs arm` once it is marked ready");
  const author = pr.author?.login;
  if (author !== appAuthorLogin) {
    return skip(`authored by ${author}, not ${appAuthorLogin}; its author decides when it merges`);
  }
  if (queued.has(pr.number)) {
    return skip("already in the merge queue — use merge-queue-rescue.sh if its group is dead");
  }
  const amr = pr.autoMergeRequest;
  if (amr) {
    const who = amr.enabledBy?.login;
    if (who === appLogin) return skip(`already armed by ${appLogin}`, { alreadyArmed: true });
    return skip(`armed by ${who}; leaving it alone`);
  }
  // CONFLICTING is the only mergeable value we refuse. UNKNOWN just means GitHub
  // has not computed the merge commit yet (most freshly opened PRs read UNKNOWN)
  // — arming is still correct, and expectedHeadOid makes a racing push fail the
  // mutation rather than arm a stale head.
  if (pr.mergeable === "CONFLICTING") return skip("conflicting; resolve the conflict first");
  if (pr.reviewDecision !== "APPROVED" && !armProtected) {
    const { kind, detail } = protectedStatusOf(pr);
    if (kind === "hit") {
      return skip(`unapproved and ${detail}; pre-arming would make a human reviewer's approval the merge itself — ARM_PROTECTED=1 (board decision) to override`);
    }
    if (kind !== "clear") {
      return skip(`unapproved and ${detail}; skipping fail-closed rather than pre-arm on an unestablished protected-path status`);
    }
  }
  return { action: "arm", reason: `eligible (reviewDecision=${pr.reviewDecision}, mergeable=${pr.mergeable})` };
}

// --- operations ----------------------------------------------------------------

const PR_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      number id headRefOid baseRefName isDraft state reviewDecision mergeable
      author{login}
      autoMergeRequest{enabledBy{login}}
      mergeQueueEntry{id}
      files(first:${FILES_PAGE}){totalCount nodes{path}}
    }
  }
}`;

const ARM_MUTATION = `mutation($id:ID!,$oid:GitObjectID!){
  enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH,expectedHeadOid:$oid}){
    pullRequest{number autoMergeRequest{enabledBy{login}}}
  }
}`;

/**
 * Arm auto-merge (squash) on one PR as the App, subject to every guardrail.
 * Never throws for a GitHub refusal of the mutation itself (clean status, stale
 * head, queue race) — that is reported as `{ error: true }` so a caller that
 * just created the PR does not treat it as a failed creation.
 * -> { number, armed, alreadyArmed?, skipped?, dryRun?, error?, reason, enabledBy? }
 */
export async function armPullRequest(ctx, {
  owner, name, number,
  appLogin = DEFAULT_APP_LOGIN, appAuthorLogin = appLogin,
  armProtected = false, dryRun = false,
}) {
  const g = await graphql(ctx, PR_QUERY, { owner, name, number });
  const pr = g.data?.repository?.pullRequest;
  if (!pr) throw new Error(`GraphQL returned no pull request for ${owner}/${name}#${number}: ${describeErrors(g.errors)}`);
  // A GraphQL error comes back HTTP 200 and a partially-nulled response reads
  // like real data (the vendored sweep hit EXCESSIVE_PAGINATION this way) —
  // say it out loud; fail-closed below handles the nulled fields.
  if (g.errors?.length) ctx.log(`WARN GraphQL partial errors: ${describeErrors(g.errors)}`);

  const queued = new Set(pr.mergeQueueEntry ? [pr.number] : []);
  let carveout = null;
  if (pr.reviewDecision !== "APPROVED" && !armProtected) {
    carveout = await fetchCarveout(ctx, owner, name, pr.baseRefName || "main");
    if (carveout) ctx.log(`protected-paths carve-out: ${owner}/${name}@${pr.baseRefName} (${Buffer.byteLength(carveout)} bytes)`);
    else ctx.log(`WARN could not fetch ${CARVEOUT_PATH} from ${owner}/${name}@${pr.baseRefName}; an unapproved PR will be skipped fail-closed`);
  }

  const decision = classify(pr, {
    appLogin, appAuthorLogin, armProtected, queued,
    protectedStatusOf: (p) => protectedStatus(p, carveout, ctx.runNode),
  });
  const head = String(pr.headRefOid || "").slice(0, 9);
  if (decision.action === "skip") {
    ctx.log(`skip #${pr.number}: ${decision.reason}`);
    return { number: pr.number, armed: false, skipped: true, alreadyArmed: Boolean(decision.alreadyArmed), reason: decision.reason };
  }
  if (dryRun) {
    ctx.log(`DRY-RUN would arm #${pr.number} (head ${head}) as ${appLogin}`);
    return { number: pr.number, armed: false, dryRun: true, reason: decision.reason };
  }
  // expectedHeadOid: if the head moved since the query, the mutation fails
  // instead of arming a head nobody has reviewed.
  const m = await graphql(ctx, ARM_MUTATION, { id: pr.id, oid: pr.headRefOid });
  const result = m.data?.enablePullRequestAutoMerge?.pullRequest;
  if (m.errors?.length || !result) {
    const why = describeErrors(m.errors);
    ctx.log(`WARN could not arm #${pr.number}: ${why}`);
    return { number: pr.number, armed: false, error: true, reason: why };
  }
  const enabledBy = result.autoMergeRequest?.enabledBy?.login || appLogin;
  ctx.log(`armed #${pr.number} (head ${head}) as ${enabledBy}`);
  return { number: pr.number, armed: true, enabledBy, reason: decision.reason };
}

/** Create the PR through the REST API (as the App). -> { number, url, draft } */
export async function createPullRequest(ctx, { owner, name, head, base, title, body, draft }) {
  const pr = await rest(ctx, "POST", `/repos/${owner}/${name}/pulls`, {
    title, head, base, body: body ?? "", draft: Boolean(draft),
  });
  return { number: pr.number, url: pr.html_url, draft: Boolean(pr.draft) };
}

// --- CLI -----------------------------------------------------------------------

const BOOL_FLAGS = new Set(["draft", "json", "dry-run"]);

export function parseArgs(argv) {
  const out = { cmd: argv[0], positional: [], flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out.positional.push(a); continue; }
    const eq = a.indexOf("=");
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (BOOL_FLAGS.has(key)) { out.flags[key] = true; continue; }
    const val = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (val === undefined) throw new Error(`--${key} needs a value`);
    out.flags[key] = val;
  }
  return out;
}

function usage(log) {
  log([
    "usage:",
    "  open-pr.mjs create <owner>/<repo> --head <branch> [--base main] --title <t> (--body <b> | --body-file <f>|-) [--draft] [--json] [--dry-run]",
    "  open-pr.mjs arm    <owner>/<repo> <number> [--dry-run] [--json]",
    "env: APP_LOGIN, APP_AUTHOR_LOGIN, ARM_PROTECTED=1 (board override), OPEN_PR_DRY_RUN=1",
  ].join("\n"));
  return EXIT_USAGE;
}

/**
 * CLI entry. `deps` is a test seam: { fetch, mintToken, log, stdout, runNode, env, readFile }.
 * Returns the process exit code.
 */
export async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || defaultLog;
  const stdout = deps.stdout || ((s) => process.stdout.write(`${s}\n`));
  const readFile = deps.readFile || ((f) => readFileSync(f === "-" ? 0 : f, "utf8"));

  let parsed;
  try { parsed = parseArgs(argv); } catch (e) { log(e.message); return usage(log); }
  const { cmd, positional, flags } = parsed;
  if (cmd !== "create" && cmd !== "arm") return usage(log);

  let owner, name;
  try { ({ owner, name } = parseRepo(positional[0])); } catch (e) { log(e.message); return usage(log); }

  const appLogin = (env.APP_LOGIN || DEFAULT_APP_LOGIN).trim();
  const appAuthorLogin = (env.APP_AUTHOR_LOGIN || appLogin).trim();
  const armProtected = env.ARM_PROTECTED === "1";
  const dryRun = Boolean(flags["dry-run"]) || env.OPEN_PR_DRY_RUN === "1";
  const armOpts = { owner, name, appLogin, appAuthorLogin, armProtected, dryRun };

  if (cmd === "create") {
    const head = flags.head;
    const base = flags.base || "main";
    const title = flags.title;
    if (!head || !title) { log("create needs --head and --title"); return usage(log); }
    if (flags.body !== undefined && flags["body-file"] !== undefined) { log("use --body or --body-file, not both"); return usage(log); }
    let body = flags.body ?? "";
    if (flags["body-file"] !== undefined) {
      try { body = readFile(flags["body-file"]); } catch (e) { log(`cannot read --body-file: ${e.message}`); return EXIT_ERROR; }
    }
    if (dryRun) {
      log(`DRY-RUN would create ${owner}/${name} PR ${base} <- ${head}: ${title}${flags.draft ? " (draft)" : ""}, then arm it as ${appLogin}`);
      return EXIT_OK;
    }
    const ctx = await buildCtx(deps, owner, name, log);
    if (armProtected) log("ARM_PROTECTED=1 — board override set (honour-system on the agent side): protected-path PRs will be pre-armed too");
    let created;
    try {
      created = await createPullRequest(ctx, { owner, name, head, base, title, body, draft: Boolean(flags.draft) });
    } catch (e) {
      if (e.status === 422 && /already exists/i.test(e.message)) {
        log(`${e.message} — a PR for ${head} is already open; arm it with: open-pr.mjs arm ${owner}/${name} <number>`);
      }
      throw e;
    }
    log(`created ${owner}/${name}#${created.number} ${created.url}${created.draft ? " (draft)" : ""}`);
    // The seconds right after create are the race this tool exists to close, so
    // a transport blip, 5xx or a read that lands before the PR is visible
    // (`pullRequest: null`) is retried here — never a guardrail skip or a
    // GitHub refusal of the mutation, which come back as results, not throws.
    const delays = deps.retryDelaysMs || [1000, 2000];
    let arm;
    for (let attempt = 0; ; attempt++) {
      try {
        arm = await armPullRequest(ctx, { ...armOpts, number: created.number });
        break;
      } catch (e) {
        if (attempt < delays.length) {
          log(`WARN arming #${created.number} failed (${e.message}) — retry ${attempt + 1}/${delays.length}`);
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        // The PR exists; never let an arm failure read as a failed create (a
        // retry would open a duplicate). Say so and leave it to the backstop.
        log(`WARN could not arm #${created.number}: ${e.message}`);
        arm = { number: created.number, armed: false, error: true, reason: e.message };
        break;
      }
    }
    if (!arm.armed && !arm.alreadyArmed) {
      log(`#${created.number} is NOT armed — the merge-queue arm-sweep timer (every 5 min) is the backstop; ` +
          "if auto-approve.yml enqueues first, that group is dead (GOL-2524)");
    }
    if (flags.json) stdout(JSON.stringify({ ...created, arm }));
    else stdout(created.url);
    return EXIT_OK;
  }

  // arm
  const number = Number(positional[1]);
  if (!Number.isInteger(number) || number <= 0) { log("arm needs a PR number"); return usage(log); }
  const ctx = await buildCtx(deps, owner, name, log);
  if (armProtected) log("ARM_PROTECTED=1 — board override set (honour-system on the agent side): protected-path PRs will be pre-armed too");
  const arm = await armPullRequest(ctx, { ...armOpts, number });
  if (flags.json) stdout(JSON.stringify(arm));
  if (arm.armed || arm.alreadyArmed || arm.dryRun) return EXIT_OK;
  if (arm.skipped) return EXIT_SKIPPED;
  return EXIT_ERROR;
}

async function buildCtx(deps, owner, name, log) {
  const mint = deps.mintToken || mintTokenViaHelper;
  const token = await mint(owner, name);
  return { token, fetch: deps.fetch || globalThis.fetch, log, runNode: deps.runNode || defaultRunNode };
}

// Only when executed directly, not when imported by the test (pathToFileURL so a
// script path needing URL-encoding still matches, mirroring protected-paths-carveout.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { defaultLog(e?.message || String(e)); process.exit(EXIT_ERROR); },
  );
}
