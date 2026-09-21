import { describe, it, expect, vi } from "vitest";
import {
  runPrReviewReconcile,
  buildPrReviewReconcilePing,
  type PrReviewReconcileInput,
  type PrReviewDriveOutcome,
  type ListPrsResult,
  type InboundPrRef,
} from "../src/pr-review-create-reconcile.js";
import type { SyncLogger } from "../src/sync.js";

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

/** A minimal open-PR ref; overridable per field. */
function pr(number: number, over: Partial<InboundPrRef> = {}): InboundPrRef {
  return {
    number,
    headSha: `sha${number}`,
    title: `pr ${number}`,
    url: `https://github.com/org/repo/pull/${number}`,
    draft: false,
    ...over,
  };
}

/**
 * Build an input whose `driveReview` is stubbed by a map of
 * `"<repoSlug>#<number>" → outcome`, recording the drives it received.
 */
function makeInput(over: {
  listByRepo: Record<string, ListPrsResult>;
  outcomes?: Record<string, PrReviewDriveOutcome>;
  maxDrives?: number;
  logger?: SyncLogger;
}): {
  input: PrReviewReconcileInput;
  drives: Array<{ repoSlug: string; number: number }>;
} {
  const drives: Array<{ repoSlug: string; number: number }> = [];
  const input: PrReviewReconcileInput = {
    repoSlugs: Object.keys(over.listByRepo),
    listPrs: async (repoSlug) => over.listByRepo[repoSlug] ?? { ok: true, prs: [], truncated: false },
    driveReview: async ({ repoSlug, pr: p }) => {
      drives.push({ repoSlug, number: p.number });
      return over.outcomes?.[`${repoSlug}#${p.number}`] ?? "skipped-current";
    },
    maxDrives: over.maxDrives,
    logger: over.logger ?? silentLogger,
  };
  return { input, drives };
}

describe("runPrReviewReconcile", () => {
  it("twins a PR whose current head has no review (the grove-sites#775 case)", async () => {
    const { input, drives } = makeInput({
      listByRepo: { "org/grove-sites": { ok: true, prs: [pr(775)], truncated: false } },
      outcomes: { "org/grove-sites#775": "twinned" },
    });
    const s = await runPrReviewReconcile(input);
    expect(drives).toEqual([{ repoSlug: "org/grove-sites", number: 775 }]);
    expect(s).toMatchObject({ scanned: 1, twinned: 1, skippedCurrent: 0, failed: 0, capped: false });
  });

  it("skips a PR whose Ada twin is already at the current head (idempotent no-op)", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, prs: [pr(7)], truncated: false } },
      outcomes: { "org/repo#7": "skipped-current" },
    });
    const s = await runPrReviewReconcile(input);
    expect(s).toMatchObject({ scanned: 1, twinned: 0, skippedCurrent: 1, failed: 0 });
  });

  it("skips a draft PR (never reviewed)", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, prs: [pr(9, { draft: true })], truncated: false } },
      outcomes: { "org/repo#9": "skipped-draft" },
    });
    const s = await runPrReviewReconcile(input);
    expect(s).toMatchObject({ scanned: 1, twinned: 0, skippedDraft: 1, failed: 0 });
  });

  it("counts a re-drive that landed no twin as a (retryable) failure", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, prs: [pr(5)], truncated: false } },
      outcomes: { "org/repo#5": "failed" },
    });
    const s = await runPrReviewReconcile(input);
    expect(s).toMatchObject({ scanned: 1, twinned: 0, failed: 1 });
  });

  it("treats a no-bridge PR as a silent skip (not twinned, not failed)", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, prs: [pr(6)], truncated: false } },
      outcomes: { "org/repo#6": "no-bridge" },
    });
    const s = await runPrReviewReconcile(input);
    expect(s).toMatchObject({ scanned: 1, twinned: 0, failed: 0, skippedCurrent: 0 });
  });

  it("skips a repo whose PR list fails, and still sweeps the others", async () => {
    const warn = vi.fn();
    const { input, drives } = makeInput({
      logger: { info() {}, warn, error() {} },
      listByRepo: {
        "org/broken": { ok: false, error: "broker 401" },
        "org/good": { ok: true, prs: [pr(1)], truncated: false },
      },
      outcomes: { "org/good#1": "twinned" },
    });
    const s = await runPrReviewReconcile(input);
    expect(s.reposFailed).toBe(1);
    expect(s.twinned).toBe(1);
    expect(s.scanned).toBe(1); // the broken repo contributed no scanned PRs
    expect(drives.map((d) => d.repoSlug)).toEqual(["org/good"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("continues the sweep when a single re-drive throws, counting it failed", async () => {
    const warn = vi.fn();
    let calls = 0;
    const input: PrReviewReconcileInput = {
      repoSlugs: ["org/repo"],
      listPrs: async () => ({ ok: true, prs: [pr(1), pr(2)], truncated: false }),
      driveReview: async ({ pr: p }) => {
        calls++;
        if (p.number === 1) throw new Error("scope gone and REST 502");
        return "twinned";
      },
      logger: { info() {}, warn, error() {} },
    };
    const s = await runPrReviewReconcile(input);
    expect(calls).toBe(2); // did not abort after the throw
    expect(s).toMatchObject({ scanned: 2, twinned: 1, failed: 1 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("caps at maxDrives ATTEMPTS (twinned + failures) and reports capped", async () => {
    const { input, drives } = makeInput({
      maxDrives: 2,
      listByRepo: {
        "org/repo": { ok: true, prs: [pr(1), pr(2), pr(3), pr(4)], truncated: false },
      },
      outcomes: {
        "org/repo#1": "twinned",
        "org/repo#2": "failed",
        "org/repo#3": "twinned",
      },
    });
    const s = await runPrReviewReconcile(input);
    // 1 twinned + 1 failed hits the budget of 2 → #3 is never driven.
    expect(drives.map((d) => d.number)).toEqual([1, 2]);
    expect(s).toMatchObject({ twinned: 1, failed: 1, capped: true });
  });

  it("does NOT count pure skips against the drive budget", async () => {
    const { input, drives } = makeInput({
      maxDrives: 1,
      listByRepo: {
        "org/repo": { ok: true, prs: [pr(1), pr(2), pr(3)], truncated: false },
      },
      outcomes: {
        "org/repo#1": "skipped-current",
        "org/repo#2": "skipped-draft",
        "org/repo#3": "twinned",
      },
    });
    const s = await runPrReviewReconcile(input);
    // Skips don't consume budget, so all three are driven and the one twin lands.
    expect(drives.map((d) => d.number)).toEqual([1, 2, 3]);
    expect(s).toMatchObject({ skippedCurrent: 1, skippedDraft: 1, twinned: 1, capped: false });
  });

  it("marks the summary truncated when a repo hit its page cap", async () => {
    const { input } = makeInput({
      listByRepo: { "org/repo": { ok: true, prs: [pr(1)], truncated: true } },
      outcomes: { "org/repo#1": "skipped-current" },
    });
    const s = await runPrReviewReconcile(input);
    expect(s.truncated).toBe(true);
  });
});

describe("buildPrReviewReconcilePing", () => {
  it("summarises twinned + failed counts", () => {
    const ping = buildPrReviewReconcilePing({
      scanned: 12,
      twinned: 3,
      skippedCurrent: 8,
      skippedDraft: 0,
      failed: 1,
      reposFailed: 0,
      truncated: false,
      capped: false,
    });
    expect(ping).toContain("3 missing review twin");
    expect(ping).toContain("1 failed");
    expect(ping).toContain("scanned 12");
  });

  it("notes the cap when the run was budget-capped", () => {
    const ping = buildPrReviewReconcilePing({
      scanned: 20,
      twinned: 20,
      skippedCurrent: 0,
      skippedDraft: 0,
      failed: 0,
      reposFailed: 0,
      truncated: true,
      capped: true,
    });
    expect(ping).toContain("capped");
  });
});
