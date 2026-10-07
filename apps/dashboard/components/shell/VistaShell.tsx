import type { ReactNode } from "react";
import { formatAsOf } from "./as-of";

/**
 * Dusk-indigo console chrome shared by every per-tab vista. Renders the
 * background panel + dual-radial spotlight + gold horizon rules + live
 * indicator chip + KPI tile slot. The animated backdrop (EKG sweep,
 * activity strip, skill galaxy, etc.) is passed in via the `backdrop`
 * prop so each tab can supply a topic-appropriate visual without
 * duplicating the chrome.
 *
 * The optional `accent` prop tints the live indicator dot and the KPI
 * text-shadow halo via a `data-accent` attribute that `globals.css`
 * selects on (see `.kpi-vista[data-accent="copper"] .kpi .value`).
 */
export interface VistaShellProps {
  /**
   * Accent color for KPI value halos and the live indicator dot.
   * Defaults to `'gold'` (the original KpiVista appearance).
   */
  accent?: "gold" | "copper" | "amber" | "pine" | "sage";
  /**
   * Epoch-ms instant shown in the "Live · as of HH:MM:SS" indicator — normally
   * the backing query's `dataUpdatedAt`. `0`/omitted means no fetch has
   * resolved yet and renders an em-dash.
   *
   * GOL-3073: this used to be an ISO string with a `new Date()` fallback, and
   * every caller passed `useMemo(() => new Date().toISOString(), [])`. Both
   * read the clock during render, which the server and the client do at
   * different instants — a hydration mismatch that made React regenerate the
   * whole tree. See `./as-of.ts`.
   */
  asOfMs?: number | null;
  /** The 4 KPI tiles, typically `<KpiTile />` children. */
  children: ReactNode;
  /** The animated backdrop component (absolutely-positioned, full-bleed). */
  backdrop: ReactNode;
}

export function VistaShell({
  accent = "gold",
  asOfMs,
  children,
  backdrop,
}: VistaShellProps) {
  return (
    <div className="kpi-vista" data-accent={accent}>
      {backdrop}

      <div className="vista-meta" aria-label="Live data indicator">
        <span className="live-dot" aria-hidden="true" />
        <span>Live · as of {formatAsOf(asOfMs)}</span>
      </div>

      <div className="horizon top" />

      <div className="kpi-grid">{children}</div>

      <div className="horizon bottom" />
    </div>
  );
}

export default VistaShell;
