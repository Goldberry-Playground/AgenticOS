import { describe, it, expect, vi } from "vitest";
import {
  runInboundDeadMan,
  buildInboundDeadManPing,
  type RepoActivityResult,
  type InboundDeadManInput,
} from "../src/inbound-dead-man.js";
import type { SyncLogger } from "../src/sync.js";

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

/**
 * Build an input with a stubbed delivery count and a per-repo activity map
 * (`repoSlug → RepoActivityResult`), recording which repos were probed so tests
 * can assert the fast-path short-circuit skips the GitHub probes entirely.
 */
function makeInput(over: {
  deliveries: number;
  activityByRepo?: Record<string, RepoActivityResult>;
  logger?: SyncLogger;
}): { input: InboundDeadManInput; probed: string[] } {
  const activityByRepo = over.activityByRepo ?? {};
  const probed: string[] = [];
  const input: InboundDeadManInput = {
    repoSlugs: Object.keys(activityByRepo),
    countDeliveries: async () => over.deliveries,
    checkActivity: async (repoSlug) => {
      probed.push(repoSlug);
      return activityByRepo[repoSlug] ?? { ok: true, active: false, latestUpdatedAt: null };
    },
    logger: over.logger ?? silentLogger,
  };
  return { input, probed };
}

/** Convenience: a repo that GitHub reports recent activity for. */
function active(latest = "2026-09-21T12:00:00Z"): RepoActivityResult {
  return { ok: true, active: true, latestUpdatedAt: latest };
}
/** Convenience: a repo GitHub reports as quiet in the window. */
function quiet(): RepoActivityResult {
  return { ok: true, active: false, latestUpdatedAt: null };
}

describe("runInboundDeadMan", () => {
  it("is healthy when any delivery landed — no page, and skips the GitHub probes", async () => {
    const { input, probed } = makeInput({
      deliveries: 3,
      activityByRepo: { "org/grove-sites": active() },
    });
    const s = await runInboundDeadMan(input);
    expect(s).toMatchObject({ verdict: "deliveries-present", page: false, deliveries: 3 });
    // Fast path: a live delivery means we never spend REST calls probing GitHub.
    expect(probed).toEqual([]);
    expect(s.reposChecked).toBe(0);
  });

  it("PAGES when zero deliveries landed but a bridged repo shows recent activity (webhook-dead)", async () => {
    const { input } = makeInput({
      deliveries: 0,
      activityByRepo: { "org/grove-sites": active(), "org/odoocker": quiet() },
    });
    const s = await runInboundDeadMan(input);
    expect(s).toMatchObject({ verdict: "webhook-dead", page: true, deliveries: 0 });
    expect(s.activeRepos).toEqual(["org/grove-sites"]);
    expect(s.reposChecked).toBe(2);
  });

  it("does NOT page a genuinely quiet fleet — zero deliveries AND no GitHub activity", async () => {
    const { input } = makeInput({
      deliveries: 0,
      activityByRepo: { "org/grove-sites": quiet(), "org/odoocker": quiet() },
    });
    const s = await runInboundDeadMan(input);
    expect(s).toMatchObject({ verdict: "quiet-fleet", page: false });
    expect(s.activeRepos).toEqual([]);
  });

  it("still pages on a live repo even when another repo's probe fails transiently", async () => {
    const warn = vi.fn();
    const { input } = makeInput({
      deliveries: 0,
      logger: { info() {}, warn, error() {} },
      activityByRepo: {
        "org/broken": { ok: false, error: "broker 401" },
        "org/grove-sites": active(),
      },
    });
    const s = await runInboundDeadMan(input);
    expect(s.verdict).toBe("webhook-dead");
    expect(s.page).toBe(true);
    expect(s.activeRepos).toEqual(["org/grove-sites"]);
    expect(s.reposFailed).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("treats an all-probes-failed run as quiet (never manufactures a page from flaky reads)", async () => {
    const warn = vi.fn();
    const { input } = makeInput({
      deliveries: 0,
      logger: { info() {}, warn, error() {} },
      activityByRepo: {
        "org/a": { ok: false, error: "timeout" },
        "org/b": { ok: false, error: "timeout" },
      },
    });
    const s = await runInboundDeadMan(input);
    // A read failure is transient and never counts as activity — so no false page.
    expect(s).toMatchObject({ verdict: "quiet-fleet", page: false, reposFailed: 2 });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("AC: dropped deliveries + a stubbed recent-activity repo → exactly one page", async () => {
    // Simulate the outage: the delivery table is empty for the window (deliveries: 0),
    // while a bridged repo's REST still shows a fresh PR/issue update.
    const { input } = makeInput({
      deliveries: 0,
      activityByRepo: { "org/grove-sites": active() },
    });
    const s = await runInboundDeadMan(input);
    expect(s.page).toBe(true);
    expect(s.verdict).toBe("webhook-dead");
    const ping = buildInboundDeadManPing(s, 3);
    expect(ping).toContain("⛔");
    expect(ping).toContain("org/grove-sites");
  });
});

describe("buildInboundDeadManPing", () => {
  it("names the window, the active-repo count, and the repos", () => {
    const ping = buildInboundDeadManPing(
      {
        verdict: "webhook-dead",
        page: true,
        deliveries: 0,
        activeRepos: ["org/grove-sites", "org/odoocker"],
        reposChecked: 3,
        reposFailed: 0,
      },
      3,
    );
    expect(ping).toContain("3h");
    expect(ping).toContain("2 bridged repo(s)");
    expect(ping).toContain("org/grove-sites, org/odoocker");
    expect(ping).toContain("⛔");
  });
});
