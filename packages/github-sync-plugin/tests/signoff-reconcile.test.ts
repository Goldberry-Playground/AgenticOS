import { describe, it, expect, vi } from "vitest";
import { isSignoffCheckGreen, runSignoffReconcile, type SignoffReconcileInput } from "../src/signoff-reconcile.js";
import type { PrReviewRow } from "../src/pr-review-store.js";
import type { SyncLogger } from "../src/sync.js";
import type { GitHubClient } from "../src/github-client.js";

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

type CheckRun = { name: string; status: string; conclusion: string | null };
const green = (name: string): CheckRun => ({ name, status: "completed", conclusion: "success" });
const pending = (name: string): CheckRun => ({ name, status: "in_progress", conclusion: null });

function row(over: Partial<PrReviewRow>): PrReviewRow {
  return {
    githubRepo: "acme/repo",
    prNumber: 1,
    reviewer: "ada",
    headSha: "sha1",
    paperclipIssueId: "iss-1",
    updatedAt: "2026-08-03T00:00:00Z",
    ...over,
  };
}

/** A fake GitHubClient exposing only the method runSignoffReconcile touches. */
function fakeClient(
  checksByHead: Record<string, CheckRun[] | "error">,
  listSpy?: (sha: string) => void,
): GitHubClient {
  return {
    async listCommitCheckRuns(_repo: string, sha: string) {
      listSpy?.(sha);
      const c = checksByHead[sha];
      if (c === "error") return { ok: false, status: 401, error: "broker 401" } as any;
      return { ok: true, data: c ?? [] } as any;
    },
  } as unknown as GitHubClient;
}

function makeInput(over: Partial<SignoffReconcileInput> & { rows: PrReviewRow[] } & {
  issueStatus?: Record<string, string>;
  checksByHead?: Record<string, CheckRun[] | "error">;
  clientForRepo?: (repo: string) => { github: GitHubClient; repo: string } | null;
}): { input: SignoffReconcileInput; drove: string[]; listCalls: string[] } {
  const drove: string[] = [];
  const listCalls: string[] = [];
  const github = fakeClient(over.checksByHead ?? {}, (sha) => listCalls.push(sha));
  const input: SignoffReconcileInput = {
    companyId: "co-1",
    sinceIso: "2026-08-01T00:00:00Z",
    limit: 100,
    listRows: async () => over.rows,
    getIssueStatus: async (issueId) => over.issueStatus?.[issueId] ?? null,
    resolveRepoClient:
      over.clientForRepo ?? ((repo) => ({ github, repo: repo.split("/").pop()! })),
    driveSignoff: async (issueId) => {
      drove.push(issueId);
    },
    logger: silentLogger,
  };
  return { input, drove, listCalls };
}

describe("isSignoffCheckGreen", () => {
  it("true only for a completed+success agent-review check for that reviewer", () => {
    expect(isSignoffCheckGreen([green("agent-review/ada")], "ada")).toBe(true);
    expect(isSignoffCheckGreen([pending("agent-review/ada")], "ada")).toBe(false);
    expect(isSignoffCheckGreen([green("agent-review/iris")], "ada")).toBe(false);
    expect(isSignoffCheckGreen([{ name: "agent-review/ada", status: "completed", conclusion: "failure" }], "ada")).toBe(false);
    expect(isSignoffCheckGreen([], "ada")).toBe(false);
  });
});

describe("runSignoffReconcile", () => {
  it("re-drives a signed-off review issue whose check is still pending", async () => {
    const { input, drove } = makeInput({
      rows: [row({ paperclipIssueId: "iss-1", headSha: "sha1" })],
      issueStatus: { "iss-1": "done" },
      checksByHead: { sha1: [pending("agent-review/ada")] },
    });
    const s = await runSignoffReconcile(input);
    expect(drove).toEqual(["iss-1"]);
    expect(s).toMatchObject({ scanned: 1, healed: 1, skipped: 0, failed: 0 });
  });

  it("skips a healthy (already-green) check without driving", async () => {
    const { input, drove } = makeInput({
      rows: [row({ headSha: "sha1" })],
      issueStatus: { "iss-1": "done" },
      checksByHead: { sha1: [green("agent-review/ada")] },
    });
    const s = await runSignoffReconcile(input);
    expect(drove).toEqual([]);
    expect(s).toMatchObject({ healed: 0, skipped: 1 });
  });

  it("skips a review issue that is not `done` (gate correctly pending, fail-closed)", async () => {
    const { input, drove } = makeInput({
      rows: [row({ headSha: "sha1" })],
      issueStatus: { "iss-1": "in_progress" },
      checksByHead: { sha1: [pending("agent-review/ada")] },
    });
    const s = await runSignoffReconcile(input);
    expect(drove).toEqual([]);
    expect(s).toMatchObject({ healed: 0, skipped: 1 });
  });

  it("re-drives once per (repo, PR) even with both reviewers stranded, sharing one check read", async () => {
    const { input, drove, listCalls } = makeInput({
      rows: [
        row({ reviewer: "ada", paperclipIssueId: "iss-ada", headSha: "sha1" }),
        row({ reviewer: "iris", paperclipIssueId: "iss-iris", headSha: "sha1" }),
      ],
      issueStatus: { "iss-ada": "done", "iss-iris": "done" },
      checksByHead: { sha1: [pending("agent-review/ada"), pending("agent-review/iris")] },
    });
    const s = await runSignoffReconcile(input);
    expect(drove).toHaveLength(1); // one re-drive covers every reviewer on the PR
    expect(listCalls).toEqual(["sha1"]); // check-run read cached by head
    expect(s).toMatchObject({ scanned: 2, healed: 1, skipped: 1 });
  });

  it("skips an unbridged repo (no client to post with)", async () => {
    const { input, drove } = makeInput({
      rows: [row({ headSha: "sha1" })],
      issueStatus: { "iss-1": "done" },
      checksByHead: { sha1: [pending("agent-review/ada")] },
      clientForRepo: () => null,
    });
    const s = await runSignoffReconcile(input);
    expect(drove).toEqual([]);
    expect(s).toMatchObject({ healed: 0, skipped: 1 });
  });

  it("counts a check-run read failure as failed and retries next sweep (no drive)", async () => {
    const { input, drove } = makeInput({
      rows: [row({ headSha: "sha1" })],
      issueStatus: { "iss-1": "done" },
      checksByHead: { sha1: "error" },
    });
    const s = await runSignoffReconcile(input);
    expect(drove).toEqual([]);
    expect(s).toMatchObject({ healed: 0, failed: 1 });
  });

  it("counts a driveSignoff throw as failed without aborting the sweep", async () => {
    const { input } = makeInput({
      rows: [
        row({ prNumber: 1, paperclipIssueId: "iss-1", headSha: "sha1" }),
        row({ prNumber: 2, paperclipIssueId: "iss-2", headSha: "sha2" }),
      ],
      issueStatus: { "iss-1": "done", "iss-2": "done" },
      checksByHead: { sha1: [pending("agent-review/ada")], sha2: [pending("agent-review/ada")] },
    });
    let n = 0;
    input.driveSignoff = async () => {
      if (n++ === 0) throw new Error("broker 401");
    };
    const s = await runSignoffReconcile(input);
    expect(s).toMatchObject({ scanned: 2, healed: 1, failed: 1 });
  });
});
