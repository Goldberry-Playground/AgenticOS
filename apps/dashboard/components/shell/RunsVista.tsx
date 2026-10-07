"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { ActivityStripBackdrop } from "./backdrops/ActivityStripBackdrop";
import { useRecentRunEvents } from "@/lib/hooks/use-recent-run-events";
import { useRunsStats } from "@/lib/hooks/use-runs-stats";
import { useNextCron } from "@/lib/hooks/use-next-cron";
import { freshestUpdatedAt } from "./as-of";

/**
 * Runs tab hero vista. Composes the {@link VistaShell} chrome with the
 * {@link ActivityStripBackdrop} throughput chart and four Runs-specific
 * KPI tiles backed by the Postgres `tasks` telemetry table:
 *
 *  - `/api/tasks/recent-events?windowMin=60` feeds the chart
 *  - `/api/tasks/stats` feeds the four tiles
 *
 * Both poll every 30s. The chart's `now` reference is pinned to the
 * page mount so bars don't jitter between refetches.
 */
const PLACEHOLDER = "—";

function formatActiveSublabel(activeKinds: string[] | undefined): string {
  if (!activeKinds || activeKinds.length === 0) return "no runs in flight";
  if (activeKinds.length <= 3) return activeKinds.join(" · ");
  const head = activeKinds.slice(0, 2).join(" · ");
  const extra = activeKinds.length - 2;
  return `${head} · +${extra} more`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return PLACEHOLDER;
  }
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds - min * 60);
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

/**
 * "in 4m" / "in 1h 7m" / "in 5d 3h" — coarse, human-readable ETA used
 * inside the "Next scheduled" tile's mono <span class="unit"> badge.
 * For ETAs under a minute we say "now" — at that resolution Hermes is
 * about to fire anyway.
 */
function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "now";
  const min = Math.floor(seconds / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  const rmin = min - hr * 60;
  if (hr < 24) return rmin ? `in ${hr}h ${rmin}m` : `in ${hr}h`;
  const day = Math.floor(hr / 24);
  const rhr = hr - day * 24;
  return rhr ? `in ${day}d ${rhr}h` : `in ${day}d`;
}

export function RunsVista() {
  // Pin the chart's right-hand edge to mount time so the 60-minute axis stays
  // stable for the lifetime of the page render — refetched data drops into the
  // same window without the edge sliding.
  //
  // This is deliberately NOT the "as of" label (GOL-3073). It is also not a
  // hydration hazard: `events` is empty on the server and on the client's
  // first render (the query has not resolved), and with no events every value
  // the backdrop renders — zeroed buckets, the floor y-scale, the fixed
  // -60m/-45m/-30m/-15m/now labels — is independent of `now`. Feed it anything
  // event-derived and that stops being true.
  const nowIso = useMemo(() => new Date().toISOString(), []);

  const eventsQuery = useRecentRunEvents(60);
  const statsQuery = useRunsStats();
  const nextCronQuery = useNextCron();

  const events = eventsQuery.data ?? [];
  const stats = statsQuery.data;
  const statsLoaded = !!stats;
  const nextCron = nextCronQuery.data;

  return (
    <VistaShell
      accent="gold"
      asOfMs={freshestUpdatedAt(
        eventsQuery.dataUpdatedAt,
        statsQuery.dataUpdatedAt,
        nextCronQuery.dataUpdatedAt,
      )}
      backdrop={<ActivityStripBackdrop events={events} now={nowIso} />}
    >
      <KpiTile
        value={statsLoaded ? String(stats.activeCount) : PLACEHOLDER}
        label="active runs"
        sublabel={
          statsLoaded ? formatActiveSublabel(stats.activeKinds) : "loading…"
        }
      />
      <KpiTile
        value={statsLoaded ? String(stats.failedToday) : PLACEHOLDER}
        label="failed today"
        sublabel={
          statsLoaded && stats.failedToday > 0
            ? "since midnight UTC"
            : statsLoaded
              ? "clean run"
              : "loading…"
        }
      />
      <KpiTile
        value={statsLoaded ? formatDuration(stats.avgDurationSec) : PLACEHOLDER}
        label="avg duration"
        sublabel="p50 · last 24h"
      />
      <KpiTile
        value={
          nextCron ? (
            <>
              {nextCron.name}
              <span className="unit"> {formatEta(nextCron.etaSec)}</span>
            </>
          ) : nextCronQuery.isLoading ? (
            PLACEHOLDER
          ) : (
            "—"
          )
        }
        label="next scheduled"
        sublabel={
          nextCron
            ? `cron · ${nextCron.schedule}`
            : nextCronQuery.isLoading
              ? "loading…"
              : "no registered crons"
        }
      />
    </VistaShell>
  );
}

export default RunsVista;
