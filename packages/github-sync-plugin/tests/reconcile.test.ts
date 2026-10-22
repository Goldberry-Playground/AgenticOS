import { describe, it, expect, vi } from "vitest";
import type { Issue } from "@paperclipai/plugin-sdk";
import { runMirrorReconcile, buildReconcilePing } from "../src/reconcile.js";
import { prReviewMarker } from "../src/pr-review.js";
import { ciFixMarker } from "../src/ci-failure.js";
import type { SyncConfig, SyncDeps, SyncLogger } from "../src/sync.js";
import type { GitHubClient } from "../src/github-client.js";
import { getByPaperclipId, upsert, type MappingDb, type MappingRow } from "../src/mapping.js";

const CONFIG: SyncConfig = {
  githubRepo: "target-repo",
  syncLabelPaperclip: "synced-from-paperclip",
  syncMarkerGithub: "synced-from-github",
};
const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };
const PROJECT = "proj-1";

function makeFakeDb(): MappingDb & { rows: Map<string, MappingRow> } {
  const rows = new Map<string, MappingRow>();
  return {
    namespace: "plugin_github_sync_test",
    rows,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/WHERE paperclip_issue_id = \$1/i.test(sql)) {
        const row = rows.get(String(params?.[0]));
        if (!row) return [];
        return [
          {
            paperclip_issue_id: row.paperclipIssueId,
            github_repo: row.githubRepo,
            github_issue_number: row.githubIssueNumber,
            last_synced_at: row.lastSyncedAt,
            origin: row.origin,
          } as T,
        ];
      }
      return [];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (/INSERT INTO/i.test(sql)) {
        const [id, repo, num, syncedAt, origin] = params ?? [];
        rows.set(String(id), {
          paperclipIssueId: String(id),
          githubRepo: String(repo),
          githubIssueNumber: Number(num),
          lastSyncedAt: String(syncedAt),
          origin: origin === "github" ? "github" : "paperclip",
        });
      }
      return { rowCount: 1 };
    },
  };
}

let issueSeq = 0;
function makeIssue(overrides: Partial<Issue>): Issue {
  issueSeq += 1;
  return {
    id: `pi-${issueSeq}`,
    companyId: "co-1",
    title: `Issue ${issueSeq}`,
    description: "Some work item",
    status: "todo",
    identifier: `GOL-${issueSeq}`,
    ...overrides,
  } as Issue;
}

function makeDeps(db: MappingDb, issues: Issue[], createIssue = okCreate()): SyncDeps {
  return {
    db,
    github: { createIssue } as unknown as GitHubClient,
    config: CONFIG,
    logger: silentLogger,
    getIssue: async (issueId) => issues.find((i) => i.id === issueId) ?? null,
  };
}

const okCreate = () => {
  let n = 100;
  return vi.fn().mockImplementation(async () => ({ ok: true, data: { number: ++n } }));
};

function sweep(
  db: MappingDb,
  issues: Issue[],
  deps: SyncDeps,
  opts: { maxCreates?: number } = {},
) {
  return runMirrorReconcile({
    companyId: "co-1",
    projectIds: [PROJECT],
    listIssues: async (_p, status, offset, limit) =>
      issues.filter((i) => i.status === status).slice(offset, offset + limit),
    depsForProject: () => deps,
    logger: silentLogger,
    ...opts,
  });
}

describe("runMirrorReconcile", () => {
  it("mirrors active unmapped issues and records mappings", async () => {
    const db = makeFakeDb();
    const issues = [makeIssue({}), makeIssue({})];
    const create = okCreate();
    const deps = makeDeps(db, issues, create);
    const s = await sweep(db, issues, deps);

    expect(s).toMatchObject({ scanned: 2, created: 2, failed: 0, capped: false });
    expect(create).toHaveBeenCalledTimes(2);
    for (const i of issues) expect(await getByPaperclipId(db, i.id)).not.toBeNull();
  });

  it("skips already-mapped, terminal, and plugin-operational issues", async () => {
    const db = makeFakeDb();
    const mapped = makeIssue({});
    await upsert(db, {
      paperclipIssueId: mapped.id,
      githubRepo: "target-repo",
      githubIssueNumber: 7,
      lastSyncedAt: "2026-07-01T00:00:00Z",
      origin: "paperclip",
    });
    const issues = [
      mapped,
      makeIssue({ status: "done" }),
      makeIssue({ status: "cancelled" }),
      makeIssue({ description: `Review body\n${prReviewMarker("o/r", 5, "abc")}` }),
      makeIssue({ description: `Fix body\n${ciFixMarker("o/r", 9)}` }),
      makeIssue({}), // the one real candidate
    ];
    const create = okCreate();
    const s = await sweep(db, issues, makeDeps(db, issues, create));

    // done/cancelled are no longer SCANNED at all — ACTIVE_STATUSES never asks
    // the host for them, which is the whole point of the per-status queries.
    expect(s).toMatchObject({
      scanned: 4,
      created: 1,
      skippedMapped: 1,
      skippedTerminal: 0,
      skippedPluginOp: 2,
      failed: 0,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("records inbound-marker issues as github-origin mappings without pushing back out", async () => {
    const db = makeFakeDb();
    const inbound = makeIssue({ description: "From GH\n<!-- synced-from-github: owner/repo#42 -->" });
    const create = okCreate();
    const s = await sweep(db, [inbound], makeDeps(db, [inbound], create));

    expect(create).not.toHaveBeenCalled(); // provenance recorded, no outbound create
    expect(s.created).toBe(1); // mapping row now exists — backfilled
    expect((await getByPaperclipId(db, inbound.id))?.origin).toBe("github");
  });

  it("caps ATTEMPTS per run and reports capped so the next run continues", async () => {
    const db = makeFakeDb();
    const issues = [makeIssue({}), makeIssue({}), makeIssue({}), makeIssue({})];
    const create = okCreate();
    const s = await sweep(db, issues, makeDeps(db, issues, create), { maxCreates: 2 });

    expect(s.created).toBe(2);
    expect(s.capped).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("counts a GitHub create failure as failed (no mapping row) and keeps sweeping", async () => {
    const db = makeFakeDb();
    const issues = [makeIssue({}), makeIssue({})];
    const create = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "HTTP 502" })
      .mockResolvedValueOnce({ ok: true, data: { number: 900 } });
    const s = await sweep(db, issues, makeDeps(db, issues, create));

    expect(s).toMatchObject({ created: 1, failed: 1 });
    expect(await getByPaperclipId(db, issues[0]!.id)).toBeNull();
    expect(await getByPaperclipId(db, issues[1]!.id)).not.toBeNull();
  });

  it("pages through more than one page WITHIN a status", async () => {
    const db = makeFakeDb();
    // 130 mapped-already rows in ONE active status: paging must cross the
    // 100-row boundary rather than stopping at the first page.
    const issues = Array.from({ length: 130 }, () => makeIssue({ status: "blocked" }));
    for (const i of issues) {
      await upsert(db, {
        paperclipIssueId: i.id,
        githubRepo: "target-repo",
        githubIssueNumber: 1,
        lastSyncedAt: "2026-07-01T00:00:00Z",
        origin: "paperclip",
      });
    }
    issues.push(makeIssue({ status: "todo" })); // the one real candidate
    const create = okCreate();
    const s = await sweep(db, issues, makeDeps(db, issues, create), { maxCreates: 5 });

    expect(s.scanned).toBe(131); // crossed the 100-issue page boundary
    expect(s.skippedMapped).toBe(130);
    expect(s.created).toBe(1);
  });

  it("queries EVERY active status, so a backlog-heavy project is still reached", async () => {
    const db = makeFakeDb();
    const asked: string[] = [];
    const issues = [makeIssue({ status: "backlog" }), makeIssue({ status: "in_review" })];
    const create = okCreate();
    const s = await runMirrorReconcile({
      companyId: "co-1",
      projectIds: [PROJECT],
      listIssues: async (_p, status, offset, limit) => {
        asked.push(status);
        return issues.filter((i) => i.status === status).slice(offset, offset + limit);
      },
      depsForProject: () => makeDeps(db, issues, create),
      logger: silentLogger,
    });

    // The regression this guards: an unfiltered sweep saw ONE 100-row window per
    // project, which on a mature board was ~90% closed work, so the real backlog
    // was never reached (36 issues stranded on 2026-08-05).
    expect(asked).toEqual(["backlog", "todo", "in_progress", "in_review", "blocked"]);
    expect(s.created).toBe(2); // both non-terminal issues mirrored
  });

  it("skips projects with no deps (bridge dropped at setup)", async () => {
    const s = await runMirrorReconcile({
      companyId: "co-1",
      projectIds: ["ghost-project"],
      listIssues: async () => {
        throw new Error("should not list a depless project");
      },
      depsForProject: () => undefined,
      logger: silentLogger,
    });
    expect(s.scanned).toBe(0);
  });
});

describe("buildReconcilePing", () => {
  it("summarizes created/failed/scanned and notes capping", () => {
    const ping = buildReconcilePing({
      scanned: 40,
      created: 20,
      skippedMapped: 10,
      skippedTerminal: 5,
      skippedPluginOp: 5,
      failed: 2,
      capped: true,
    });
    expect(ping).toContain("20 missing GitHub twin(s)");
    expect(ping).toContain("2 failed");
    expect(ping).toContain("capped");
  });
});
