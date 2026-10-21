import { describe, it, expect } from "vitest";
import {
  runPrCloseReconcile,
  buildPrCloseReconcilePing,
  type PrCloseReconcileInput,
  type PullStateResult,
  type TwinRetireOutcome,
} from "../src/pr-close-reconcile.js";
import type { PrReviewRow } from "../src/pr-review-store.js";
import type { SyncLogger } from "../src/sync.js";

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

function row(over: Partial<PrReviewRow>): PrReviewRow {
  return {
    githubRepo: "Goldberry-Playground/AgenticOS",
    prNumber: 1,
    reviewer: "ada",
    headSha: "sha1",
    paperclipIssueId: "iss-1",
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

function makeInput(over: {
  rows: PrReviewRow[];
  status?: Record<string, string | null>;
  pulls?: Record<string, PullStateResult>;
  retire?: Record<string, TwinRetireOutcome | Error>;
}): { input: PrCloseReconcileInput; retired: Array<{ issueId: string; merged: boolean }>; pullReads: string[] } {
  const retired: Array<{ issueId: string; merged: boolean }> = [];
  const pullReads: string[] = [];
  const input: PrCloseReconcileInput = {
    companyId: "co-1",
    sinceIso: "2026-09-15T00:00:00Z",
    limit: 300,
    listRows: async () => over.rows,
    getIssueStatus: async (issueId) => (over.status ? (over.status[issueId] ?? null) : "in_review"),
    getPull: async (repo, pr) => {
      const key = `${repo}#${pr}`;
      pullReads.push(key);
      return over.pulls?.[key] ?? { ok: true, state: "open", merged: false };
    },
    retireTwin: async ({ row, merged }) => {
      const o = over.retire?.[row.paperclipIssueId] ?? "retired";
      if (o instanceof Error) throw o;
      if (o === "retired") retired.push({ issueId: row.paperclipIssueId, merged });
      return o;
    },
    logger: silentLogger,
  };
  return { input, retired, pullReads };
}

describe("runPrCloseReconcile (GOL-3374)", () => {
  it("retires non-terminal twins of a merged PR (both reviewers, ONE PR read) and leaves open-PR twins alone", async () => {
    const { input, retired, pullReads } = makeInput({
      rows: [
        row({ prNumber: 10, reviewer: "ada", paperclipIssueId: "a10" }),
        row({ prNumber: 10, reviewer: "iris", paperclipIssueId: "i10" }),
        row({ prNumber: 11, reviewer: "ada", paperclipIssueId: "a11" }),
      ],
      status: { a10: "in_review", i10: "blocked", a11: "in_progress" },
      pulls: {
        "Goldberry-Playground/AgenticOS#10": { ok: true, state: "closed", merged: true },
        "Goldberry-Playground/AgenticOS#11": { ok: true, state: "open", merged: false },
      },
    });
    const s = await runPrCloseReconcile(input);
    expect(retired).toEqual([
      { issueId: "a10", merged: true },
      { issueId: "i10", merged: true },
    ]);
    expect(pullReads.filter((k) => k.endsWith("#10"))).toHaveLength(1); // cached across ada+iris rows
    expect(s).toEqual({ scanned: 3, retired: 2, skippedTerminal: 0, skippedOpenPr: 1, failed: 0 });
  });

  it("passes merged=false for a PR closed without merge so the twin is cancelled, not done", async () => {
    const { input, retired } = makeInput({
      rows: [row({ prNumber: 12, paperclipIssueId: "a12" })],
      pulls: { "Goldberry-Playground/AgenticOS#12": { ok: true, state: "closed", merged: false } },
    });
    await runPrCloseReconcile(input);
    expect(retired).toEqual([{ issueId: "a12", merged: false }]);
  });

  it("a terminal twin is a cheap skip — no PR read at all (the healthy common case)", async () => {
    const { input, pullReads } = makeInput({
      rows: [row({ paperclipIssueId: "done-1" }), row({ prNumber: 2, paperclipIssueId: "canc-2" })],
      status: { "done-1": "done", "canc-2": "cancelled" },
    });
    const s = await runPrCloseReconcile(input);
    expect(pullReads).toEqual([]);
    expect(s).toEqual({ scanned: 2, retired: 0, skippedTerminal: 2, skippedOpenPr: 0, failed: 0 });
  });

  it("counts unreadable twins, PR read failures, in-sync races and thrown retires correctly", async () => {
    const { input } = makeInput({
      rows: [
        row({ prNumber: 20, paperclipIssueId: "unreadable" }),
        row({ prNumber: 21, paperclipIssueId: "pr-dead" }),
        row({ prNumber: 22, paperclipIssueId: "race" }),
        row({ prNumber: 23, paperclipIssueId: "throws" }),
      ],
      status: { unreadable: null, "pr-dead": "in_review", race: "in_review", throws: "in_review" },
      pulls: {
        "Goldberry-Playground/AgenticOS#21": { ok: false, error: "broker 401" },
        "Goldberry-Playground/AgenticOS#22": { ok: true, state: "closed", merged: true },
        "Goldberry-Playground/AgenticOS#23": { ok: true, state: "closed", merged: true },
      },
      retire: { race: "in-sync", throws: new Error("422 from platform") },
    });
    const s = await runPrCloseReconcile(input);
    expect(s).toEqual({ scanned: 4, retired: 0, skippedTerminal: 1, skippedOpenPr: 0, failed: 3 });
  });

  it("ping names the retire count and failures", () => {
    const msg = buildPrCloseReconcilePing({ scanned: 30, retired: 4, skippedTerminal: 25, skippedOpenPr: 1, failed: 0 });
    expect(msg).toContain("retired 4 review twin(s)");
    expect(msg).toContain("0 failed");
  });
});
