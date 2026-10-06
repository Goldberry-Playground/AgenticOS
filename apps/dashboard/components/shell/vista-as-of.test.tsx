import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchitectureVista } from "./ArchitectureVista";
import { CostVista } from "./CostVista";
import { HealthVista } from "./HealthVista";
import { KpiVista } from "./KpiVista";
import { MemoryVista } from "./MemoryVista";
import { RunsVista } from "./RunsVista";

/**
 * GOL-3073 — `main` went red on `E2E / Playwright` at e193e91 because the
 * "Live · as of" clock was read during render. The server printed one second
 * and the client's first render printed the next, React discarded the server
 * DOM and regenerated the tree, and that deleted the `data-focus-probe`
 * attributes `e2e/focus-visible.spec.ts` had just written onto the header — so
 * an a11y spec failed with "reached: (nothing)" and named no cause.
 *
 * There were two clocks, not one. Fixing `KpiVista` (mounted in the root
 * layout) left `VistaShell`, which every per-tab vista renders, and the suite
 * went from 2 failures to 3. Hence this table: one assertion per vista, so the
 * next one added cannot quietly reintroduce the defect on a page nobody
 * thought to check.
 *
 * The assertion is the hydration invariant itself — identical props must
 * produce identical markup even when the wall clock moves between the two
 * renders — not the shape of the string it happens to print.
 */
const VISTAS = [
  ["KpiVista", KpiVista],
  ["RunsVista", RunsVista],
  ["CostVista", CostVista],
  ["HealthVista", HealthVista],
  ["MemoryVista", MemoryVista],
  ["ArchitectureVista", ArchitectureVista],
] as const;

function wrap(Vista: () => React.ReactElement) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Vista />
    </QueryClientProvider>
  );
}

describe("vista 'Live · as of' indicator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const [name, Vista] of VISTAS) {
    it(`${name} renders the same live indicator on the server and on first client render across a second rollover`, () => {
      vi.useFakeTimers();

      vi.setSystemTime(new Date("2026-10-05T23:30:26.900Z"));
      const serverHtml = renderToString(wrap(Vista));

      vi.setSystemTime(new Date("2026-10-05T23:30:27.100Z"));
      const { container } = render(wrap(Vista));

      const host = document.createElement("div");
      host.innerHTML = serverHtml;

      const serverMeta = host.querySelector(".vista-meta")?.textContent;
      const clientMeta = container.querySelector(".vista-meta")?.textContent;

      expect(serverMeta).toBeTruthy();
      expect(serverMeta).toBe(clientMeta);
      // Before any fetch resolves there is no honest time to show, so the
      // label must not contain one. A render-time wall clock would.
      expect(clientMeta).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  }
});
