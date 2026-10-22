import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { SkillsCatalogPanel } from "./SkillsCatalogPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("SkillsCatalogPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders skill rows from /api/vault/skills", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          totalRegistered: 2,
          skills: [
            {
              name: "triage",
              description: "Triage incoming inbox items",
              triggers: ["inbox-add"],
              usedBy: ["curator", "daily-brief"],
              path: "wiki/Skills/triage.md",
            },
            {
              name: "code-review",
              description: "Review pull requests",
              triggers: [],
              usedBy: [],
              path: "wiki/Skills/code-review.md",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    renderWithClient(<SkillsCatalogPanel />);
    await waitFor(() => {
      expect(screen.getByText("Skills catalog")).toBeInTheDocument();
      expect(screen.getByText("2 registered")).toBeInTheDocument();
      expect(screen.getByText("triage")).toBeInTheDocument();
      expect(screen.getByText("Triage incoming inbox items")).toBeInTheDocument();
      expect(screen.getByText("used by curator · daily-brief")).toBeInTheDocument();
      expect(screen.getByText("code-review")).toBeInTheDocument();
    });
  });

  it("renders an unavailable state when the fetch fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response("", { status: 502 });
    });

    renderWithClient(<SkillsCatalogPanel />);
    await waitFor(() => {
      expect(screen.getByText("Skills catalog unavailable.")).toBeInTheDocument();
    });
  });
});
