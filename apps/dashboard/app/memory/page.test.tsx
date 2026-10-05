import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import MemoryPage from "./page";

// nuqs URL-state hook — stub so the page renders without a NuqsAdapter.
vi.mock("nuqs", () => ({
  useQueryState: () => ["", vi.fn()],
  parseAsString: { withDefault: () => ({}) },
}));

vi.mock("@/lib/filter/use-filter", () => ({
  useFilter: () => ({
    tags: [],
    setTags: vi.fn(),
    toggleTag: vi.fn(),
    clear: vi.fn(),
  }),
}));

// The page composes many heavy vault-backed panels; stub the siblings so the
// test isolates the left-rail inbox surface (MemoryTree → InboxQueue stays real).
vi.mock("@/components/shell/MemoryVista", () => ({ MemoryVista: () => null }));
vi.mock("@/components/memory/MemoryReader", () => ({
  MemoryReader: () => null,
}));
vi.mock("@/components/memory/MemoryRail", () => ({ MemoryRail: () => null }));
vi.mock("@/components/memory/MemorySyncIndicator", () => ({
  MemorySyncIndicator: () => null,
}));
vi.mock("@/components/memory/GraphCanvas", () => ({ GraphCanvas: () => null }));
vi.mock("@/components/memory/SkillsCatalogPanel", () => ({
  SkillsCatalogPanel: () => null,
}));
vi.mock("@/components/memory/RecentVaultChangesPanel", () => ({
  RecentVaultChangesPanel: () => null,
}));

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("Memory page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces the functional inbox in the left rail (no Phase E placeholder)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const body = url.includes("/api/vault/inbox")
        ? { items: [] }
        : { tree: { kind: "folder", name: "root", path: "", children: [] }, flatPaths: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    renderWithClient(<MemoryPage />);

    // Expand the inbox collapsible in the tree rail.
    fireEvent.click(screen.getByRole("button", { name: /Inbox/i }));

    expect(
      screen.queryByText(/Inbox processing wires up in Phase E/i),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Inbox is empty/i)).toBeInTheDocument();
    });
  });

  // GOL-2950: the toggle used to live inside MemoryReader, which unmounts in
  // graph mode — so its "on" state was unreachable and there was no way back
  // to the reader. It now lives in the toolbar and reports state via
  // aria-pressed rather than text colour alone.
  it("keeps the graph-view toggle in the toolbar and reports state via aria-pressed", () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      const body = {
        tree: { kind: "folder", name: "root", path: "", children: [] },
        flatPaths: [],
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    renderWithClient(<MemoryPage />);

    const toggle = screen.getByRole("button", { name: /^Graph view$/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    // Still mounted in graph mode, and now pressed.
    const pressed = screen.getByRole("button", { name: /^Graph view$/i });
    expect(pressed).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pressed);
    expect(
      screen.getByRole("button", { name: /^Graph view$/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
