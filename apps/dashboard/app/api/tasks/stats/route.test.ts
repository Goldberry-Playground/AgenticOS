import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory.
// ---------------------------------------------------------------------------

const { mockHeartbeatRuns, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockHeartbeatRuns = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    heartbeatRuns: mockHeartbeatRuns,
  }));
  return { mockHeartbeatRuns, mockCreatePaperclipClient };
});

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

// Mock the data-source flag.
const { mockDataSource } = vi.hoisted(() => {
  const mockDataSource = vi.fn(() => "hermes" as "hermes" | "paperclip");
  return { mockDataSource };
});

vi.mock("@/lib/config/data-source", () => ({
  dataSource: mockDataSource,
}));

// Mock the Hermes DB pool.
const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  return { mockQuery };
});

vi.mock("@/lib/cost/db", () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

// Import after mocks.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Tests — Hermes path (existing behaviour — must not regress)
// ---------------------------------------------------------------------------

describe("/api/tasks/stats — Hermes path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("coerces SQL text/numeric/array results into a typed RunsStats payload", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          active_count: "3",
          failed_today: "2",
          avg_duration_sec: "107.4",
          active_kinds: ["curator", "daily-brief", "vault-ingest"],
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      activeCount: 3,
      failedToday: 2,
      avgDurationSec: 107.4,
      activeKinds: ["curator", "daily-brief", "vault-ingest"],
    });
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("returns null avg duration when SQL gives null (no completed runs in 24h)", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          active_count: "0",
          failed_today: "0",
          avg_duration_sec: null,
          active_kinds: null,
        },
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.activeCount).toBe(0);
    expect(body.failedToday).toBe(0);
    expect(body.avgDurationSec).toBeNull();
    expect(body.activeKinds).toEqual([]);
  });

  it("survives an empty rowset without throwing", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      activeCount: 0,
      failedToday: 0,
      avgDurationSec: null,
      activeKinds: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/tasks/stats — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreatePaperclipClient.mockReturnValue({ heartbeatRuns: mockHeartbeatRuns });
    mockDataSource.mockReturnValue("paperclip");
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("derives RunsStats from heartbeatRuns correctly", async () => {
    const now = new Date();
    const todayMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();

    // 2 running runs with different invocationSources (for activeKinds)
    const startedAt1 = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const startedAt2 = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    // 1 completed run with known duration (600s = 10min)
    const startedAt3 = new Date(now.getTime() - 12 * 60 * 1000).toISOString();
    const finishedAt3 = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    // 1 failed run today — anchored to the midpoint between today's UTC midnight
    // and now, so it is deterministically "today" even when the suite runs within
    // 30 min after UTC midnight (a fixed "now - 30min" could land on yesterday).
    const failedAt = new Date(
      (new Date(todayMidnight).getTime() + now.getTime()) / 2,
    ).toISOString();

    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "r1",
          status: "running",
          invocationSource: "timer",
          startedAt: startedAt1,
          finishedAt: null,
          createdAt: startedAt1,
          agentId: "a1",
          companyId: "co-1",
          triggerDetail: null,
          livenessState: null,
          livenessReason: null,
          contextSnapshot: null,
          resultJson: null,
        },
        {
          id: "r2",
          status: "running",
          invocationSource: "assignment",
          startedAt: startedAt2,
          finishedAt: null,
          createdAt: startedAt2,
          agentId: "a2",
          companyId: "co-1",
          triggerDetail: null,
          livenessState: null,
          livenessReason: null,
          contextSnapshot: null,
          resultJson: null,
        },
        {
          id: "r3",
          status: "succeeded",
          invocationSource: "on_demand",
          startedAt: startedAt3,
          finishedAt: finishedAt3,
          createdAt: startedAt3,
          agentId: "a3",
          companyId: "co-1",
          triggerDetail: null,
          livenessState: null,
          livenessReason: null,
          contextSnapshot: null,
          resultJson: null,
        },
        {
          id: "r4",
          status: "failed",
          invocationSource: "automation",
          startedAt: failedAt,
          finishedAt: failedAt,
          createdAt: failedAt,
          agentId: "a4",
          companyId: "co-1",
          triggerDetail: null,
          livenessState: null,
          livenessReason: null,
          contextSnapshot: null,
          resultJson: null,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.activeCount).toBe(2);
    expect(body.failedToday).toBe(1);
    // avgDurationSec: (finishedAt3 - startedAt3) in seconds
    const expectedDuration =
      (new Date(finishedAt3).getTime() - new Date(startedAt3).getTime()) / 1000;
    expect(body.avgDurationSec).toBeCloseTo(expectedDuration, 0);
    // activeKinds: invocationSource values of running runs, deduped and sorted
    expect(body.activeKinds).toEqual(["assignment", "timer"]);

    // Hermes DB must not be touched.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns null avgDurationSec when no succeeded runs have both startedAt and finishedAt", async () => {
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "r1",
          status: "running",
          invocationSource: "timer",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          createdAt: new Date().toISOString(),
          agentId: "a1",
          companyId: "co-1",
          triggerDetail: null,
          livenessState: null,
          livenessReason: null,
          contextSnapshot: null,
          resultJson: null,
        },
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.avgDurationSec).toBeNull();
  });

  it("returns 503 with {error} when heartbeatRuns fails", async () => {
    mockHeartbeatRuns.mockResolvedValueOnce({ ok: false, error: "connection refused" });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
