import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";

describe("VistaShell", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the dusk console chrome with horizons and live meta", () => {
    const { container } = render(
      <VistaShell backdrop={<div data-testid="bd" />}>
        <KpiTile value="1" label="alpha" />
        <KpiTile value="2" label="beta" />
        <KpiTile value="3" label="gamma" />
        <KpiTile value="4" label="delta" />
      </VistaShell>,
    );
    expect(container.querySelector(".kpi-vista")).not.toBeNull();
    expect(container.querySelectorAll(".horizon").length).toBe(2);
    expect(container.querySelector(".vista-meta")).not.toBeNull();
    expect(container.querySelector(".live-dot")).not.toBeNull();
    expect(screen.getByTestId("bd")).toBeTruthy();
  });

  it("renders the supplied KPI tiles inside .kpi-grid", () => {
    const { container } = render(
      <VistaShell backdrop={null}>
        <KpiTile value="1" label="alpha" />
        <KpiTile value="2" label="beta" />
        <KpiTile value="3" label="gamma" />
        <KpiTile value="4" label="delta" />
      </VistaShell>,
    );
    const tiles = container.querySelectorAll(".kpi-grid > .kpi");
    expect(tiles.length).toBe(4);
  });

  it("applies data-accent attribute (defaults to gold)", () => {
    const { container, rerender } = render(
      <VistaShell backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );
    expect(
      container.querySelector(".kpi-vista")?.getAttribute("data-accent"),
    ).toBe("gold");

    rerender(
      <VistaShell accent="copper" backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );
    expect(
      container.querySelector(".kpi-vista")?.getAttribute("data-accent"),
    ).toBe("copper");
  });

  it("formats asOfMs into HH:MM:SS in the live indicator", () => {
    const at = new Date("2026-05-28T09:07:03Z").getTime();
    const { container } = render(
      <VistaShell asOfMs={at} backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );
    const d = new Date(at);
    const expected = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => n.toString().padStart(2, "0"))
      .join(":");
    expect(container.querySelector(".vista-meta")?.textContent).toBe(
      `Live · as of ${expected}`,
    );
  });

  /**
   * GOL-3073 — the regression that took `main` red at e193e91.
   *
   * `formatTime(asOf)` fell back to `new Date()` whenever `asOf` was absent,
   * and all five vistas passed `useMemo(() => new Date().toISOString(), [])`,
   * which is a fresh reading in each environment rather than one shared value.
   * Either way the server and the client printed whatever second they happened
   * to run in; one tick between SSR and hydration is a text mismatch, and
   * React's recovery is to discard the server DOM and regenerate the tree.
   * That wiped the `data-focus-probe` attributes `e2e/focus-visible.spec.ts`
   * writes onto the header, so the spec reached zero controls and failed.
   *
   * The assertion is the invariant rather than the symptom: with identical
   * props, the markup the server produces and the markup the client's first
   * render produces must match even when the wall clock moves between them.
   */
  it("prints identical live-indicator markup on the server and on first client render when the clock advances", () => {
    vi.useFakeTimers();

    const tree = (
      <VistaShell backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>
    );

    vi.setSystemTime(new Date("2026-10-05T23:30:26.900Z"));
    const serverHtml = renderToString(tree);

    // The second rolls over before React gets to hydrate.
    vi.setSystemTime(new Date("2026-10-05T23:30:27.100Z"));
    const { container } = render(tree);

    const host = document.createElement("div");
    host.innerHTML = serverHtml;

    expect(host.querySelector(".vista-meta")?.textContent).toBe(
      container.querySelector(".vista-meta")?.textContent,
    );
  });

  it("shows an em-dash, not the current time, when no fetch has resolved", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T23:30:26.000Z"));

    const { container } = render(
      <VistaShell backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );

    expect(container.querySelector(".vista-meta")?.textContent).toBe(
      "Live · as of \u2014",
    );
  });

  it("treats asOfMs={0} as 'no data yet' rather than the Unix epoch", () => {
    const { container } = render(
      <VistaShell asOfMs={0} backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );
    expect(container.querySelector(".vista-meta")?.textContent).toBe(
      "Live · as of \u2014",
    );
  });

  /**
   * The other half of GOL-2653: the old label was sampled once at first paint
   * and never again, so it froze while the readings beside it refreshed every
   * 30s. It now reports the query's own `dataUpdatedAt` — when the data was
   * actually fetched, which is what "as of" claimed all along.
   */
  it("reports the as-of time of the data, not the time of render", () => {
    vi.useFakeTimers();
    const fetchedAt = new Date("2026-10-05T18:07:05.000Z").getTime();
    vi.setSystemTime(fetchedAt + 45 * 60_000);

    const { container } = render(
      <VistaShell asOfMs={fetchedAt} backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );

    const d = new Date(fetchedAt);
    const expected = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => n.toString().padStart(2, "0"))
      .join(":");
    expect(container.querySelector(".vista-meta")?.textContent).toBe(
      `Live · as of ${expected}`,
    );
  });
});
