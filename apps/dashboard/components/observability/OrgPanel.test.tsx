import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { OrgPanel } from "./OrgPanel";
import type { OrgNode } from "@/lib/paperclip/client";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

interface MockApproval {
  id: string;
  type: string;
  requestedBy: string | null;
  status: string;
}

function makeFetchImpl(org: OrgNode[] | null, approvals: MockApproval[], status = 200) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url === "/api/org") {
      return new Response(JSON.stringify({ org }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "/api/approvals") {
      return new Response(JSON.stringify({ approvals }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
}

describe("OrgPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Title ──────────────────────────────────────────────────────────────────

  it("renders the panel title", async () => {
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl([], []));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText("Org")).toBeInTheDocument();
    });
  });

  // ── Empty states ───────────────────────────────────────────────────────────

  it("shows org empty state when org is null", async () => {
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl(null, []));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no org data/i)).toBeInTheDocument();
    });
  });

  it("shows org empty state when org is an empty array", async () => {
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl([], []));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no org data/i)).toBeInTheDocument();
    });
  });

  it("shows approvals empty state when there are no pending approvals", async () => {
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl([], []));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no pending approvals/i)).toBeInTheDocument();
    });
  });

  // ── Recursive org tree ─────────────────────────────────────────────────────

  it("renders a root node name, role and status", async () => {
    const tree: OrgNode[] = [
      { id: "bob", name: "Bob", role: "ceo", status: "active", reports: [] },
    ];
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl(tree, []));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("ceo")).toBeInTheDocument();
      // status chip
      expect(screen.getByText("active")).toBeInTheDocument();
    });
  });

  it("renders a nested child node (recursive tree)", async () => {
    const tree: OrgNode[] = [
      {
        id: "bob",
        name: "Bob",
        role: "ceo",
        status: "active",
        reports: [
          {
            id: "alice",
            name: "Alice",
            role: "ic",
            status: "active",
            reports: [],
          },
        ],
      },
    ];
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl(tree, []));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
      // Child node is rendered
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("ic")).toBeInTheDocument();
    });
  });

  it("renders deeply nested grandchild node", async () => {
    const tree: OrgNode[] = [
      {
        id: "a",
        name: "CEO",
        role: "ceo",
        status: "active",
        reports: [
          {
            id: "b",
            name: "VP Eng",
            role: "vp",
            status: "active",
            reports: [
              {
                id: "c",
                name: "IC Dev",
                role: "ic",
                status: "active",
                reports: [],
              },
            ],
          },
        ],
      },
    ];
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl(tree, []));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText("CEO")).toBeInTheDocument();
      expect(screen.getByText("VP Eng")).toBeInTheDocument();
      expect(screen.getByText("IC Dev")).toBeInTheDocument();
    });
  });

  // ── Approvals subsection ──────────────────────────────────────────────────

  it("renders the Approvals subsection heading", async () => {
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl([], []));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      // The heading "Approvals" (case-insensitive exact text) should be present
      expect(screen.getByText("Approvals")).toBeInTheDocument();
    });
  });

  it("renders a pending approval with type, requester, and status", async () => {
    const approvals: MockApproval[] = [
      {
        id: "appr-1",
        type: "budget_override_required",
        requestedBy: "agent-abc",
        status: "pending",
      },
    ];
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl([], approvals));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText("budget_override_required")).toBeInTheDocument();
      expect(screen.getByText("agent-abc")).toBeInTheDocument();
      expect(screen.getByText("pending")).toBeInTheDocument();
    });
  });

  it("renders '—' for requestedBy when it is null", async () => {
    const approvals: MockApproval[] = [
      {
        id: "appr-2",
        type: "hire_agent",
        requestedBy: null,
        status: "pending",
      },
    ];
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl([], approvals));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText("hire_agent")).toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  it("renders multiple approvals", async () => {
    const approvals: MockApproval[] = [
      { id: "a1", type: "hire_agent", requestedBy: "agent-1", status: "pending" },
      { id: "a2", type: "approve_ceo_strategy", requestedBy: "agent-2", status: "pending" },
    ];
    vi.spyOn(global, "fetch").mockImplementation(makeFetchImpl([], approvals));
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText("hire_agent")).toBeInTheDocument();
      expect(screen.getByText("approve_ceo_strategy")).toBeInTheDocument();
      expect(screen.getByText("agent-1")).toBeInTheDocument();
      expect(screen.getByText("agent-2")).toBeInTheDocument();
    });
  });

  // ── Error state ───────────────────────────────────────────────────────────

  it("shows error state when the org fetch fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      makeFetchImpl(null, [], 503),
    );
    renderWithClient(<OrgPanel />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });
});
