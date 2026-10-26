import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { RecentVaultChangesPanel } from "./RecentVaultChangesPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RecentVaultChangesPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders vault changes with file paths and kind pills", async () => {
    const now = new Date().toISOString();
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          source: "syncthing",
          available: true,
          changes: [
            { path: "farming/pasture-management/rotation.md", kind: "updated", occurredAt: now },
            { path: "farming/soil-health/ph-zones.md", kind: "created", occurredAt: now },
            { path: "farming/forage/winter-stockpile.md", kind: "updated", occurredAt: now },
            { path: "dev/code-review-style.md", kind: "updated", occurredAt: now },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    renderWithClient(<RecentVaultChangesPanel />);
    await waitFor(() => {
      expect(screen.getByText("Recent vault changes")).toBeInTheDocument();
      expect(screen.getByText("farming/pasture-management/rotation.md")).toBeInTheDocument();
      expect(screen.getByText("farming/soil-health/ph-zones.md")).toBeInTheDocument();
      expect(screen.getByText("created")).toBeInTheDocument();
      expect(screen.getAllByText("updated").length).toBeGreaterThanOrEqual(3);
      expect(screen.getByText("syncthing · live")).toBeInTheDocument();
    });
  });

  it("renders an offline state when syncthing is unavailable", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ source: "syncthing", available: false, changes: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    renderWithClient(<RecentVaultChangesPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Syncthing offline/)).toBeInTheDocument();
      expect(screen.getByText("syncthing · offline")).toBeInTheDocument();
    });
  });
});
