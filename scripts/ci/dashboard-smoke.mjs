#!/usr/bin/env node
//
// dashboard-smoke.mjs: synthetic check of every AgenticOS dashboard page and
// read-only API route, paging Grove ops Discord when one breaks.
//
// WHY: on 2026-11-10 an audit found the dashboard had been quietly broken for
// weeks with nothing alerting:
//   - /memory and every /api/vault/* route 500'd from 10-15 to 11-10 because a
//     cloud firewall dropped the dashboard's VPC traffic (odoocker#1008);
//   - opening /memory then OOM-crashed vault-server (AgenticOS#925);
//   - the app itself had not deployed since 08-03 (stale repo source).
// Each was visible in one request; nobody was making that request.
//
// The probe goes through Cloudflare Access with a service token, exactly as a
// browser would after login, so it exercises the edge, the App Platform app and
// the droplet services behind it (vault-server, Paperclip, OpenViking, Postgres).
//
// Usage: node scripts/ci/dashboard-smoke.mjs
//   env DASHBOARD_URL                 default https://agenticos.gatheringatthegrove.com
//   env DASHBOARD_CF_CLIENT_ID        CF Access service token id     } unset → no-op
//   env DASHBOARD_CF_CLIENT_SECRET    CF Access service token secret } (exit 0)
//   env DISCORD_WEBHOOK_URL           Grove ops webhook; unset → report only.
//   env SMOKE_DRY_RUN                 "1" → never POST, just print.
//   env RUN_URL                       Actions run URL, included in the page.
//
// Exit: 0 when everything is ok (known-broken routes allowed); 1 on any failure,
// so the job is red even if Discord is unreachable.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "https://agenticos.gatheringatthegrove.com";
export const TIMEOUT_MS = 20_000;
export const SLOW_MS = 8_000;

export const PAGES = ["/", "/memory", "/health", "/cost", "/runs", "/architecture", "/settings"];

// Read-only GET routes. Mutating routes (inbox commit/discard/promote, task
// retry/trigger, POST revalidate) are deliberately absent: a probe must never write.
export const API_ROUTES = [
  "agent/runs?limit=5", "agents", "approvals", "budget", "config", "cost/today",
  "cost/burndown", "cost/projection", "costs", "crons/next", "health/external",
  "health/resources", "health/services", "ingest/recent", "issues", "limits", "lint",
  "org", "routines", "runs", "tasks/active", "tasks/queue-depth", "tasks/recent-errors",
  "tasks/recent-events", "tasks/scheduled", "tasks/stats", "vault/inbox",
  "vault/recent-changes", "vault/search?q=grove", "vault/skills", "vault/stats",
  "vault/tree", "viking/health", "viking/scopes",
  // Known broken, kept in the sweep so a fix (or a new failure mode) is visible:
  "tasks", "taxonomy", "agent/health",
].map((r) => `/api/${r}`);

// Routes broken for a known, tracked reason. They are reported but do not page.
// Remove an entry when its fix ships; the probe then guards the fix.
export const KNOWN_BROKEN = {
  "/api/tasks": "Hermes client; HERMES_URL is unset in prod (v1 local runtime)",
  "/api/taxonomy": "RemoteVaultClient.getAllTags() deferred to vault-server Phase E",
  "/api/agent/health": "Cloudflare 504 from origin; route not yet triaged",
};

// Body-level checks: a 200 that says the backend is gone is still an outage.
export const SEMANTIC = {
  "/api/vault/stats": (j) => (j?.pageCount > 0 ? null : `pageCount=${j?.pageCount}`),
  "/api/health/services": (j) => {
    const pc = (j?.services || []).find((s) => s.name === "Paperclip");
    return pc?.ok ? null : `Paperclip ok=${pc?.ok} (${pc?.detail ?? "missing"})`;
  },
};

/**
 * Classify one probe result.
 * @param {{path:string,status:number|null,ms:number,location?:string,body?:string,error?:string}} r
 * @returns {{path:string,verdict:"ok"|"slow"|"known"|"auth"|"fail",reason:string}}
 */
export function classify(r) {
  const known = KNOWN_BROKEN[r.path];
  // A redirect to the Access login means the PROBE is misconfigured (token
  // missing from the Access policy), not that the app is down. Distinct verdict,
  // still pages: a silently-blind monitor is the failure this exists to prevent.
  if (r.status >= 300 && r.status < 400 && /cloudflareaccess\.com/.test(r.location || "")) {
    return { path: r.path, verdict: "auth", reason: "redirected to Cloudflare Access login" };
  }
  const bad =
    r.error ? `no response (${r.error})`
    : r.status >= 500 || r.status === 404 || r.status === null ? `HTTP ${r.status}`
    : r.status >= 400 ? `HTTP ${r.status}`
    : null;
  if (bad) return known ? { path: r.path, verdict: "known", reason: `${bad}: ${known}` } : { path: r.path, verdict: "fail", reason: bad };

  const check = SEMANTIC[r.path];
  if (check) {
    let j;
    try { j = JSON.parse(r.body || ""); } catch { return { path: r.path, verdict: "fail", reason: "200 but body is not JSON" }; }
    const why = check(j);
    if (why) return { path: r.path, verdict: "fail", reason: why };
  }
  if (known) return { path: r.path, verdict: "ok", reason: `recovered (remove from KNOWN_BROKEN: ${known})` };
  if (r.ms > SLOW_MS) return { path: r.path, verdict: "slow", reason: `${r.ms} ms` };
  return { path: r.path, verdict: "ok", reason: `${r.ms} ms` };
}

export const isAlerting = (verdict) => verdict === "fail" || verdict === "auth";

export function buildAlert(results, { runUrl = "", base = DEFAULT_URL } = {}) {
  const bad = results.filter((r) => isAlerting(r.verdict));
  const lines = [`**AgenticOS dashboard smoke: ${bad.length} failing** (${base})`];
  for (const r of bad.slice(0, 15)) lines.push(`- \`${r.path}\` ${r.verdict}: ${r.reason}`);
  if (bad.length > 15) lines.push(`- …and ${bad.length - 15} more`);
  if (runUrl) lines.push(runUrl);
  return lines.join("\n");
}

async function probe(base, path, headers) {
  const t = Date.now();
  try {
    const res = await fetch(base + path, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = path.startsWith("/api/") ? await res.text() : "";
    return { path, status: res.status, ms: Date.now() - t, location: res.headers.get("location") || "", body };
  } catch (e) {
    return { path, status: null, ms: Date.now() - t, error: e?.name === "TimeoutError" ? `timeout ${TIMEOUT_MS} ms` : String(e?.message || e) };
  }
}

async function postDiscord(webhookUrl, content) {
  const res = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
  return res.status;
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
})();

if (invokedDirectly) {
  const base = (process.env.DASHBOARD_URL || DEFAULT_URL).replace(/\/$/, "");
  const id = process.env.DASHBOARD_CF_CLIENT_ID || "";
  const secret = process.env.DASHBOARD_CF_CLIENT_SECRET || "";
  if (!id || !secret) {
    console.log("dashboard-smoke: DASHBOARD_CF_CLIENT_ID/SECRET not set; skipping (no-op until configured).");
    process.exit(0);
  }
  const headers = { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
  // Sequential on purpose: the dashboard's vault routes fan into one small
  // vault-server, and a monitor must not become the load spike it alerts on.
  const results = [];
  for (const p of [...PAGES, ...API_ROUTES]) results.push(classify(await probe(base, p, headers)));

  for (const r of results) console.log(`${r.verdict.padEnd(5)} ${r.path}  ${r.reason}`);
  const alerting = results.filter((r) => isAlerting(r.verdict));
  if (alerting.length === 0) process.exit(0);

  const content = buildAlert(results, { runUrl: process.env.RUN_URL || "", base });
  const webhook = process.env.DISCORD_WEBHOOK_URL || "";
  if (process.env.SMOKE_DRY_RUN === "1" || !webhook) {
    console.error(webhook ? "--- dry run, not posting ---" : "dashboard-smoke: DISCORD_WEBHOOK_URL unset; no page sent.");
    console.error(content);
    process.exit(1);
  }
  const status = await postDiscord(webhook, content);
  console.error(`dashboard-smoke: paged Grove ops Discord (HTTP ${status}).`);
  process.exit(1);
}
