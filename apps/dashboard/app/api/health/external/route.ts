import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * External provider reachability (truth pass 2026-07-14; previously returned
 * a canned "OpenAI 82ms ok" forever).
 *
 * Each row is a real liveness ping run in parallel (Promise.allSettled) with
 * a ~3s abort. Unauthenticated probes: a well-known status code proves the
 * provider's edge answered — 401 from OpenAI/DigitalOcean is "reachable and
 * healthy" because it means the API stack processed the request.
 *
 * The result is cached module-scope for 30s so panel polling doesn't hammer
 * the providers.
 */

export interface ExternalService {
  name: string;
  /** "182ms" when healthy, "HTTP 503 · 182ms" on unexpected status, "unreachable" on network failure. */
  status: string;
  ok: boolean;
}

export interface ExternalServicesData {
  services: ExternalService[];
  checked_at: string;
}

const PROBE_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 30_000;

interface ProbeTarget {
  name: string;
  url: string;
  method: "GET" | "HEAD";
  /** Status codes that count as healthy; empty = any HTTP response counts. */
  expectStatuses: number[];
}

const TARGETS: ProbeTarget[] = [
  // Unauthenticated /v1/models → 401 proves the API stack is up.
  { name: "OpenAI API", url: "https://api.openai.com/v1/models", method: "GET", expectStatuses: [401] },
  // Any HTTP response from the Anthropic edge counts as reachable.
  { name: "Anthropic API", url: "https://api.anthropic.com", method: "GET", expectStatuses: [] },
  { name: "GitHub API", url: "https://api.github.com", method: "GET", expectStatuses: [200] },
  // Unauthenticated /v2/account → 401 proves the API stack is up. (Bare /v2
  // started returning 404, which the page showed as a DigitalOcean outage.)
  { name: "DigitalOcean API", url: "https://api.digitalocean.com/v2/account", method: "GET", expectStatuses: [401] },
  { name: "Cloudflare", url: "https://www.cloudflare.com", method: "HEAD", expectStatuses: [200] },
];

async function probe(target: ProbeTarget): Promise<ExternalService> {
  const start = Date.now();
  try {
    const res = await fetch(target.url, {
      method: target.method,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    const healthy =
      target.expectStatuses.length === 0 ||
      target.expectStatuses.includes(res.status);
    return {
      name: target.name,
      status: healthy ? `${latencyMs}ms` : `HTTP ${res.status} · ${latencyMs}ms`,
      ok: healthy,
    };
  } catch {
    return { name: target.name, status: "unreachable", ok: false };
  }
}

let cache: { data: ExternalServicesData; at: number } | null = null;

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const settled = await Promise.allSettled(TARGETS.map(probe));
  const services = settled.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : { name: TARGETS[i].name, status: "unreachable", ok: false },
  );

  const data: ExternalServicesData = {
    services,
    checked_at: new Date().toISOString(),
  };
  cache = { data, at: Date.now() };
  return NextResponse.json(data);
}
