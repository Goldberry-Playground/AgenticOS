import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Short timeout so a down/unreachable OpenViking never hangs the dashboard. */
const VIKING_TIMEOUT_MS = 2000;

export interface VikingHealth {
  reachable: boolean;
  uptimeSec?: number;
  version?: string;
  ramMb?: number;
}

export async function GET(): Promise<NextResponse> {
  // App Platform sets OPENVIKING_ENDPOINT (see app-platform.tf); OPENVIKING_URL is the
  // older local-dev name. Reading only OPENVIKING_URL showed "not configured" in prod.
  const baseUrl = process.env.OPENVIKING_ENDPOINT ?? process.env.OPENVIKING_URL;
  if (!baseUrl) {
    return NextResponse.json({ reachable: false });
  }
  try {
    // `/health` is auth-free (server liveness check). See
    // docs/superpowers/specs/spec1-verified-api-shapes.md §4.
    const res = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(VIKING_TIMEOUT_MS),
    });
    if (!res.ok) return NextResponse.json({ reachable: false });
    const body = (await res.json().catch(() => ({}))) as {
      uptime_seconds?: number;
      version?: string;
      memory_mb?: number;
    };
    return NextResponse.json({
      reachable: true,
      uptimeSec: body.uptime_seconds,
      version: body.version,
      ramMb: body.memory_mb,
    });
  } catch {
    return NextResponse.json({ reachable: false });
  }
}
