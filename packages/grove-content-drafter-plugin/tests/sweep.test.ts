import { describe, it, expect, vi } from "vitest";
import { runSweep } from "../src/sweep.js";
import type { ReceiveDeps } from "../src/receive.js";
import type { DrafterConfig, IssueLike, IssuePort, RequestState, StatePort } from "../src/ports.js";

const NOW = new Date("2026-09-24T06:00:00.000Z");

function cfg(): DrafterConfig {
  return {
    odooBaseUrl: "https://odoo.qa",
    odooDb: "odoo",
    odooUsername: "content-drafter",
    odooPassword: "pw",
    houseRules: "",
    companyId: "co-1",
    groveProjectId: "proj-1",
    drafterAgentId: "sora",
    maxDraftsPerRun: 5,
    replyTimeoutHours: 12,
    dryRun: false,
  };
}

function issue(id: string): IssueLike {
  return { id, title: "Draft", description: "", status: "todo", originKind: "plugin:agenticos.grove-content-drafter", createdAt: NOW.toISOString() };
}

function reqState(over: Partial<RequestState> = {}): RequestState {
  return {
    productId: 1,
    marker: "product.template#1@2026-09-20 00:00:00",
    status: "open",
    attempts: 0,
    rePinged: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    ...over,
  };
}

function build(opts: {
  issues_: IssueLike[];
  reqByIssue: Record<string, RequestState>;
  comments?: Record<string, { authorAgentId: string | null; body: string; createdAt: string }[]>;
}): { deps: ReceiveDeps; issues: IssuePort; saved: Record<string, RequestState> } {
  const saved: Record<string, RequestState> = {};
  const issues: IssuePort = {
    openRequestExistsForProduct: vi.fn(),
    createRequestIssue: vi.fn(),
    get: vi.fn(),
    listOwnRequests: vi.fn().mockResolvedValue(opts.issues_),
    listComments: vi.fn(async (id: string) => opts.comments?.[id] ?? []),
    postComment: vi.fn().mockResolvedValue(undefined),
    wakeAssignee: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
  } as any;
  const state: StatePort = {
    getRequest: vi.fn(async (id: string) => opts.reqByIssue[id] ?? null),
    setRequest: vi.fn(async (id: string, s: RequestState) => {
      saved[id] = structuredClone(s);
    }),
    getDraftedVersion: vi.fn().mockResolvedValue(null),
    setDraftedVersion: vi.fn().mockResolvedValue(undefined),
  } as any;
  const odoo = {
    read: vi.fn().mockResolvedValue({
      ok: true,
      data: { name: "Fig", categ_id: [4, "P"], write_date: "2026-09-20 00:00:00", grove_facts_provenance: false, grove_soil: false },
    }),
    write: vi.fn().mockResolvedValue({ ok: true, data: true }),
    postNote: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
  } as any;
  return { deps: { odoo, issues, state, cfg: cfg(), now: NOW, logger: { info: () => {} } }, issues, saved };
}

const goodReply = {
  authorAgentId: "sora",
  body:
    "```json\n" +
    JSON.stringify({
      description_ecommerce_html: "<p>Fig.</p>",
      website_description_html: "<h2>Care</h2><p>Sun.</p>",
      filled_facts: [],
      sources: [],
    }) +
    "\n```",
  createdAt: "2026-09-24T05:00:00.000Z",
};

describe("runSweep", () => {
  it("harvests a reply the event missed", async () => {
    const { deps, issues } = build({
      issues_: [issue("i1")],
      reqByIssue: { i1: reqState() },
      comments: { i1: [goodReply] },
    });
    const s = await runSweep(deps);
    expect(s.drafted).toBe(1);
    expect(issues.setStatus).toHaveBeenCalledWith("i1", "done");
  });

  it("re-pings once when a request is overdue with no reply", async () => {
    const { deps, issues, saved } = build({
      issues_: [issue("i1")],
      reqByIssue: { i1: reqState({ createdAt: "2026-09-23T12:00:00.000Z" }) }, // 18h ago
      comments: { i1: [] },
    });
    const s = await runSweep(deps);
    expect(s.rePinged).toBe(1);
    expect(issues.wakeAssignee).toHaveBeenCalledWith("i1", expect.any(String));
    expect(saved.i1.rePinged).toBe(true);
  });

  it("gives up and blocks after re-ping window elapses", async () => {
    const { deps, issues, saved } = build({
      issues_: [issue("i1")],
      reqByIssue: { i1: reqState({ rePinged: true, createdAt: "2026-09-23T00:00:00.000Z" }) }, // 30h ago
      comments: { i1: [] },
    });
    const s = await runSweep(deps);
    expect(s.gaveUp).toBe(1);
    expect(issues.setStatus).toHaveBeenCalledWith("i1", "blocked");
    expect(saved.i1.status).toBe("failed");
  });

  it("isolates a throwing issue: counts it, keeps sweeping, finishes the tick (GOL-2927)", async () => {
    // Before this, one throw (an Odoo blip, a host error) aborted runSweep and
    // silently dropped every remaining request in the tick. (The host's
    // invocation-scope denial is a separate, covered case — see below.)
    const warn = vi.fn();
    const { deps, issues } = build({
      issues_: [issue("i1"), issue("i2")],
      reqByIssue: { i1: reqState(), i2: reqState() },
      comments: { i1: [goodReply], i2: [goodReply] },
    });
    deps.logger = { info: () => {}, warn };
    (issues.listComments as any).mockImplementation(async (id: string) => {
      if (id === "i1") throw new Error("ECONNRESET");
      return [goodReply];
    });

    const s = await runSweep(deps);

    expect(s.errors).toBe(1);
    // i2 still got drafted — the whole point. A sweep that stopped at i1 would
    // report drafted:0 here.
    expect(s.drafted).toBe(1);
    expect(issues.setStatus).toHaveBeenCalledWith("i2", "done");
    expect(issues.setStatus).not.toHaveBeenCalledWith("i1", "done");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("sweep skipped an issue"),
      expect.objectContaining({ issueId: "i1" }),
    );
  });

  it("reports errors:0 on a clean tick", async () => {
    const { deps } = build({
      issues_: [issue("i1")],
      reqByIssue: { i1: reqState() },
      comments: { i1: [goodReply] },
    });
    expect((await runSweep(deps)).errors).toBe(0);
  });

  it("leaves a fresh waiting request alone", async () => {
    const { deps, issues } = build({
      issues_: [issue("i1")],
      reqByIssue: { i1: reqState({ createdAt: "2026-09-24T00:00:00.000Z" }) }, // 6h ago
      comments: { i1: [] },
    });
    const s = await runSweep(deps);
    expect(s.waiting).toBe(1);
    expect(s.rePinged).toBe(0);
    expect(issues.postComment).not.toHaveBeenCalled();
  });

  it("counts a per-issue invocation-scope denial as scopeDenied (covered by the event sweep), not as an error", async () => {
    // GOL-3352: a comment event delivered mid-sweep holds the scope for 15 min;
    // the scheduled sweep's remaining company-scoped calls are denied. That
    // event's own handler sweeps under a valid scope, so this is covered work,
    // and `errors` must stay 0 so it keeps meaning "something real broke".
    const { deps, issues } = build({
      issues_: [issue("i1"), issue("i2")],
      reqByIssue: { i1: reqState(), i2: reqState({ productId: 2 }) },
      comments: { i2: [goodReply] },
    });
    (issues.listComments as any).mockImplementation(async (id: string) => {
      if (id === "i1") {
        throw new Error(
          'Plugin "x" is not allowed to perform "issues.listComments": the worker referenced a missing, expired, or unknown invocation scope',
        );
      }
      return [goodReply];
    });
    const s = await runSweep(deps);
    expect(s.scopeDenied).toBe(1);
    expect(s.errors).toBe(0);
    // The denial is isolated: the next issue is still processed.
    expect(s.drafted).toBe(1);
    expect(issues.setStatus).toHaveBeenCalledWith("i2", "done");
  });

  it("still counts a non-scope throw as an error", async () => {
    const { deps } = build({
      issues_: [issue("i1")],
      reqByIssue: { i1: reqState() },
    });
    (deps.issues.listComments as any).mockRejectedValue(new Error("ECONNRESET"));
    const s = await runSweep(deps);
    expect(s.errors).toBe(1);
    expect(s.scopeDenied).toBe(0);
  });
});
