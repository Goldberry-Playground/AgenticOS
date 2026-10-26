import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// vi.mock is hoisted to the top of the file; use vi.hoisted() to lift spies.
// ---------------------------------------------------------------------------

const { mockCostSummary, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockCostSummary = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    costSummary: mockCostSummary,
  }));
  return { mockCostSummary, mockCreatePaperclipClient };
});

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

// Mock the data-source flag so we can switch between paths.
const { mockDataSource } = vi.hoisted(() => {
  const mockDataSource = vi.fn(() => "hermes" as "hermes" | "paperclip");
  return { mockDataSource };
});

vi.mock("@/lib/config/data-source", () => ({
  dataSource: mockDataSource,
}));

// Mock the Hermes DB pool so the existing path is tested in isolation.
const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  return { mockQuery };
});

vi.mock("@/lib/cost/db", () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

// Import after mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(range?: string) {
  const url = new URL("http://localhost/api/cost/burndown");
  if (range) url.searchParams.set("range", range);
  return new Request(url.toString());
}

// ---------------------------------------------------------------------------
// Tests — Paperclip path (DASHBOARD_DATA_SOURCE=paperclip)
// ---------------------------------------------------------------------------

describe("GET /api/cost/burndown — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-attach factory and spies after resetAllMocks.
    mockCreatePaperclipClient.mockReturnValue({ costSummary: mockCostSummary });
    mockDataSource.mockReturnValue("paperclip");
    // Provide Paperclip env config.
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.DASHBOARD_DATA_SOURCE;
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("maps per-day costSummary fan-out to BurndownResponse for 30d range", async () => {
    // Return a fixed spend for every costSummary call.
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: {
        companyId: "co-test",
        spendCents: 1500,
        budgetCents: 50000,
        utilizationPercent: 3,
      },
    });

    const res = await GET(makeRequest("30d"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.range).toBe("30d");
    expect(body.bucket).toBe("day");
    expect(Array.isArray(body.points)).toBe(true);
    // Should have at most 31 points (capped N=31).
    expect(body.points.length).toBeLessThanOrEqual(31);
    expect(body.points.length).toBeGreaterThan(0);
    // Each point must have `at` (ISO date string) and `cents` (number).
    for (const p of body.points) {
      expect(typeof p.at).toBe("string");
      expect(typeof p.cents).toBe("number");
    }
    // costSummary must have been called once per day.
    expect(mockCostSummary).toHaveBeenCalledTimes(body.points.length);
  });

  it("maps per-day costSummary fan-out to BurndownResponse for 24h range (1 day)", async () => {
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: {
        companyId: "co-test",
        spendCents: 800,
        budgetCents: 0,
        utilizationPercent: 0,
      },
    });

    const res = await GET(makeRequest("24h"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.range).toBe("24h");
    expect(body.bucket).toBe("day");
    // 24h → 1 day point (today).
    expect(body.points).toHaveLength(1);
    expect(body.points[0].cents).toBe(800);
  });

  it("returns spendCents from each daily costSummary as the point cents", async () => {
    // Return different values per call to confirm the mapping.
    mockCostSummary
      .mockResolvedValueOnce({
        ok: true,
        data: { companyId: "co-test", spendCents: 100, budgetCents: 1000, utilizationPercent: 10 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { companyId: "co-test", spendCents: 200, budgetCents: 1000, utilizationPercent: 20 },
      })
      .mockResolvedValue({
        ok: true,
        data: { companyId: "co-test", spendCents: 300, budgetCents: 1000, utilizationPercent: 30 },
      });

    // Use a 3-day range (not a real API range, but the route internally only
    // fans out N days; 30d is the max range that triggers multi-day calls).
    const res = await GET(makeRequest("30d"));
    expect(res.status).toBe(200);

    const body = await res.json();
    // First point corresponds to the earliest day, last to yesterday/today.
    // Values should match the mock sequence (first 3 calls → 100, 200, then 300 for rest).
    expect(body.points[0].cents).toBe(100);
    expect(body.points[1].cents).toBe(200);
  });

  it("returns 503 with {error} when any daily costSummary call fails (fail-closed)", async () => {
    // First call succeeds, second fails.
    mockCostSummary
      .mockResolvedValueOnce({
        ok: true,
        data: { companyId: "co-test", spendCents: 500, budgetCents: 1000, utilizationPercent: 50 },
      })
      .mockResolvedValueOnce({ ok: false, error: "HTTP 502 Bad Gateway" })
      .mockResolvedValue({
        ok: true,
        data: { companyId: "co-test", spendCents: 300, budgetCents: 1000, utilizationPercent: 30 },
      });

    const res = await GET(makeRequest("30d"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET(makeRequest("30d"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Hermes path (DASHBOARD_DATA_SOURCE unset / "hermes")
// ---------------------------------------------------------------------------

describe("GET /api/cost/burndown — Hermes path (dataSource()=hermes)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
    mockQuery.mockResolvedValue({
      rows: [{ at: "2026-06-17T00:00:00", cents: 4200 }],
    });
  });

  afterEach(() => {
    delete process.env.DASHBOARD_DATA_SOURCE;
  });

  it("uses Hermes DB and does NOT call the Paperclip client", async () => {
    const res = await GET(makeRequest("30d"));
    expect(res.status).toBe(200);

    const body = await res.json();
    // Hermes path returns the raw DB rows.
    expect(body.range).toBe("30d");
    expect(body.bucket).toBe("day");
    expect(body.points).toHaveLength(1);
    expect(body.points[0].cents).toBe(4200);

    // Paperclip client must not be called.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
