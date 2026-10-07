"use client";
import { EkgSweep } from "./EkgSweep";
import { useKpiData } from "@/lib/hooks/use-kpi-data";
import { AsOfChip } from "./AsOfChip";

/**
 * Persistent KPI vista banner — the "dusk navigator's console" that sits
 * above every tab. Four readings (runs today, active runs, vault files,
 * memories indexed) framed by gold horizon rules, with an EKG sweep
 * pulsing in the background and a live-data indicator in the corner.
 *
 * Mounts once in the root layout and persists across /runs, /cost,
 * /health, /memory. Every tile degrades independently: a tile whose source
 * fetch failed shows "—" with no delta badge or fabricated sublabel, while
 * the others keep showing live data.
 */

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDeltaCount(n: number): string {
  if (n < 0) return `−${Math.abs(n)}`;
  return `+${n}`;
}

export function KpiVista() {
  const { data, dataUpdatedAt } = useKpiData();

  const runsToday = data?.runsToday ?? null;
  const runs = data?.activeRuns ?? null;
  const vault = data?.vaultFiles ?? null;
  const memories = data?.memoriesIndexed ?? null;

  return (
    <div className="kpi-vista">
      <EkgSweep />

      {/*
        * "Fleet", not "Live": every route renders this banner *and* its own
        * page banner, fed by a different query on a different interval, so
        * the two chips can legitimately show different times. Naming the data
        * each one speaks for is what keeps that from reading as a bug — see
        * `AsOfChip` (GOL-3099).
        */}
      <AsOfChip scope="Fleet" asOfMs={dataUpdatedAt} />

      <div className="horizon top" />

      <div className="kpi-grid">
        <div className="kpi">
          <div className="value">{runsToday ? formatCount(runsToday.count) : "—"}</div>
          <div className="label">runs today</div>
          <div className="sublabel">
            {runsToday
              ? runsToday.spendUsd > 0
                ? `$${runsToday.spendUsd.toFixed(2)} metered`
                : "subscription · no metered cost"
              : " "}
          </div>
        </div>

        <div className="kpi">
          <div className="value">
            {runs ? runs.count.toString() : "—"}
            {runs && runs.delta !== 0 && (
              <span className={`delta ${runs.delta < 0 ? "down" : "up"}`}>
                {formatDeltaCount(runs.delta)}
              </span>
            )}
          </div>
          <div className="label">active runs</div>
          <div className="sublabel">
            {runs ? (runs.kinds.length > 0 ? runs.kinds.join(" · ") : "idle") : " "}
          </div>
        </div>

        <div className="kpi">
          <div className="value">{vault ? formatCount(vault.count) : "—"}</div>
          <div className="label">vault files</div>
          <div className="sublabel">{vault ? "wiki pages indexed" : " "}</div>
        </div>

        <div className="kpi">
          <div className="value">{memories ? formatCount(memories.count) : "—"}</div>
          <div className="label">memories indexed</div>
          <div className="sublabel">
            {memories && memories.categories.length > 0
              ? memories.categories.join(" · ")
              : " "}
          </div>
        </div>
      </div>

      <div className="horizon bottom" />
    </div>
  );
}

export default KpiVista;
