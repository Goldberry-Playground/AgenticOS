"use client";
import { EkgSweep } from "./EkgSweep";
import { useKpiData } from "@/lib/hooks/use-kpi-data";

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

/**
 * GOL-2653 / GOL-3073 — this used to be `liveTimestamp()`, called with no
 * argument *during render*, so it read `new Date()` fresh on the server and
 * again on the client. Two things were wrong with that:
 *
 * 1. It is a guaranteed hydration mismatch the moment the second ticks over
 *    between the SSR render and hydration. React's recovery is to throw away
 *    the server HTML and "regenerate this tree on the client" — it re-renders
 *    and replaces the DOM for the whole root, not just this span. That broke
 *    `e2e/focus-visible.spec.ts`, which tags header controls with a
 *    `data-focus-probe` attribute and then Tabs through reading it back: the
 *    regeneration deletes every attribute it just wrote, so the probe found
 *    zero controls and main went red on a commit whose merge-queue run,
 *    three minutes earlier on the identical tree, had passed.
 * 2. It also lied. Called once during render and never again, the "Live · as
 *    of" clock froze at first paint and never ticked, while the readings next
 *    to it refreshed every 30s underneath it.
 *
 * Taking an explicit instant fixes both. The caller passes
 * `dataUpdatedAt` from the KPI query, which is 0 until a fetch actually
 * resolves — so SSR and the first client render agree on "no time yet", and
 * the value that does appear is the real as-of time of the data rather than a
 * wall clock that happens to be near it.
 */
function liveTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

      <div className="vista-meta" aria-label="Live data indicator">
        <span className="live-dot" aria-hidden="true" />
        <span>
          Live · as of {dataUpdatedAt ? liveTimestamp(dataUpdatedAt) : "—"}
        </span>
      </div>

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
