import { describe, it, expect, vi } from "vitest";
import {
  runInboundCreateReconcile,
  buildInboundCreateReconcilePing,
  type InboundCreateReconcileInput,
  type CreateDriveOutcome,
  type ListCreateIssuesResult,
  type InboundCreateIssueRef,
} from "../src/inbound-create-reconcile.js";
import type { SyncLogger } from "../src/sync.js";

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

/** A minimal open issue ref; overridable per field. */
function issue(number: number, over: Partial<InboundCreateIssueRef> = {}): InboundCreateIssueRef {
  return {
    number,
    state: "open",
    title: `issue ${number}`,
    body: "body",
    url: `https://github.com/org/repo/issues/${number}`,
    labels: [],
    ...over,
  };
}

/**
 * Build an input whose `driveCreate` is stubbed by a map of
 * `"<repoSlug>#<number>" → outcome`, recording the drives it received.
 */
function makeInput(over: {
  listByRepo: Record<string, ListCreateIssuesResult>;
  outcomes?: Record<string, CreateDriveOutcome>;
  maxCreates?: number;
  logger?: SyncLogger;
}): {
  input: InboundCreateReconcileInput;
  drives: Array<{ repoSlug: string; number: number }>;
} {
  const drives: Array<{ repoSlug: string; number: number }> = [];
  const input: InboundCreateReconcileInput = {
    repoSlugs: Object.keys(over.listByRepo),
    listIssues: async (repoSlug) => over.listByRepo[repoSlug] ?? { ok: true, issues: [], truncated: false },
    driveCreate: async ({ repoSlug, issue: i }) => {
      drives.push({ repoSlug, number: i.number });
      return over.outcomes?.[`${repoSlug}#${i.number}`] ?? "skipped-mapped";
    },
    maxCreates: over.maxCreates,
    logger: over.logger ?? silentLogger,
  };
  return { input, drives };
}

describe("runInboundCreateReconcile", () => {
  it("creates a missing mirror for an open, unmapped issue", async () => {
    const { input, drives } = makeInput({
      listByRepo: { "org/grove-sites": { ok: true, issues: [issue(42)], truncated: false } },
      outcomes: { "org/grove-sites#42": "created" },
    });
    const s = await runInboundCreateReconcile(input);
    expect(drives).toEqual([{ repoSlug: "org/grove-sites", number: 42 }]);
    expect(s).toMatchObject({ scanned: 1, created: 1, skippedMapped: 0, failed: 0, capped: false });
  });

  it("skips an already-mirrored issue (idempotent no-op)", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [issue(7)], truncated: false } },
      outcomes: { "org/repo#7": "skipped-mapped" },
    });
    const s = await runInboundCreateReconcile(input);
    expect(s).toMatchObject({ scanned: 1, created: 0, skippedMapped: 1, failed: 0 });
  });

  it("skips a closed issue (never creates a pre-closed mirror)", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [issue(9, { state: "closed" })], truncated: false } },
      outcomes: { "org/repo#9": "skipped-closed" },
    });
    const s = await runInboundCreateReconcile(input);
    expect(s).toMatchObject({ scanned: 1, created: 0, skippedClosed: 1, failed: 0 });
  });

  it("skips a Paperclip-origin issue (sync label) so it is not bounced back", async () => {
    const { input } = makeInput({
      listByRepo: {
        "org/repo": { ok: true, issues: [issue(3, { labels: ["paperclip"] })], truncated: false },
      },
      outcomes: { "org/repo#3": "skipped-paperclip-origin" },
    });
    const s = await runInboundCreateReconcile(input);
    expect(s).toMatchObject({ scanned: 1, created: 0, skippedPaperclipOrigin: 1, failed: 0 });
  });

  it("counts a create whose mapping never landed as a (retryable) failure", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [issue(5)], truncated: false } },
      outcomes: { "org/repo#5": "failed" },
    });
    const s = await runInboundCreateReconcile(input);
    expect(s).toMatchObject({ scanned: 1, created: 0, failed: 1 });
  });

  it("treats a no-bridge issue as a silent skip (not created, not failed)", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [issue(6)], truncated: false } },
      outcomes: { "org/repo#6": "no-bridge" },
    });
    const s = await runInboundCreateReconcile(input);
    expect(s).toMatchObject({ scanned: 1, created: 0, failed: 0, skippedMapped: 0 });
  });

  it("skips a repo whose issue list fails, and still sweeps the others", async () => {
    const warn = vi.fn();
    const { input, drives } = makeInput({
      logger: { info() {}, warn, error() {} },
      listByRepo: {
        "org/broken": { ok: false, error: "broker 401" },
        "org/good": { ok: true, issues: [issue(1)], truncated: false },
      },
      outcomes: { "org/good#1": "created" },
    });
    const s = await runInboundCreateReconcile(input);
    expect(s.reposFailed).toBe(1);
    expect(s.created).toBe(1);
    expect(s.scanned).toBe(1); // the broken repo contributed no scanned issues
    expect(drives.map((d) => d.repoSlug)).toEqual(["org/good"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("continues the sweep when a single re-drive throws, counting it failed", async () => {
    const warn = vi.fn();
    let calls = 0;
    const input: InboundCreateReconcileInput = {
      repoSlugs: ["org/repo"],
      listIssues: async () => ({ ok: true, issues: [issue(1), issue(2)], truncated: false }),
      driveCreate: async ({ issue: i }) => {
        calls++;
        if (i.number === 1) throw new Error("scope gone and REST 502");
        return "created";
      },
      logger: { info() {}, warn, error() {} },
    };
    const s = await runInboundCreateReconcile(input);
    expect(calls).toBe(2); // did not abort after the throw
    expect(s).toMatchObject({ scanned: 2, created: 1, failed: 1 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("caps at maxCreates ATTEMPTS (creates + failures) and reports capped", async () => {
    const { input, drives } = makeInput({
      maxCreates: 2,
      listByRepo: {
        "org/repo": { ok: true, issues: [issue(1), issue(2), issue(3), issue(4)], truncated: false },
      },
      outcomes: {
        "org/repo#1": "created",
        "org/repo#2": "failed",
        "org/repo#3": "created",
      },
    });
    const s = await runInboundCreateReconcile(input);
    // 1 created + 1 failed hits the budget of 2 → #3 is never driven.
    expect(drives.map((d) => d.number)).toEqual([1, 2]);
    expect(s).toMatchObject({ created: 1, failed: 1, capped: true });
  });

  it("does NOT count pure skips against the create budget", async () => {
    const { input, drives } = makeInput({
      maxCreates: 1,
      listByRepo: {
        "org/repo": { ok: true, issues: [issue(1), issue(2), issue(3)], truncated: false },
      },
      outcomes: {
        "org/repo#1": "skipped-mapped",
        "org/repo#2": "skipped-mapped",
        "org/repo#3": "created",
      },
    });
    const s = await runInboundCreateReconcile(input);
    // Skips don't consume budget, so all three are driven and the one create lands.
    expect(drives.map((d) => d.number)).toEqual([1, 2, 3]);
    expect(s).toMatchObject({ skippedMapped: 2, created: 1, capped: false });
  });

  it("marks the summary truncated when a repo hit its page cap", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [issue(1)], truncated: true } },
      outcomes: { "org/repo#1": "skipped-mapped" },
    });
    const s = await runInboundCreateReconcile(input);
    expect(s.truncated).toBe(true);
  });
});

describe("buildInboundCreateReconcilePing", () => {
  it("summarises created + failed counts", () => {
    const ping = buildInboundCreateReconcilePing({
      scanned: 12,
      created: 3,
      skippedMapped: 8,
      skippedClosed: 0,
      skippedPaperclipOrigin: 1,
      failed: 1,
      reposFailed: 0,
      truncated: false,
      capped: false,
    });
    expect(ping).toContain("created 3");
    expect(ping).toContain("1 failed");
    expect(ping).toContain("scanned 12");
  });

  it("notes the cap when the run was budget-capped", () => {
    const ping = buildInboundCreateReconcilePing({
      scanned: 20,
      created: 20,
      skippedMapped: 0,
      skippedClosed: 0,
      skippedPaperclipOrigin: 0,
      failed: 0,
      reposFailed: 0,
      truncated: true,
      capped: true,
    });
    expect(ping).toContain("capped");
  });
});
