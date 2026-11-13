import "server-only";
import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";
import { synthesizePaperclipHealth } from "@/lib/health/paperclip-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live service health for the Agent-health panel and the Health vista
 * (truth pass 2026-07-14; previously returned canned "Hermes 2ms" rows).
 *
 * Every row is a real probe, run in parallel (Promise.allSettled — one
 * down service never blanks the payload):
 *
 *   - Paperclip (DASHBOARD_DATA_SOURCE=paperclip): the shared synthesis in
 *     lib/health/paperclip-health.ts (health probe + running agents + stuck
 *     heartbeat check). Latency is measured around the real /api/health call.
 *   - Hermes (default mode): listTasks({limit:1}) reachability, timed.
 *   - OpenViking: GET ${OPENVIKING_URL}/health with a 2s abort, timed
 *     (same probe as /api/viking/health).
 *
 * latencyMs is null whenever a service could not actually be timed — the
 * UI renders "—" for it. Nothing is fabricated.
 */

/** Short timeout so a down/unreachable OpenViking never hangs the dashboard. */
const VIKING_TIMEOUT_MS = 2000;

export interface ProbedService {
  name: string;
  ok: boolean;
  /** Measured around the real probe; null when the service was not probeable. */
  latencyMs: number | null;
  /** Honest one-line status for the row, e.g. "3 agents running" / "not configured". */
  detail: string;
}

export interface ServicesHealthData {
  services: ProbedService[];
  /** Paperclip agent counters for the Health vista; null outside paperclip mode. */
  paperclip: { runningAgents: number | null; stuck: boolean } | null;
  checked_at: string;
}

async function probePlatform(): Promise<{
  service: ProbedService;
  paperclip: ServicesHealthData["paperclip"];
}> {
  if (dataSource() === "paperclip") {
    const s = await synthesizePaperclipHealth();
    const detail =
      s.status === "ok"
        ? `${s.runningAgents} agent${s.runningAgents === 1 ? "" : "s"} running`
        : s.status === "unconfigured"
          ? "not configured"
          : s.status === "down"
            ? "unreachable"
            : s.stuck
              ? "all running agents stuck"
              : s.runningAgents === 0
                ? "no agents running"
                : (s.error ?? "degraded");
    return {
      service: {
        name: "Paperclip",
        ok: s.status === "ok",
        latencyMs: s.latencyMs,
        detail,
      },
      paperclip: { runningAgents: s.runningAgents, stuck: s.stuck },
    };
  }

  // Hermes mode: same reachability probe as /api/agent/health, timed.
  const start = Date.now();
  try {
    const { getHermesClient } = await import("@/lib/agent");
    const hermes = getHermesClient();
    await hermes.listTasks({ limit: 1 });
    return {
      service: {
        name: "Hermes",
        ok: true,
        latencyMs: Date.now() - start,
        detail: "reachable",
      },
      paperclip: null,
    };
  } catch (err) {
    return {
      service: {
        name: "Hermes",
        ok: false,
        latencyMs: null,
        detail: err instanceof Error ? err.message : "unreachable",
      },
      paperclip: null,
    };
  }
}

async function probeOpenViking(): Promise<ProbedService> {
  // App Platform sets OPENVIKING_ENDPOINT (see app-platform.tf); OPENVIKING_URL is the
  // older local-dev name. Reading only OPENVIKING_URL showed "not configured" in prod.
  const baseUrl = process.env.OPENVIKING_ENDPOINT ?? process.env.OPENVIKING_URL;
  if (!baseUrl) {
    return { name: "OpenViking", ok: false, latencyMs: null, detail: "not configured" };
  }
  const start = Date.now();
  try {
    // `/health` is auth-free (server liveness check) — same contract as
    // /api/viking/health. See docs/superpowers/specs/spec1-verified-api-shapes.md §4.
    const res = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(VIKING_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        name: "OpenViking",
        ok: false,
        latencyMs,
        detail: `HTTP ${res.status}`,
      };
    }
    return { name: "OpenViking", ok: true, latencyMs, detail: "reachable" };
  } catch {
    return { name: "OpenViking", ok: false, latencyMs: null, detail: "unreachable" };
  }
}

export async function GET(): Promise<Response> {
  const [platform, viking] = await Promise.allSettled([
    probePlatform(),
    probeOpenViking(),
  ]);

  const services: ProbedService[] = [];
  let paperclip: ServicesHealthData["paperclip"] = null;

  if (platform.status === "fulfilled") {
    services.push(platform.value.service);
    paperclip = platform.value.paperclip;
  } else {
    const name = dataSource() === "paperclip" ? "Paperclip" : "Hermes";
    services.push({ name, ok: false, latencyMs: null, detail: "probe failed" });
  }

  services.push(
    viking.status === "fulfilled"
      ? viking.value
      : { name: "OpenViking", ok: false, latencyMs: null, detail: "probe failed" },
  );

  const data: ServicesHealthData = {
    services,
    paperclip,
    checked_at: new Date().toISOString(),
  };
  return NextResponse.json(data);
}
