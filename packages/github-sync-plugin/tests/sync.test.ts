import { describe, it, expect, vi } from "vitest";
import type { Issue } from "@paperclipai/plugin-sdk";
import {
  statusToGithubState,
  resolveMirrorClosureStatus,
  detectGithubMarker,
  paperclipMarker,
  buildGithubBody,
  handleIssueCreated,
  handleIssueUpdated,
  isClosedByAnotherRequest,
  pushIssueState,
  resolveMappingTarget,
  type SyncDeps,
  type SyncConfig,
  type SyncLogger,
} from "../src/sync.js";
import type { GitHubClient } from "../src/github-client.js";
import { getByPaperclipId, upsert, type MappingDb, type MappingRow } from "../src/mapping.js";

const CONFIG: SyncConfig = {
  githubRepo: "target-repo",
  syncLabelPaperclip: "synced-from-paperclip",
  syncMarkerGithub: "synced-from-github",
};

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

function makeFakeDb(): MappingDb & { rows: Map<string, MappingRow> } {
  const rows = new Map<string, MappingRow>();
  return {
    namespace: "plugin_github_sync_40eceaaa3a",
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

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    id: "pi-1",
    companyId: "co-1",
    title: "A native issue",
    description: "Some details",
    status: "todo",
    identifier: "ENG-12",
    ...overrides,
  } as Issue;
}

function makeGithub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    getIssue: vi.fn(),
    ...overrides,
  } as unknown as GitHubClient;
}

describe("statusToGithubState", () => {
  it("maps done/cancelled to closed, everything else to open", () => {
    expect(statusToGithubState("done")).toBe("closed");
    expect(statusToGithubState("cancelled")).toBe("closed");
    expect(statusToGithubState("todo")).toBe("open");
    expect(statusToGithubState("in_progress")).toBe("open");
    expect(statusToGithubState("backlog")).toBe("open");
    expect(statusToGithubState("in_review")).toBe("open");
    expect(statusToGithubState("blocked")).toBe("open");
  });
});

describe("resolveMirrorClosureStatus — inbound closure propagation + loop guard", () => {
  it("closes an open mirror on GitHub `closed`", () => {
    expect(resolveMirrorClosureStatus("closed", "todo")).toBe("done");
    expect(resolveMirrorClosureStatus("closed", "in_progress")).toBe("done");
    expect(resolveMirrorClosureStatus("closed", "in_review")).toBe("done");
    expect(resolveMirrorClosureStatus("closed", "blocked")).toBe("done");
    expect(resolveMirrorClosureStatus("closed", "backlog")).toBe("done");
  });

  it("no-ops on `closed` when the mirror is already terminal (loop guard, no bounce)", () => {
    expect(resolveMirrorClosureStatus("closed", "done")).toBeNull();
    expect(resolveMirrorClosureStatus("closed", "cancelled")).toBeNull();
  });

  it("reopens a terminal mirror to todo on GitHub `reopened`", () => {
    expect(resolveMirrorClosureStatus("reopened", "done")).toBe("todo");
    expect(resolveMirrorClosureStatus("reopened", "cancelled")).toBe("todo");
  });

  it("no-ops on `reopened` when the mirror is already open", () => {
    expect(resolveMirrorClosureStatus("reopened", "todo")).toBeNull();
    expect(resolveMirrorClosureStatus("reopened", "in_progress")).toBeNull();
  });

  it("ignores non-state-changing actions", () => {
    expect(resolveMirrorClosureStatus("edited", "todo")).toBeNull();
    expect(resolveMirrorClosureStatus("labeled", "done")).toBeNull();
    expect(resolveMirrorClosureStatus("opened", "todo")).toBeNull();
  });
});

describe("detectGithubMarker", () => {
  it("parses repo and number from the inbound marker", () => {
    expect(detectGithubMarker("body\n<!-- synced-from-github: my-repo#321 -->")).toEqual({
      repo: "my-repo",
      number: 321,
    });
  });
  it("returns null when no marker / empty description", () => {
    expect(detectGithubMarker("just a normal description")).toBeNull();
    expect(detectGithubMarker(null)).toBeNull();
    expect(detectGithubMarker(undefined)).toBeNull();
  });
});

describe("buildGithubBody", () => {
  it("includes the description, a back-link footer, and the paperclip marker", () => {
    const body = buildGithubBody(makeIssue({ id: "pi-9", identifier: "ENG-9", description: "Fix it" }));
    expect(body).toContain("Fix it");
    expect(body).toContain("Paperclip issue ENG-9");
    expect(body).toContain(paperclipMarker("pi-9"));
  });
});

describe("handleIssueCreated — loop prevention", () => {
  it("creates a GitHub issue for a NATIVE Paperclip issue (no marker)", async () => {
    const db = makeFakeDb();
    const createIssue = vi.fn().mockResolvedValue({
      ok: true,
      data: { number: 100, title: "", body: "", state: "open", htmlUrl: "", labels: [] },
    });
    const github = makeGithub({ createIssue });
    const deps: SyncDeps = {
      db,
      github,
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-1", description: "native, no marker" }),
    };

    await handleIssueCreated(deps, { issueId: "pi-1", companyId: "co-1" });

    expect(createIssue).toHaveBeenCalledTimes(1);
    const [repo, payload] = createIssue.mock.calls[0];
    expect(repo).toBe("target-repo");
    expect(payload.labels).toEqual(["synced-from-paperclip"]);

    const mapping = await getByPaperclipId(db, "pi-1");
    expect(mapping).toMatchObject({ githubIssueNumber: 100, origin: "paperclip" });
  });

  it("does NOT mirror the plugin's own operational issues (pr-review / ci-fix markers)", async () => {
    for (const marker of ["<!-- pr-review: o/r#5@abc1234 -->", "<!-- ci-fix: o/r#9 -->"]) {
      const db = makeFakeDb();
      const createIssue = vi.fn();
      const deps: SyncDeps = {
        db,
        github: makeGithub({ createIssue }),
        config: CONFIG,
        logger: silentLogger,
        getIssue: async () => makeIssue({ id: "pi-op", description: `Review body\n${marker}` }),
      };
      await handleIssueCreated(deps, { issueId: "pi-op", companyId: "co-1" });
      expect(createIssue).not.toHaveBeenCalled(); // 202 junk "Review PR …" twins predate this guard
      expect(await getByPaperclipId(db, "pi-op")).toBeNull(); // no mapping row either
    }
  });

  it("does NOT create a GitHub issue for a GitHub-originated issue (marker present)", async () => {
    const db = makeFakeDb();
    const createIssue = vi.fn();
    const github = makeGithub({ createIssue });
    const deps: SyncDeps = {
      db,
      github,
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () =>
        makeIssue({
          id: "pi-2",
          description: "from gh\n<!-- synced-from-github: up-repo#55 -->",
        }),
    };

    await handleIssueCreated(deps, { issueId: "pi-2", companyId: "co-1" });

    expect(createIssue).not.toHaveBeenCalled();
    const mapping = await getByPaperclipId(db, "pi-2");
    expect(mapping).toMatchObject({ githubRepo: "up-repo", githubIssueNumber: 55, origin: "github" });
  });

  it("skips when the issue is already mapped (idempotent)", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-3",
      githubRepo: "target-repo",
      githubIssueNumber: 7,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    const createIssue = vi.fn();
    const getIssue = vi.fn();
    const deps: SyncDeps = {
      db,
      github: makeGithub({ createIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue,
    };

    await handleIssueCreated(deps, { issueId: "pi-3", companyId: "co-1" });

    expect(createIssue).not.toHaveBeenCalled();
    expect(getIssue).not.toHaveBeenCalled();
  });
});

describe("handleIssueUpdated", () => {
  it("pushes the diff to GitHub for a mapped issue and bumps last_synced_at", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-4",
      githubRepo: "target-repo",
      githubIssueNumber: 200,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    const updateIssue = vi.fn().mockResolvedValue({
      ok: true,
      data: { number: 200, title: "", body: "", state: "closed", htmlUrl: "", labels: [] },
    });
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-4", status: "done", title: "Updated title" }),
    };

    await handleIssueUpdated(deps, { issueId: "pi-4", companyId: "co-1" });

    expect(updateIssue).toHaveBeenCalledTimes(1);
    const [repo, num, payload] = updateIssue.mock.calls[0];
    expect(repo).toBe("target-repo");
    expect(num).toBe(200);
    expect(payload.state).toBe("closed");
    expect(payload.title).toBe("Updated title");

    const mapping = await getByPaperclipId(db, "pi-4");
    expect(mapping?.lastSyncedAt).not.toBe("2026-01-01T00:00:00Z");
  });

  it("drops the field GitHub rejects and retries so the rest of the mirror lands (GOL-793)", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-5",
      githubRepo: "grove-sites",
      githubIssueNumber: 210,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    const updateIssue = vi
      .fn()
      // First push: GitHub rejects the `state` transition (e.g. reopen on a PR
      // with a deleted head branch) with a partial-field 422.
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        error: "Validation Failed (PullRequest.state.invalid)",
        errors: [{ resource: "PullRequest", field: "state", code: "invalid" }],
      })
      // Sanitized retry (title/body only) succeeds.
      .mockResolvedValueOnce({
        ok: true,
        data: { number: 210, title: "", body: "", state: "open", htmlUrl: "", labels: [] },
      });
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-5", status: "todo", title: "Keep title" }),
    };

    await handleIssueUpdated(deps, { issueId: "pi-5", companyId: "co-1" });

    expect(updateIssue).toHaveBeenCalledTimes(2);
    const retryPayload = updateIssue.mock.calls[1][2];
    expect(retryPayload.title).toBe("Keep title");
    expect(retryPayload.body).toBeDefined();
    expect(retryPayload.state).toBeUndefined();

    // Retry succeeded → last_synced_at bumped, no permanent failure.
    const mapping = await getByPaperclipId(db, "pi-5");
    expect(mapping?.lastSyncedAt).not.toBe("2026-01-01T00:00:00Z");
  });

  it("does not retry when the 422 names no field (all fields rejected / non-field error)", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-6",
      githubRepo: "grove-sites",
      githubIssueNumber: 211,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    const updateIssue = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      error: "Validation Failed (PullRequest.custom)",
      errors: [{ resource: "PullRequest", code: "custom", message: "unmergeable" }],
    });
    const errors: unknown[] = [];
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: { ...silentLogger, error: (_m: string, ctx?: unknown) => errors.push(ctx) },
      getIssue: async () => makeIssue({ id: "pi-6", status: "todo" }),
    };

    await handleIssueUpdated(deps, { issueId: "pi-6", companyId: "co-1" });

    // No field to drop → no retry; the failure is logged with structured detail.
    expect(updateIssue).toHaveBeenCalledTimes(1);
    expect(errors[0]).toMatchObject({
      githubStatus: 422,
      githubErrors: [{ resource: "PullRequest", code: "custom" }],
    });
  });

  it("ignores updates for unmapped issues", async () => {
    const db = makeFakeDb();
    const updateIssue = vi.fn();
    const getIssue = vi.fn();
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue,
    };

    await handleIssueUpdated(deps, { issueId: "unmapped", companyId: "co-1" });

    expect(updateIssue).not.toHaveBeenCalled();
    expect(getIssue).not.toHaveBeenCalled();
  });
});

// --- GOL-3374: outbound close on inbound-origin (full-slug) rows + durable failures ---

describe("resolveMappingTarget / outbound push on full-slug rows (GOL-3374)", () => {
  const fakeIssueRes = (state: "open" | "closed") => ({
    ok: true,
    data: { number: 891, title: "", body: "", state, htmlUrl: "", labels: [] },
  });

  it("routes a `owner/repo` (inbound-origin) row through resolveRepoClient with the bare repo", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-slug",
      githubRepo: "Goldberry-Playground/odoocker-goldberrygrove",
      githubIssueNumber: 891,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "github",
    });
    const wrongClientUpdate = vi.fn();
    const bridgeUpdate = vi.fn().mockResolvedValue(fakeIssueRes("closed"));
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue: wrongClientUpdate }),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-slug", status: "done" }),
      resolveRepoClient: (slug) =>
        slug === "Goldberry-Playground/odoocker-goldberrygrove"
          ? { github: makeGithub({ updateIssue: bridgeUpdate }), repo: "odoocker-goldberrygrove" }
          : null,
    };

    await handleIssueUpdated(deps, { issueId: "pi-slug", companyId: "co-1" });

    // The deps-level client (the project's LAST bridge) is never used for a slug row.
    expect(wrongClientUpdate).not.toHaveBeenCalled();
    expect(bridgeUpdate).toHaveBeenCalledTimes(1);
    const [repo, num, payload] = bridgeUpdate.mock.calls[0];
    expect(repo).toBe("odoocker-goldberrygrove"); // bare — NOT `Org/Org/repo`
    expect(num).toBe(891);
    expect(payload.state).toBe("closed");
    expect((await getByPaperclipId(db, "pi-slug"))?.lastSyncedAt).not.toBe("2026-01-01T00:00:00Z");
  });

  it("falls back to the bare tail of a lowercased slug when no resolver is wired", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-lc",
      githubRepo: "goldberry-playground/grove-sites",
      githubIssueNumber: 495,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "github",
    });
    const updateIssue = vi.fn().mockResolvedValue(fakeIssueRes("closed"));
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-lc", status: "cancelled" }),
    };
    await handleIssueUpdated(deps, { issueId: "pi-lc", companyId: "co-1" });
    expect(updateIssue.mock.calls[0][0]).toBe("grove-sites");
    expect(resolveMappingTarget({ github: deps.github }, { githubRepo: "a/b/c-repo" }).repo).toBe("c-repo");
    expect(resolveMappingTarget({ github: deps.github }, { githubRepo: "bare" }).repo).toBe("bare");
  });

  it("treats GitHub's 422 `closed by another request` on a close as in-sync (no failure record)", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-race",
      githubRepo: "target-repo",
      githubIssueNumber: 641,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    const updateIssue = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      error: "Validation Failed",
      errors: [{ resource: "Issue", code: "custom", message: "This issue was closed by another request. Reload it and try again." }],
    });
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-race", status: "done" }),
      recordFailure,
    };
    await handleIssueUpdated(deps, { issueId: "pi-race", companyId: "co-1" });
    expect(updateIssue).toHaveBeenCalledTimes(1); // no sanitized retry: errors[] names no field
    expect(recordFailure).not.toHaveBeenCalled();
    expect((await getByPaperclipId(db, "pi-race"))?.lastSyncedAt).not.toBe("2026-01-01T00:00:00Z");
    expect(isClosedByAnotherRequest({ ok: false, status: 422, errors: [{ message: "closed by another request" }] })).toBe(true);
    expect(isClosedByAnotherRequest({ ok: false, status: 422, errors: [{ field: "state", code: "invalid" }] })).toBe(false);
    expect(isClosedByAnotherRequest({ ok: false, status: 403 })).toBe(false);
  });

  it("records a real push failure durably and leaves last_synced_at untouched", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-fail",
      githubRepo: "target-repo",
      githubIssueNumber: 7,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    const updateIssue = vi.fn().mockResolvedValue({ ok: false, status: 403, error: "secondary rate limit" });
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-fail", status: "done" }),
      recordFailure,
    };
    await handleIssueUpdated(deps, { issueId: "pi-fail", companyId: "co-1" });
    expect(recordFailure).toHaveBeenCalledTimes(1);
    const [scope, detail, context] = recordFailure.mock.calls[0];
    expect(scope).toBe("issue.updated.push");
    expect(detail).toBe("secondary rate limit");
    expect(context).toMatchObject({ githubIssueNumber: 7, githubStatus: 403, state: "closed" });
    expect((await getByPaperclipId(db, "pi-fail"))?.lastSyncedAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("pushIssueState (outbound-close reconcile push)", () => {
  it("sends ONLY `state` — no title/body churn — and bumps last_synced_at", async () => {
    const db = makeFakeDb();
    const mapping: MappingRow = {
      paperclipIssueId: "pi-st",
      githubRepo: "Goldberry-Playground/grove-sites",
      githubIssueNumber: 487,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "github",
    };
    await upsert(db, mapping);
    const updateIssue = vi.fn().mockResolvedValue({
      ok: true,
      data: { number: 487, title: "", body: "", state: "closed", htmlUrl: "", labels: [] },
    });
    const deps: SyncDeps = {
      db,
      github: makeGithub({}),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => null,
      resolveRepoClient: () => ({ github: makeGithub({ updateIssue }), repo: "grove-sites" }),
    };
    const out = await pushIssueState(deps, mapping, { id: "pi-st", status: "done" });
    expect(out).toBe("pushed");
    expect(updateIssue).toHaveBeenCalledWith("grove-sites", 487, { state: "closed" });
    expect((await getByPaperclipId(db, "pi-st"))?.lastSyncedAt).not.toBe("2026-01-01T00:00:00Z");
  });

  it("reports `failed` and records it when GitHub rejects the state push", async () => {
    const db = makeFakeDb();
    const mapping: MappingRow = {
      paperclipIssueId: "pi-sf",
      githubRepo: "target-repo",
      githubIssueNumber: 9,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    };
    await upsert(db, mapping);
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue: vi.fn().mockResolvedValue({ ok: false, status: 404, error: "Not Found" }) }),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => null,
      recordFailure,
    };
    expect(await pushIssueState(deps, mapping, { id: "pi-sf", status: "cancelled" })).toBe("failed");
    expect(recordFailure).toHaveBeenCalledWith("outbound-close-reconcile.push", "Not Found", expect.objectContaining({ githubStatus: 404 }));
    expect((await getByPaperclipId(db, "pi-sf"))?.lastSyncedAt).toBe("2026-01-01T00:00:00Z");
  });
});
