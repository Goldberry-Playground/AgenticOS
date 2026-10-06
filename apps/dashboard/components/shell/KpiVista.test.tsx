import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KpiVista } from "./KpiVista";

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactNode, qc = newQueryClient()) {
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Parse a server-rendered HTML string so it can be queried like the DOM. */
function parse(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("KpiVista", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders four KPI tiles", () => {
    const { container } = renderWithQuery(<KpiVista />);
    const tiles = container.querySelectorAll(".kpi-grid > .kpi");
    expect(tiles.length).toBe(4);
  });

  it("renders the four KPI labels", () => {
    renderWithQuery(<KpiVista />);
    expect(screen.getByText(/runs today/i)).toBeTruthy();
    expect(screen.getByText(/active runs/i)).toBeTruthy();
    expect(screen.getByText(/vault files/i)).toBeTruthy();
    expect(screen.getByText(/memories indexed/i)).toBeTruthy();
  });

  it("shows the live indicator", () => {
    const { container } = renderWithQuery(<KpiVista />);
    const meta = container.querySelector(".vista-meta");
    expect(meta).not.toBeNull();
    expect(meta?.textContent).toMatch(/Fleet · live as of/);
    expect(container.querySelector(".live-dot")).not.toBeNull();
  });

  it("does not crash when query data is still loading (no data yet)", () => {
    // First synchronous render happens before queryFn resolves; tiles should
    // still mount with em-dash placeholders.
    const { container } = renderWithQuery(<KpiVista />);
    expect(container.querySelector(".kpi-vista")).not.toBeNull();
  });

  it("mounts the EKG backdrop", () => {
    const { container } = renderWithQuery(<KpiVista />);
    expect(container.querySelector(".ekg-backdrop")).not.toBeNull();
    expect(container.querySelector(".ekg-trace")).not.toBeNull();
  });

  /**
   * GOL-3073 — the regression that took `main` red.
   *
   * `liveTimestamp()` used to read `new Date()` during render, so the server
   * and the client printed whatever second each happened to run in. One tick
   * between SSR and hydration is a text mismatch, and React's recovery is to
   * discard the server DOM and regenerate the tree on the client. That wiped
   * the `data-focus-probe` attributes `e2e/focus-visible.spec.ts` writes onto
   * the header, so the spec reached zero controls and failed — flakily, on
   * whether the second happened to roll over.
   *
   * The assertion is the invariant, not the symptom: the markup the server
   * produces and the markup the client's first render produces must be the
   * same even when the wall clock moves between them.
   */
  it("prints identical live-indicator markup on the server and on first client render when the clock advances (GOL-2653)", () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-10-05T23:30:26.900Z"));
    const serverHtml = renderToString(
      <QueryClientProvider client={newQueryClient()}>
        <KpiVista />
      </QueryClientProvider>,
    );

    // The second rolls over before React gets to hydrate.
    vi.setSystemTime(new Date("2026-10-05T23:30:27.100Z"));
    const { container } = renderWithQuery(<KpiVista />);

    const serverMeta = parse(serverHtml).querySelector(".vista-meta");
    const clientMeta = container.querySelector(".vista-meta");

    expect(serverMeta?.textContent).toBe(clientMeta?.textContent);
    // And it must not be a wall clock at all before any fetch has resolved.
    expect(clientMeta?.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("shows an em-dash, not a fabricated time, until a KPI fetch resolves", () => {
    const { container } = renderWithQuery(<KpiVista />);
    expect(container.querySelector(".vista-meta")?.textContent).toMatch(
      /Fleet · live as of\s*\u2014/,
    );
  });

  /**
   * The other half of GOL-2653: the old clock was sampled once at first paint
   * and never again, so "as of" drifted arbitrarily far from the readings next
   * to it. It now reports the query's own `dataUpdatedAt`, which is the actual
   * instant the data was fetched.
   */
  it("reports the as-of time of the KPI data, not the time of render", () => {
    vi.useFakeTimers();
    const fetchedAt = new Date("2026-10-05T18:07:05.000Z").getTime();
    // Render well after the fetch: a render-time clock would print 19:xx.
    vi.setSystemTime(fetchedAt + 45 * 60_000);

    const qc = newQueryClient();
    qc.setQueryData(
      ["kpi-data"],
      {
        runsToday: { count: 3, spendUsd: 0 },
        activeRuns: { count: 1, delta: 0, kinds: ["heartbeat"] },
        vaultFiles: { count: 11 },
        memoriesIndexed: { count: 1652, categories: ["project"] },
      },
      { updatedAt: fetchedAt },
    );

    const { container } = renderWithQuery(<KpiVista />, qc);

    const d = new Date(fetchedAt);
    const expected = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => n.toString().padStart(2, "0"))
      .join(":");
    expect(container.querySelector(".vista-meta")?.textContent).toContain(
      `Fleet · live as of ${expected}`,
    );
  });
});
