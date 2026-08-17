import { describe, it, expect, vi } from "vitest";
import {
  runInboundCloseReconcile,
  buildInboundCloseReconcilePing,
  type InboundCloseReconcileInput,
  type ClosureDriveOutcome,
  type ListIssuesResult,
} from "../src/inbound-close-reconcile.js";
import type { SyncLogger } from "../src/sync.js";

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

/**
 * Build an input whose `driveClosure` is stubbed by a map of
 * `"<repoSlug>#<number>" → outcome`, recording the exact drives it received so a
 * test can assert action derivation (closed → "closed", open → "reopened").
 */
function makeInput(over: {
  listByRepo: Record<string, ListIssuesResult>;
  outcomes?: Record<string, ClosureDriveOutcome>;
  logger?: SyncLogger;
}): {
  input: InboundCloseReconcileInput;
  drives: Array<{ action: "closed" | "reopened"; repoSlug: string; number: number }>;
} {
  const drives: Array<{ action: "closed" | "reopened"; repoSlug: string; number: number }> = [];
  const input: InboundCloseReconcileInput = {
    repoSlugs: Object.keys(over.listByRepo),
    listIssues: async (repoSlug) => over.listByRepo[repoSlug] ?? { ok: true, issues: [], truncated: false },
    driveClosure: async (d) => {
      drives.push(d);
      return over.outcomes?.[`${d.repoSlug}#${d.number}`] ?? "unmapped";
    },
    logger: over.logger ?? silentLogger,
  };
  return { input, drives };
}

describe("runInboundCloseReconcile", () => {
  it("propagates a closed issue with a mapped, non-terminal mirror", async () => {
    const { input, drives } = makeInput({
      listByRepo: { "org/grove-sites": { ok: true, issues: [{ number: 42, state: "closed" }], truncated: false } },
      outcomes: { "org/grove-sites#42": "propagated" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(drives).toEqual([{ action: "closed", repoSlug: "org/grove-sites", number: 42 }]);
    expect(s).toMatchObject({ scanned: 1, propagated: 1, skippedInSync: 0, skippedUnmapped: 0, failed: 0 });
  });

  it("is a loop-guard no-op when the mirror is already in sync (already `done`)", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [{ number: 7, state: "closed" }], truncated: false } },
      outcomes: { "org/repo#7": "in-sync" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(s).toMatchObject({ scanned: 1, propagated: 0, skippedInSync: 1, failed: 0 });
  });

  it("ignores a closed issue with no Paperclip twin (unmapped)", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [{ number: 9, state: "closed" }], truncated: false } },
      outcomes: { "org/repo#9": "unmapped" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(s).toMatchObject({ scanned: 1, propagated: 0, skippedUnmapped: 1, failed: 0 });
  });

  it("skips an open twin without a re-drive — never synthesizes a reopen (GOL-1419)", async () => {
    // Regression guard for the done↔todo flap: an open GitHub twin whose mirror an
    // agent has (deliberately) closed must NOT be dragged back to `todo`. The sweep
    // propagates closures only; an open issue is counted `skippedOpen` and left alone.
    const { input, drives } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [{ number: 3, state: "open" }], truncated: false } },
      outcomes: { "org/repo#3": "propagated" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(drives).toEqual([]); // no drive at all — the flap source is gone
    expect(s).toMatchObject({ scanned: 1, skippedOpen: 1, propagated: 0, failed: 0 });
  });

  it("propagates closes but skips opens in a mixed batch (only `closed` is driven)", async () => {
    const { input, drives } = makeInput({
      listByRepo: {
        "org/repo": {
          ok: true,
          issues: [
            { number: 10, state: "closed" },
            { number: 11, state: "open" },
            { number: 12, state: "closed" },
          ],
          truncated: false,
        },
      },
      outcomes: { "org/repo#10": "propagated", "org/repo#12": "in-sync" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(drives.map((d) => `${d.action}#${d.number}`)).toEqual(["closed#10", "closed#12"]);
    expect(s).toMatchObject({ scanned: 3, propagated: 1, skippedInSync: 1, skippedOpen: 1, failed: 0 });
  });

  it("counts an unreadable mirror as a (retryable) failure, not a propagate", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [{ number: 5, state: "closed" }], truncated: false } },
      outcomes: { "org/repo#5": "unreadable" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(s).toMatchObject({ scanned: 1, propagated: 0, failed: 1 });
  });

  it("self-heals an orphaned mapping (deleted twin): pruned, NOT failed (GOL-1274)", async () => {
    // The exact GOL-1273 shape: a closed GitHub twin whose Paperclip mirror was
    // hard-deleted. handleAppClosure prunes the orphaned row and returns "pruned",
    // so the sweep records failed==0 / pruned==1 and stops paging ops every hour.
    const { input } = makeInput({
      listByRepo: { "org/grove-sites": { ok: true, issues: [{ number: 355, state: "closed" }], truncated: false } },
      outcomes: { "org/grove-sites#355": "pruned" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(s).toMatchObject({ scanned: 1, propagated: 0, pruned: 1, failed: 0 });
  });

  it("skips a repo whose issue list fails, and still sweeps the others", async () => {
    const warn = vi.fn();
    const { input, drives } = makeInput({
      logger: { info() {}, warn, error() {} },
      listByRepo: {
        "org/broken": { ok: false, error: "broker 401" },
        "org/good": { ok: true, issues: [{ number: 1, state: "closed" }], truncated: false },
      },
      outcomes: { "org/good#1": "propagated" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(s.reposFailed).toBe(1);
    expect(s.propagated).toBe(1);
    expect(s.scanned).toBe(1); // the broken repo contributed no scanned issues
    expect(drives.map((d) => d.repoSlug)).toEqual(["org/good"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("continues the sweep when a single re-drive throws, counting it failed", async () => {
    const warn = vi.fn();
    let calls = 0;
    const input: InboundCloseReconcileInput = {
      repoSlugs: ["org/repo"],
      listIssues: async () => ({
        ok: true,
        issues: [
          { number: 1, state: "closed" },
          { number: 2, state: "closed" },
        ],
        truncated: false,
      }),
      driveClosure: async ({ number }) => {
        calls++;
        if (number === 1) throw new Error("scope gone and REST 502");
        return "propagated";
      },
      logger: { info() {}, warn, error() {} },
    };
    const s = await runInboundCloseReconcile(input);
    expect(calls).toBe(2); // did not abort after the throw
    expect(s).toMatchObject({ scanned: 2, propagated: 1, failed: 1 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("marks the summary truncated when a repo hit its page cap", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, issues: [{ number: 1, state: "closed" }], truncated: true } },
      outcomes: { "org/repo#1": "in-sync" },
    });
    const s = await runInboundCloseReconcile(input);
    expect(s.truncated).toBe(true);
  });
});

describe("buildInboundCloseReconcilePing", () => {
  it("summarises propagated + pruned + failed counts", () => {
    const ping = buildInboundCloseReconcilePing({
      scanned: 12,
      propagated: 2,
      skippedUnmapped: 8,
      skippedOpen: 0,
      skippedInSync: 2,
      pruned: 3,
      failed: 1,
      reposFailed: 0,
      truncated: false,
    });
    expect(ping).toContain("propagated 2");
    expect(ping).toContain("pruned 3");
    expect(ping).toContain("1 failed");
    expect(ping).toContain("scanned 12");
  });
});
