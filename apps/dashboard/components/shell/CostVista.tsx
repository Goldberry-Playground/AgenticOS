"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { BurndownProjectionBackdrop } from "./backdrops/BurndownProjectionBackdrop";
import { useCostVista } from "@/lib/hooks/use-cost-vista";
import type { BurndownPoint } from "@/app/api/cost/burndown/route";

/**
 * Cost tab hero vista. Composes the {@link VistaShell} chrome with the
 * {@link BurndownProjectionBackdrop} burndown chart and four Cost KPI
 * tiles — all wired to live endpoints via {@link useCostVista}
 * (truth pass 2026-07-12; previously hardcoded stub values):
 *
 *   - /api/cost/today               → today / MTD / %-of-cap tiles
 *   - /api/cost/projection          → month-end projection tile + backdrop line
 *   - /api/cost/burndown?range=30d  → backdrop cumulative curve
 *
 * Data-fidelity rule: a source that errors renders "—" on its tiles —
 * never a fabricated number. RunsVista is the pattern source.
 */
const PLACEHOLDER = "—";

function fmtUsd(n: number): string {
  return n.toFixed(2);
}

/** today-vs-yesterday delta, e.g. "−18%" / "+42%". Null when yesterday=0. */
function deltaPct(today: number, yesterday: number): string | null {
  if (yesterday <= 0) return null;
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return null;
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

/**
 * Map rolling per-day burndown points onto the current calendar month's
 * cumulative curve (the backdrop's contract: index = day-of-month, value =
 * cumulative dollars). Points outside the current UTC month are dropped.
 */
function toMonthCurve(points: BurndownPoint[]): {
  actualByDay: number[];
  todayIndex: number;
} {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const todayIndex = now.getUTCDate() - 1;

  const perDay = new Array<number>(daysInMonth).fill(0);
  for (const p of points) {
    const d = new Date(p.at);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month) continue;
    perDay[d.getUTCDate() - 1] += p.cents / 100;
  }
  const actualByDay: number[] = [];
  let acc = 0;
  for (let i = 0; i < daysInMonth; i++) {
    // Accumulate only through today; pad the unknown future flat (the
    // backdrop ignores values past todayIndex, but keeps array length).
    if (i <= todayIndex) acc += perDay[i];
    actualByDay.push(acc);
  }
  return { actualByDay, todayIndex };
}

export function CostVista() {
  const { data, dataUpdatedAt } = useCostVista();

  const today = data?.today ?? null;
  const projection = data?.projection ?? null;
  const burndown = data?.burndown ?? null;

  const { actualByDay, todayIndex } = useMemo(
    () => toMonthCurve(burndown ?? []),
    [burndown]
  );

  const capUsd = today?.capUsd ?? projection?.cap_usd ?? 0;
  const pctOfCap =
    today && capUsd > 0 ? Math.round((today.mtdUsd / capUsd) * 100) : null;
  const delta = today ? deltaPct(today.todayUsd, today.yesterdayUsd) : null;

  return (
    <VistaShell
      accent="amber"
      asOfMs={dataUpdatedAt}
      backdrop={
        <BurndownProjectionBackdrop
          actualByDay={actualByDay}
          todayIndex={todayIndex}
          projectedEom={projection?.spend_usd ?? 0}
          cap={capUsd}
        />
      }
    >
      <KpiTile
        value={
          today ? (
            <>
              <span className="unit">$</span>
              {fmtUsd(today.todayUsd)}
              {delta ? (
                <span className={`delta ${delta.startsWith("+") ? "up" : "down"}`}>
                  {delta}
                </span>
              ) : null}
            </>
          ) : (
            PLACEHOLDER
          )
        }
        label="today's spend"
        sublabel={today ? "vs yesterday" : "loading…"}
      />
      <KpiTile
        value={
          today ? (
            <>
              <span className="unit">$</span>
              {fmtUsd(today.mtdUsd)}
            </>
          ) : (
            PLACEHOLDER
          )
        }
        label="MTD spend"
        sublabel={capUsd > 0 ? `of $${Math.round(capUsd)} cap` : "no cap set"}
      />
      <KpiTile
        value={
          projection ? (
            <>
              <span className="unit">$</span>
              {fmtUsd(projection.spend_usd)}
            </>
          ) : (
            PLACEHOLDER
          )
        }
        label="month-end projection"
        sublabel={
          projection
            ? `$${projection.avg_per_day_usd.toFixed(2)}/day · ${projection.days_remaining}d left`
            : "at current burn rate"
        }
      />
      <KpiTile
        value={pctOfCap != null ? `${pctOfCap}%` : PLACEHOLDER}
        label="% of cap"
        sublabel={
          pctOfCap != null ? `${Math.max(0, 100 - pctOfCap)}% headroom` : "no cap set"
        }
      />
    </VistaShell>
  );
}

export default CostVista;
