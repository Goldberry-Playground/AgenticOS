import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// vi.mock is hoisted to the top of the file; use vi.hoisted() to lift spies.
// ---------------------------------------------------------------------------

const { mockHealth, mockAgents, mockHeartbeatRuns, mockCreatePaperclipClient } =
  vi.hoisted(() => {
    const mockHealth = vi.fn();
    const mockAgents = vi.fn();
    const mockHeartbeatRuns = vi.fn();
    const mockCreatePaperclipClient = vi.fn(() => ({
      health: mockHealth,
      agents: mockAgents,
      heartbeatRuns: mockHeartbeatRuns,
    }));
    return { mockHealth, mockAgents, mockHeartbeatRuns, mockCreatePaperclipClient };
  });

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

// Mock the Hermes client so the existing path is tested in isolation.
const { mockListTasks, mockGetHermesClient } = vi.hoisted(() => {
  const mockListTasks = vi.fn();
  const mockGetHermesClient = vi.fn(() => ({ listTasks: mockListTasks }));
  return { mockListTasks, mockGetHermesClient };
});

vi.mock("@/lib/agent", () => ({
  getHermesClient: mockGetHermesClient,
}));

// Import after mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Tests — Paperclip path (DASHBOARD_DATA_SOURCE=paperclip)
// ---------------------------------------------------------------------------

describe("GET /api/agent/health — Paperclip path (DASHBOARD_DATA_SOURCE=paperclip)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-attach factory after resetAllMocks clears return values.
    mockCreatePaperclipClient.mockReturnValue({
      health: mockHealth,
      agents: mockAgents,
      heartbeatRuns: mockHeartbeatRuns,
    });
    // Activate Paperclip path.
    process.env.DASHBOARD_DATA_SOURCE = "paperclip";
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

  it('returns status "ok" when health passes, an agent is running, and latest run is not stuck', async () => {
    mockHealth.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-1",
          companyId: "co-test",
          name: "Daily Brief",
          status: "running",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1000,
        },
      ],
    });
    // Per-agent query: returns the single latest run for agent-1.
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "run-1",
          companyId: "co-test",
          agentId: "agent-1",
          status: "running",
          invocationSource: "cron",
          triggerDetail: null,
          startedAt: "2026-06-17T10:00:00.000Z",
          finishedAt: null,
          createdAt: "2026-06-17T09:59:59.000Z",
          livenessState: "alive",
          livenessReason: null,
          contextSnapshot: null,
          resultJson: null,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    // One per-agent call with agentId filter.
    expect(mockHeartbeatRuns).toHaveBeenCalledTimes(1);
    expect(mockHeartbeatRuns).toHaveBeenCalledWith({ agentId: "agent-1", limit: 1 });
  });

  it('returns status "degraded" when health passes but no agent is running', async () => {
    mockHealth.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-1",
          companyId: "co-test",
          name: "Daily Brief",
          status: "idle",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1000,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
  });

  it('returns status "degraded" when health passes, agent is running, but latest run is stuck', async () => {
    mockHealth.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-1",
          companyId: "co-test",
          name: "Daily Brief",
          status: "running",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1000,
        },
      ],
    });
    // Per-agent query: returns the single latest run for agent-1, which is stuck.
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "run-1",
          companyId: "co-test",
          agentId: "agent-1",
          status: "running",
          invocationSource: "cron",
          triggerDetail: null,
          startedAt: "2026-06-17T10:00:00.000Z",
          finishedAt: null,
          createdAt: "2026-06-17T09:59:59.000Z",
          livenessState: "stuck",
          livenessReason: "no heartbeat for 5 minutes",
          contextSnapshot: null,
          resultJson: null,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
    // One per-agent call with agentId filter.
    expect(mockHeartbeatRuns).toHaveBeenCalledTimes(1);
    expect(mockHeartbeatRuns).toHaveBeenCalledWith({ agentId: "agent-1", limit: 1 });
  });

  it('returns status "down" with 503 when health() fails', async () => {
    mockHealth.mockResolvedValue({ ok: false, error: "HTTP 503 Service Unavailable" });

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("down");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    // Client factory must NOT have been called — no config available.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  // ── Multi-agent tests ──────────────────────────────────────────────────────

  it('multi-agent: agent A stuck + agent B healthy → overall "ok" (B saves it)', async () => {
    mockHealth.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-A",
          companyId: "co-test",
          name: "Agent A",
          status: "running",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1000,
        },
        {
          id: "agent-B",
          companyId: "co-test",
          name: "Agent B",
          status: "running",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 500,
        },
      ],
    });
    // Per-agent queries (one call per agent, agentId filtered, limit:1).
    // agent-A → stuck; agent-B → alive.
    mockHeartbeatRuns
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: "run-A-1",
            companyId: "co-test",
            agentId: "agent-A",
            status: "running",
            invocationSource: "cron",
            triggerDetail: null,
            startedAt: "2026-06-17T10:00:00.000Z",
            finishedAt: null,
            createdAt: "2026-06-17T09:59:59.000Z",
            livenessState: "stuck",
            livenessReason: "no heartbeat for 5 minutes",
            contextSnapshot: null,
            resultJson: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: "run-B-1",
            companyId: "co-test",
            agentId: "agent-B",
            status: "running",
            invocationSource: "cron",
            triggerDetail: null,
            startedAt: "2026-06-17T10:01:00.000Z",
            finishedAt: null,
            createdAt: "2026-06-17T10:00:59.000Z",
            livenessState: "alive",
            livenessReason: null,
            contextSnapshot: null,
            resultJson: null,
          },
        ],
      });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    // Two per-agent calls — one per running agent, each with agentId filter.
    expect(mockHeartbeatRuns).toHaveBeenCalledTimes(2);
    expect(mockHeartbeatRuns).toHaveBeenCalledWith({ agentId: "agent-A", limit: 1 });
    expect(mockHeartbeatRuns).toHaveBeenCalledWith({ agentId: "agent-B", limit: 1 });
  });

  it('multi-agent: only running agent has a stuck latest run → overall "degraded"', async () => {
    mockHealth.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-A",
          companyId: "co-test",
          name: "Agent A",
          status: "running",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1000,
        },
        {
          id: "agent-B",
          companyId: "co-test",
          name: "Agent B",
          status: "idle",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 500,
        },
      ],
    });
    // Only agent-A is running — only one per-agent call is made (agent-B is idle,
    // so it is not included in runningAgents and gets no heartbeat query).
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "run-A-1",
          companyId: "co-test",
          agentId: "agent-A",
          status: "running",
          invocationSource: "cron",
          triggerDetail: null,
          startedAt: "2026-06-17T10:00:00.000Z",
          finishedAt: null,
          createdAt: "2026-06-17T09:59:59.000Z",
          livenessState: "stuck",
          livenessReason: "no heartbeat for 5 minutes",
          contextSnapshot: null,
          resultJson: null,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.paperclip?.stuck).toBe(true);
    // Only one per-agent call for agent-A (agent-B is idle, not queried).
    expect(mockHeartbeatRuns).toHaveBeenCalledTimes(1);
    expect(mockHeartbeatRuns).toHaveBeenCalledWith({ agentId: "agent-A", limit: 1 });
  });
});

// ---------------------------------------------------------------------------
// Tests — Hermes path (env var unset / anything other than "paperclip")
// ---------------------------------------------------------------------------

describe("GET /api/agent/health — Hermes path (DASHBOARD_DATA_SOURCE unset)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetHermesClient.mockReturnValue({ listTasks: mockListTasks });
    // Ensure Paperclip path is NOT active.
    delete process.env.DASHBOARD_DATA_SOURCE;
  });

  afterEach(() => {
    delete process.env.DASHBOARD_DATA_SOURCE;
  });

  it("uses Hermes and does NOT call the Paperclip client when DASHBOARD_DATA_SOURCE is unset", async () => {
    mockListTasks.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("hermes");

    // Paperclip client must not be called.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("returns degraded with 503 when Hermes listTasks throws", async () => {
    mockListTasks.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body).toHaveProperty("hermes");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
