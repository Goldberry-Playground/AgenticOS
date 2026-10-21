import { describe, it, expect } from "vitest";
import {
  runOutboundCloseReconcile,
  buildOutboundCloseReconcilePing,
  type OutboundCloseReconcileInput,
  type OutboundCloseDriveOutcome,
  type ListOpenIssuesResult,
} from "../src/outbound-close-reconcile.js";
import type { SyncLogger } from "../src/sync.js";

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

function makeInput(over: {
  listByRepo: Record<string, ListOpenIssuesResult>;
  outcomes?: Record<string, OutboundCloseDriveOutcome | Error>;
}): { input: OutboundCloseReconcileInput; drives: string[] } {
  const drives: string[] = [];
  const input: OutboundCloseReconcileInput = {
    repoSlugs: Object.keys(over.listByRepo),
    listOpenIssues: async (repoSlug) => over.listByRepo[repoSlug] ?? { ok: true, issues: [], truncated: false },
    driveClose: async (d) => {
      const key = `${d.repoSlug}#${d.number}`;
      drives.push(key);
      const o = over.outcomes?.[key] ?? "unmapped";
      if (o instanceof Error) throw o;
      return o;
    },
    logger: silentLogger,
  };
  return { input, drives };
}

describe("runOutboundCloseReconcile (GOL-3374)", () => {
  it("pushes a close for an open GitHub issue whose twin is terminal and leaves in-sync/unmapped issues alone", async () => {
    const { input, drives } = makeInput({
      listByRepo: {
        "Goldberry-Playground/grove-sites": {
          ok: true,
          issues: [{ number: 487 }, { number: 500 }, { number: 501 }],
          truncated: false,
        },
      },
      outcomes: {
        "Goldberry-Playground/grove-sites#487": "pushed",
        "Goldberry-Playground/grove-sites#500": "twin-open",
        // #501 → default "unmapped"
      },
    });
    const s = await runOutboundCloseReconcile(input);
    expect(drives).toEqual([
      "Goldberry-Playground/grove-sites#487",
      "Goldberry-Playground/grove-sites#500",
      "Goldberry-Playground/grove-sites#501",
    ]);
    expect(s).toEqual({
      scanned: 3,
      pushed: 1,
      skippedUnmapped: 1,
      skippedTwinOpen: 1,
      failed: 0,
      reposFailed: 0,
      truncated: false,
    });
  });

  it("counts failed pushes, unreadable twins and thrown drives as `failed` without aborting the sweep", async () => {
    const { input, drives } = makeInput({
      listByRepo: {
        "o/a": { ok: true, issues: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }], truncated: true },
      },
      outcomes: {
        "o/a#1": "failed",
        "o/a#2": "unreadable",
        "o/a#3": new Error("boom"),
        "o/a#4": "pushed",
      },
    });
    const s = await runOutboundCloseReconcile(input);
    expect(drives).toHaveLength(4); // the throw on #3 did not stop #4
    expect(s.failed).toBe(3);
    expect(s.pushed).toBe(1);
    expect(s.truncated).toBe(true);
  });

  it("a repo whose open-issue list fails is skipped this run and counted in reposFailed", async () => {
    const { input, drives } = makeInput({
      listByRepo: {
        "o/dead": { ok: false, error: "broker 401" },
        "o/live": { ok: true, issues: [{ number: 9 }], truncated: false },
      },
      outcomes: { "o/live#9": "pushed" },
    });
    const s = await runOutboundCloseReconcile(input);
    expect(drives).toEqual(["o/live#9"]);
    expect(s.reposFailed).toBe(1);
    expect(s.pushed).toBe(1);
  });

  it("a healthy fleet (every open issue has an open twin or no twin) is a pure no-op", async () => {
    const { input } = makeInput({
      listByRepo: { "o/a": { ok: true, issues: [{ number: 1 }, { number: 2 }], truncated: false } },
      outcomes: { "o/a#1": "twin-open" },
    });
    const s = await runOutboundCloseReconcile(input);
    expect(s.pushed).toBe(0);
    expect(s.failed).toBe(0);
  });

  it("ping names the heal count, failures and the scanned open set", () => {
    const msg = buildOutboundCloseReconcilePing({
      scanned: 42,
      pushed: 5,
      skippedUnmapped: 30,
      skippedTwinOpen: 7,
      failed: 0,
      reposFailed: 0,
      truncated: false,
    });
    expect(msg).toContain("closed 5 GitHub issue(s)");
    expect(msg).toContain("0 failed");
    expect(msg).toContain("scanned 42 open");
  });
});
