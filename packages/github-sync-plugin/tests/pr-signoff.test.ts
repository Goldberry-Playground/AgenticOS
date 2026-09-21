import { describe, it, expect, vi } from "vitest";
import type { Issue } from "@paperclipai/plugin-sdk";
import { evaluateSignoffGate, isSignoffGateGreen, REQUIRED_REVIEWERS } from "../src/pr-review.js";
import { handleReviewSignoff } from "../src/pr-signoff.js";
import type { SyncConfig, SyncDeps, SyncLogger } from "../src/sync.js";
import type { GitHubClient } from "../src/github-client.js";
import { upsertReviewRecord, type PrReviewRow } from "../src/pr-review-store.js";
import type { MappingDb } from "../src/mapping.js";

// --- pure gate truth table -------------------------------------------------------

describe("evaluateSignoffGate — Phase 3 merge gate (GOL-186)", () => {
  it("ada-only PR: ada done → ada green", () => {
    expect(evaluateSignoffGate({ adaDone: true, irisPresent: false, irisDone: false })).toEqual(["ada"]);
  });

  it("ada-only PR: ada not done → nothing", () => {
    expect(evaluateSignoffGate({ adaDone: false, irisPresent: false, irisDone: false })).toEqual([]);
  });

  it("ada+iris: iris pending/blocked → ada still green (advisory iris never withholds ada, GOL-2390)", () => {
    expect(evaluateSignoffGate({ adaDone: true, irisPresent: true, irisDone: false })).toEqual(["ada"]);
  });

  it("ada+iris: iris done, ada pending → iris green only", () => {
    expect(evaluateSignoffGate({ adaDone: false, irisPresent: true, irisDone: true })).toEqual(["iris"]);
  });

  it("ada+iris: both done → both green (converges regardless of order)", () => {
    expect(evaluateSignoffGate({ adaDone: true, irisPresent: true, irisDone: true })).toEqual(["iris", "ada"]);
  });
});

describe("isSignoffGateGreen — merge gate on REQUIRED reviewers only (GOL-2390)", () => {
  it("required set is ada alone", () => {
    expect(REQUIRED_REVIEWERS).toEqual(["ada"]);
  });

  it("ada done, iris pending/blocked → merge gate green", () => {
    expect(isSignoffGateGreen({ adaDone: true, irisPresent: true, irisDone: false })).toBe(true);
  });

  it("ada pending, iris done → merge gate NOT green", () => {
    expect(isSignoffGateGreen({ adaDone: false, irisPresent: true, irisDone: true })).toBe(false);
  });

  it("ada-only PR tracks ada", () => {
    expect(isSignoffGateGreen({ adaDone: true, irisPresent: false, irisDone: false })).toBe(true);
    expect(isSignoffGateGreen({ adaDone: false, irisPresent: false, irisDone: false })).toBe(false);
  });
});

// --- handler wiring --------------------------------------------------------------

const CONFIG: SyncConfig = {
  githubRepo: "AgenticOS", // bare repo name used for the check-run API path
  syncLabelPaperclip: "synced-from-paperclip",
  syncMarkerGithub: "synced-from-github",
};
const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };
const REPO = "EngineeringMoonBear/AgenticOS"; // row's owner/repo (display)
const PR = 295;

function makeStoreDb(): MappingDb {
  const rows = new Map<string, PrReviewRow>();
  const pk = (repo: string, pr: number, reviewer: string) => `${repo}|${pr}|${reviewer}`;
  const toRaw = (r: PrReviewRow) => ({
    github_repo: r.githubRepo,
    pr_number: r.prNumber,
    reviewer: r.reviewer,
    head_sha: r.headSha,
    paperclip_issue_id: r.paperclipIssueId,
    updated_at: r.updatedAt,
  });
  return {
    namespace: "plugin_github_sync_test",
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/WHERE paperclip_issue_id = \$1/i.test(sql)) {
        const id = String(params?.[0]);
        for (const r of rows.values()) if (r.paperclipIssueId === id) return [toRaw(r) as T];
        return [];
      }
      if (/WHERE github_repo = \$1 AND pr_number = \$2 AND reviewer = \$3/i.test(sql)) {
        const r = rows.get(pk(String(params?.[0]), Number(params?.[1]), String(params?.[2])));
        return r ? [toRaw(r) as T] : [];
      }
      return [];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (/INSERT INTO/i.test(sql)) {
        const [repo, pr, reviewer, headSha, issueId, updatedAt] = params ?? [];
        rows.set(pk(String(repo), Number(pr), String(reviewer)), {
          githubRepo: String(repo),
          prNumber: Number(pr),
          reviewer: String(reviewer),
          headSha: String(headSha),
          paperclipIssueId: String(issueId),
          updatedAt: String(updatedAt),
        });
      }
      return { rowCount: 1 };
    },
  };
}

const ADA_SHA = "adae0000000000000000000000000000000000da";
const IRIS_SHA = "1715e0000000000000000000000000000000001a";

async function seedRows(
  db: MappingDb,
  opts: { iris?: boolean; adaHead?: string; irisHead?: string } = {},
): Promise<void> {
  await upsertReviewRecord(db, {
    githubRepo: REPO,
    prNumber: PR,
    reviewer: "ada",
    headSha: opts.adaHead ?? ADA_SHA,
    paperclipIssueId: "pi-ada",
    updatedAt: "2026-07-09T00:00:00Z",
  });
  if (opts.iris) {
    await upsertReviewRecord(db, {
      githubRepo: REPO,
      prNumber: PR,
      reviewer: "iris",
      headSha: opts.irisHead ?? IRIS_SHA,
      paperclipIssueId: "pi-iris",
      updatedAt: "2026-07-09T00:00:00Z",
    });
  }
}

/** getIssue backed by a status map keyed on issue id. */
function issueGetter(statuses: Record<string, Issue["status"]>) {
  return async (issueId: string): Promise<Issue | null> => {
    const status = statuses[issueId];
    if (!status) return null;
    return { id: issueId, companyId: "co-1", title: "Review", description: "", status } as Issue;
  };
}

function makeDeps(
  db: MappingDb,
  statuses: Record<string, Issue["status"]>,
  createCheckRun: ReturnType<typeof vi.fn>,
  postOpsPing?: ReturnType<typeof vi.fn>,
  getPull?: ReturnType<typeof vi.fn>,
): SyncDeps {
  return {
    db,
    github: { createCheckRun, getPull: getPull ?? openPull() } as unknown as GitHubClient,
    config: CONFIG,
    logger: silentLogger,
    getIssue: issueGetter(statuses),
    postOpsPing,
  };
}

const okCheck = () => vi.fn().mockResolvedValue({ ok: true, data: { id: 1 } });
/** getPull stub: PR still open (the check genuinely gates it). */
const openPull = () =>
  vi.fn().mockResolvedValue({ ok: true, data: { state: "open", merged: false, number: PR } });
/** getPull stub: PR merged (sign-off is moot — no gate). */
const mergedPull = () =>
  vi.fn().mockResolvedValue({ ok: true, data: { state: "closed", merged: true, number: PR } });

describe("handleReviewSignoff", () => {
  it("ignores an issue with no review record (a mirror issue)", async () => {
    const db = makeStoreDb();
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-mirror": "done" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-mirror", companyId: "co-1" });
    expect(createCheckRun).not.toHaveBeenCalled();
  });

  it("does nothing when the review issue is not `done` (e.g. reopened todo)", async () => {
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-ada": "todo" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });
    expect(createCheckRun).not.toHaveBeenCalled();
  });

  it("ada-only PR: ada done → posts agent-review/ada success on ada's head SHA", async () => {
    const db = makeStoreDb();
    await seedRows(db); // no iris
    const createCheckRun = okCheck();
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    const [repo, input] = createCheckRun.mock.calls[0];
    expect(repo).toBe("AgenticOS"); // bare repo, not owner/repo
    expect(input).toMatchObject({ name: "agent-review/ada", headSha: ADA_SHA, conclusion: "success" });
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("agent-review/ada"));
  });

  it("ada+iris, ada signs off with iris BLOCKED → posts agent-review/ada only (GOL-2390 Defect B)", async () => {
    const db = makeStoreDb();
    await seedRows(db, { iris: true });
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-ada": "done", "pi-iris": "blocked" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(createCheckRun.mock.calls[0][1]).toMatchObject({
      name: "agent-review/ada",
      headSha: ADA_SHA,
      conclusion: "success",
    });
  });

  it("ada+iris, iris closes last with ada already done → posts BOTH on their own head SHAs", async () => {
    const db = makeStoreDb();
    await seedRows(db, { iris: true });
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-ada": "done", "pi-iris": "done" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-iris", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(2);
    const byName = Object.fromEntries(createCheckRun.mock.calls.map(([, i]) => [i.name, i]));
    expect(byName["agent-review/iris"]).toMatchObject({ headSha: IRIS_SHA, conclusion: "success" });
    expect(byName["agent-review/ada"]).toMatchObject({ headSha: ADA_SHA, conclusion: "success" });
  });

  it("ada+iris both green in one event → ONE ✅ ping naming both checks (noise collapse, 2026-08-01)", async () => {
    const db = makeStoreDb();
    await seedRows(db, { iris: true });
    const createCheckRun = okCheck();
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-ada": "done", "pi-iris": "done" }, createCheckRun, ping);
    await handleReviewSignoff(deps, { issueId: "pi-iris", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(2); // both checks still posted
    expect(ping).toHaveBeenCalledTimes(1); // but ONE ping, not one per reviewer
    expect(ping.mock.calls[0]![0]).toContain("agent-review/iris");
    expect(ping.mock.calls[0]![0]).toContain("agent-review/ada");
  });

  it("ada+iris, iris signs off first with ada pending → posts iris only", async () => {
    const db = makeStoreDb();
    await seedRows(db, { iris: true });
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-ada": "todo", "pi-iris": "done" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-iris", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(createCheckRun.mock.calls[0][1]).toMatchObject({ name: "agent-review/iris", conclusion: "success" });
  });

  it("pings a pipeline error (with status) on a DEFINITIVE 403 (checks:write revoked) on an OPEN PR", async () => {
    // 403 = permission genuinely lost — a real stuck gate that must alert (GOL-802).
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, error: "Resource not accessible by integration" });
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping, openPull());
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("pipeline error"), "error");
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"), "error"); // status surfaced in the ping
  });

  it("MUTES the alert on a transient 401 (broker-token blip) on an OPEN PR — the retry self-heals", async () => {
    // GOL-802: a ~12:45–12:50Z broker-token 401 window fired 59 🔥 pings across 5
    // open PRs before the retry loop greened the checks. A 401 is transient — the
    // next issue.updated re-posts once the token recovers — so no 🔥.
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = vi.fn().mockResolvedValue({ ok: false, status: 401, error: "Bad credentials" });
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping, openPull());
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(ping).not.toHaveBeenCalled();
  });

  it("MUTES the alert on a transport-level failure (no HTTP status) on an OPEN PR", async () => {
    // A network error / timeout / token-broker throw leaves no status — transient.
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = vi.fn().mockResolvedValue({ ok: false, error: "request timed out after 8000ms" });
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping, openPull());
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(ping).not.toHaveBeenCalled();
  });

  it("pings on a DEFINITIVE non-missing-commit 422 on an OPEN PR (real payload/validation bug)", async () => {
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 422, error: "Validation Failed (custom.some_field)" });
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping, openPull());
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("HTTP 422"), "error");
  });

  // --- GOL-798: merged/closed PR must be greened (not stranded), GOL-781: no false alarm

  it("posts success on an already-merged PR whose head still exists (backfills the strand)", async () => {
    // GOL-798: the gate commonly greens AFTER the PR merges (coupled ada+iris gate,
    // agent reviewer's in_progress→done). GitHub records a check-run on a merged
    // PR's live head, so we post it and drive the stuck-pending check to terminal
    // success instead of stranding it in_progress (which blocks Phase 3 merges).
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = okCheck();
    const ping = vi.fn().mockResolvedValue(undefined);
    const getPull = mergedPull();
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping, getPull);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(createCheckRun.mock.calls[0][1]).toMatchObject({ conclusion: "success" });
    expect(getPull).not.toHaveBeenCalled(); // no pre-merge short-circuit; post is attempted directly
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("agent-review/ada"));
  });

  it("skips silently (no alert) when the reviewed head no longer exists (superseded/deleted)", async () => {
    // GOL-781: a synchronize/force-push or deleted branch leaves a stale row head →
    // GitHub 422 "No commit found for SHA". Nothing to gate → benign, no 🔥 alarm.
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 422, error: "No commit found for SHA: deadbeef" });
    const ping = vi.fn().mockResolvedValue(undefined);
    const getPull = mergedPull();
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping, getPull);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(getPull).not.toHaveBeenCalled(); // missing-commit is classified before the getPull fallback
    expect(ping).not.toHaveBeenCalled(); // benign, no false alarm
  });

  it("mutes the failure alert when a non-missing-commit post fails but the PR is merged/closed", async () => {
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = vi.fn().mockResolvedValue({ ok: false, status: 500, error: "HTTP 500" });
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping, mergedPull());
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(ping).not.toHaveBeenCalled(); // PR no longer open → moot → no alert
  });

  it("still posts normally on an OPEN PR (getPull pre-check does not block the happy path)", async () => {
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = okCheck();
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-ada": "done" }, createCheckRun, ping, openPull());
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("agent-review/ada"));
  });
});

// --- shared-project bridge collision ----------------------------------------------
//
// Two bridges can point at ONE paperclipProjectId (live case: grove-odoo-modules and
// odoocker-goldberrygrove both feed project 7cc88cd5…). depsByProject then holds the
// LAST bridge's github/config, so completing via deps.config.githubRepo posted
// grove-odoo-modules sign-offs to odoocker-goldberrygrove → "No commit found for SHA"
// (PRs #44/#46, 2026-07-23) — and aimed the GOL-781 getPull gate at the wrong repo's
// PR number, which can silently swallow the completion. The completion must derive
// client + repo from the review ROW's stored owner/repo slug via resolveRepoClient.

const GROVE_SLUG = "Goldberry-Playground/grove-odoo-modules";
const GROVE_SHA = "9fc49ff43eae9a9ee981005c5d01baa9e8f99961";

/** Deps as the collided bridge would build them: config/github = the WRONG repo. */
function makeCollidedDeps(
  db: MappingDb,
  statuses: Record<string, Issue["status"]>,
  wrongGithub: { createCheckRun: ReturnType<typeof vi.fn>; getPull: ReturnType<typeof vi.fn> },
  resolveRepoClient: SyncDeps["resolveRepoClient"],
  postOpsPing?: ReturnType<typeof vi.fn>,
): SyncDeps {
  return {
    db,
    github: wrongGithub as unknown as GitHubClient,
    config: { ...CONFIG, githubRepo: "odoocker-goldberrygrove" },
    logger: silentLogger,
    getIssue: issueGetter(statuses),
    postOpsPing,
    resolveRepoClient,
  };
}

async function seedGroveRow(db: MappingDb): Promise<void> {
  await upsertReviewRecord(db, {
    githubRepo: GROVE_SLUG,
    prNumber: 46,
    reviewer: "ada",
    headSha: GROVE_SHA,
    paperclipIssueId: "pi-ada",
    updatedAt: "2026-07-23T00:00:00Z",
  });
}

describe("handleReviewSignoff — two bridges sharing one paperclipProjectId", () => {
  it("posts via the client resolved from the ROW's repo slug, not the collided bridge config", async () => {
    const db = makeStoreDb();
    await seedGroveRow(db);
    const wrong = { createCheckRun: okCheck(), getPull: openPull() };
    const right = { createCheckRun: okCheck(), getPull: openPull() };
    const resolver: SyncDeps["resolveRepoClient"] = (slug) =>
      slug.toLowerCase() === GROVE_SLUG.toLowerCase()
        ? { github: right as unknown as GitHubClient, repo: "grove-odoo-modules" }
        : null;
    const deps = makeCollidedDeps(db, { "pi-ada": "done" }, wrong, resolver);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    // The collided bridge's client is never consulted. Under GOL-798 we always
    // attempt the post (no pre-merge getPull short-circuit), so on success no
    // getPull happens at all — the failure path's closed-PR probe would use the
    // resolved client, which the "muted failure still resolves the right repo"
    // case below pins down.
    expect(wrong.createCheckRun).not.toHaveBeenCalled();
    expect(wrong.getPull).not.toHaveBeenCalled();
    expect(right.getPull).not.toHaveBeenCalled();
    expect(right.createCheckRun).toHaveBeenCalledTimes(1);
    const [repo, input] = right.createCheckRun.mock.calls[0];
    expect(repo).toBe("grove-odoo-modules");
    expect(input).toMatchObject({ name: "agent-review/ada", headSha: GROVE_SHA, conclusion: "success" });
  });

  it("muted failure still resolves the right repo: the closed-PR probe uses the ROW's client, not the collided one", async () => {
    const db = makeStoreDb();
    await seedGroveRow(db);
    const wrong = { createCheckRun: okCheck(), getPull: openPull() };
    const right = {
      createCheckRun: vi.fn().mockResolvedValue({ ok: false, status: 500, error: "HTTP 500" }),
      getPull: mergedPull(),
    };
    const ping = vi.fn().mockResolvedValue(undefined);
    const resolver: SyncDeps["resolveRepoClient"] = (slug) =>
      slug.toLowerCase() === GROVE_SLUG.toLowerCase()
        ? { github: right as unknown as GitHubClient, repo: "grove-odoo-modules" }
        : null;
    const deps = makeCollidedDeps(db, { "pi-ada": "done" }, wrong, resolver, ping);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    // Failure path probes PR state on the RESOLVED client/repo (a collided-config
    // probe would read the WRONG repo's #46 and mis-classify), sees merged → mutes.
    expect(wrong.getPull).not.toHaveBeenCalled();
    expect(right.getPull).toHaveBeenCalledWith("grove-odoo-modules", 46);
    expect(ping).not.toHaveBeenCalled();
  });

  it("resolver miss (row repo no longer bridged) → 🔥-pings and posts nothing to a guessed repo", async () => {
    const db = makeStoreDb();
    await seedGroveRow(db);
    const wrong = { createCheckRun: okCheck(), getPull: openPull() };
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeCollidedDeps(db, { "pi-ada": "done" }, wrong, () => null, ping);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(wrong.createCheckRun).not.toHaveBeenCalled();
    expect(wrong.getPull).not.toHaveBeenCalled();
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("pipeline error"), "error");
    expect(ping).toHaveBeenCalledWith(expect.stringContaining(GROVE_SLUG), "error");
  });

  it("no resolver wired (legacy deps): falls back to the row slug's bare repo name on deps.github", async () => {
    const db = makeStoreDb();
    await seedGroveRow(db);
    const github = { createCheckRun: okCheck(), getPull: openPull() };
    const deps = makeCollidedDeps(db, { "pi-ada": "done" }, github, undefined);
    await handleReviewSignoff(deps, { issueId: "pi-ada", companyId: "co-1" });

    expect(github.createCheckRun).toHaveBeenCalledTimes(1);
    expect(github.createCheckRun.mock.calls[0][0]).toBe("grove-odoo-modules"); // parsed from the row, NOT config
  });
});
