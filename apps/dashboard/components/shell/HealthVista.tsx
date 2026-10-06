"use client";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { LatencyOscilloscopeBackdrop } from "./backdrops/LatencyOscilloscopeBackdrop";
import { useHealthServices } from "@/lib/hooks/use-health-services";

/**
 * Health tab hero vista — wired to live probes via {@link useHealthServices}
 * (truth pass 2026-07-14; previously hardcoded "4/4 · 5ms · 99.94%"):
 *
 *   - /api/health/services → per-service up/down + measured probe latency
 *     (Paperclip or Hermes platform + OpenViking) and Paperclip agent counters
 *
 * Tile changes vs the stub version: the "uptime 99.94%" and "last incident"
 * tiles had NO history source anywhere in the stack, so they are replaced by
 * running-agent and unreachable-service counts from the same real payload.
 * A source that errors renders "—" — never a fabricated number (CostVista
 * pattern). The oscilloscope backdrop is decorative (unlabeled waves).
 */
const PLACEHOLDER = "—";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function HealthVista() {
  const { data, isLoading, dataUpdatedAt } = useHealthServices();

  const services = data?.services ?? null;
  const up = services?.filter((s) => s.ok) ?? [];
  const down = services?.filter((s) => !s.ok) ?? [];
  const medianLatency = median(
    (services ?? [])
      .map((s) => s.latencyMs)
      .filter((v): v is number => v != null),
  );
  const runningAgents = data?.paperclip?.runningAgents ?? null;

  return (
    <VistaShell
      scope="Health"
      accent="pine"
      asOfMs={dataUpdatedAt}
      backdrop={<LatencyOscilloscopeBackdrop />}
    >
      <KpiTile
        value={
          services ? (
            <>
              {up.length}
              <span className="unit"> / {services.length}</span>
            </>
          ) : (
            PLACEHOLDER
          )
        }
        label="services up"
        sublabel={
          services
            ? down.length === 0
              ? "all probes responding"
              : down.map((s) => s.name).join(" · ")
            : isLoading
              ? "loading…"
              : "probes unavailable"
        }
      />
      <KpiTile
        value={
          medianLatency != null ? (
            <>
              {medianLatency}
              <span className="unit">ms</span>
            </>
          ) : (
            PLACEHOLDER
          )
        }
        label="median latency"
        sublabel={medianLatency != null ? "across live probes" : "no probe timings"}
      />
      <KpiTile
        value={runningAgents != null ? String(runningAgents) : PLACEHOLDER}
        label="agents running"
        sublabel={
          runningAgents != null
            ? data?.paperclip?.stuck
              ? "latest runs stuck"
              : "paperclip heartbeat"
            : "no agent source"
        }
      />
      <KpiTile
        value={services ? String(down.length) : PLACEHOLDER}
        label="unreachable"
        sublabel={
          services
            ? down.length === 0
              ? "no failing probes"
              : "needs attention"
            : "loading…"
        }
      />
    </VistaShell>
  );
}

export default HealthVista;
