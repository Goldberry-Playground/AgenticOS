import { describe, it, expect } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { driveSweepReview } from "../src/worker.js";
import type { InboundPrRef } from "../src/pr-review-create-reconcile.js";

/**
 * GOL-2395 regression: the `pr-review-reconcile` sweep must key its DB idempotency
 * pre-check + synthetic review event on the PR's canonical `base.repo.full_name`
 * (`pr.fullName`, webhook casing), NOT the lowercased `clientsBySlug` slug the sweep
 * iterates. The `github_pr_review` store is case-sensitive and the webhook stores twins
 * under `repository.full_name`, so on a MIXED-case repo the old lowercase lookup never
 * matched the webhook row → the sweep re-drove and double-created a second Ada twin.
 *
 * These tests reach only the pre-check boundary (`skipped-current` short-circuits before
 * any GitHub fetch), so a fake `ctx.db` whose `query` keys off the `github_repo` param is
 * enough — no network, no processReviewer.
 */

const NS = "plugin_ns";

/** A stored Ada review row for a specific repo key + head, exposed via a fake db. */
function fakeDb(storedRepo: string, prNumber: number, headSha: string) {
  const queriedRepos: string[] = [];
  const db = {
    namespace: NS,
    async query<T = Record<string, unknown>>(_sql: string, params: unknown[] = []): Promise<T[]> {
      const repo = String(params[0]);
      queriedRepos.push(repo);
      // Case-SENSITIVE match — exactly what the real Postgres `WHERE github_repo=$1` does.
      if (repo === storedRepo && Number(params[1]) === prNumber && params[2] === "ada") {
        return [
          {
            github_repo: storedRepo,
            pr_number: prNumber,
            reviewer: "ada",
            head_sha: headSha,
            paperclip_issue_id: "issue-1",
            updated_at: "2026-09-21T00:00:00.000Z",
          } as unknown as T,
        ];
      }
      return [];
    },
    async execute() {
      return { rowCount: 0 };
    },
  };
  return { db, queriedRepos };
}

/** Minimal cfg with one bridge; only `bridges` + the Ada agent id matter here. */
function cfgFor(githubOrg: string, githubRepo: string) {
  return {
    bridges: [
      {
        githubOrg,
        githubRepo,
        paperclipProjectId: "proj-1",
        syncLabelPaperclip: "sync",
        syncMarkerGithub: "<!--sync-->",
      },
    ],
    prReviewAliceAgentId: "ada-agent",
  };
}

function pr(over: Partial<InboundPrRef> = {}): InboundPrRef {
  return {
    number: 686,
    headSha: "abc123",
    title: "feat: something",
    url: "https://github.com/x/y/pull/686",
    draft: false,
    fullName: "",
    ...over,
  };
}

function makeCtx(db: unknown): PluginContext {
  return {
    db,
    logger: { info() {}, warn() {}, error() {} },
  } as unknown as PluginContext;
}

describe("driveSweepReview repo-key casing (GOL-2395)", () => {
  it("detects a mixed-case webhook twin as current and returns skipped-current", async () => {
    // Webhook stored the twin under the canonical mixed-case full_name at head abc123.
    const CANON = "Goldberry-Playground/AgenticOS";
    const { db, queriedRepos } = fakeDb(CANON, 686, "abc123");
    const cfg = cfgFor("Goldberry-Playground", "AgenticOS");
    // The sweep iterates the LOWERCASED clientsBySlug key — this is the repoSlug arg.
    const repoSlug = "goldberry-playground/agenticos";

    const outcome = await driveSweepReview(
      makeCtx(db),
      cfg,
      repoSlug,
      pr({ number: 686, headSha: "abc123", fullName: CANON }),
    );

    expect(outcome).toBe("skipped-current");
    // The pre-check queried the CANONICAL casing, not the lowercased slug (the old bug).
    expect(queriedRepos).toContain(CANON);
    expect(queriedRepos).not.toContain(repoSlug);
  });

  it("does NOT skip when the webhook twin is on a stale head (proceeds past the pre-check)", async () => {
    // Stored twin is behind the current head → not skipped-current. With no token config
    // makeBridgeGithubClient returns null, so the drive short-circuits to "failed" AFTER
    // the pre-check — proving the mixed-case row did not falsely satisfy it.
    const CANON = "Goldberry-Playground/AgenticOS";
    const { db } = fakeDb(CANON, 686, "OLDsha");
    const cfg = cfgFor("Goldberry-Playground", "AgenticOS");

    const outcome = await driveSweepReview(
      makeCtx(db),
      cfg,
      "goldberry-playground/agenticos",
      pr({ number: 686, headSha: "abc123", fullName: CANON }),
    );

    expect(outcome).toBe("failed");
  });

  it("still skips for an all-lowercase slug (no regression, grove-sites path)", async () => {
    const CANON = "grovehq/grove-sites";
    const { db, queriedRepos } = fakeDb(CANON, 775, "def456");
    const cfg = cfgFor("grovehq", "grove-sites");

    const outcome = await driveSweepReview(
      makeCtx(db),
      cfg,
      "grovehq/grove-sites",
      pr({ number: 775, headSha: "def456", fullName: CANON }),
    );

    expect(outcome).toBe("skipped-current");
    expect(queriedRepos).toContain(CANON);
  });

  it("falls back to the sweep slug when the API omitted full_name", async () => {
    // fullName "" → canonicalRepo = repoSlug; the store was keyed on that slug.
    const SLUG = "grovehq/grove-sites";
    const { db, queriedRepos } = fakeDb(SLUG, 775, "def456");
    const cfg = cfgFor("grovehq", "grove-sites");

    const outcome = await driveSweepReview(
      makeCtx(db),
      cfg,
      SLUG,
      pr({ number: 775, headSha: "def456", fullName: "" }),
    );

    expect(outcome).toBe("skipped-current");
    expect(queriedRepos).toContain(SLUG);
  });
});
