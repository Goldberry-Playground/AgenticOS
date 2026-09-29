#!/usr/bin/env node
//
// github-sync-heartbeat-probe.mjs — GOL-2591, item 3
//
// Decide whether the github-sync worker's liveness heartbeat has gone stale, and
// page Grove ops Discord if it has. The reading comes from
// scripts/github-sync-heartbeat-read.sh, which runs ON the droplet (the plugin DB
// is VPC-private); this half runs on the Actions runner so the ops webhook is
// never shipped over SSH and the verdict stays unit-testable offline.
//
// WHY THIS IS THE BETTER TRIPWIRE THAN A RED DEPLOY:
//   • A red deploy only fires when a deploy happens. GOL-2279 (2026-09-09) killed
//     the worker for ~5 days with no deploy anywhere near it.
//   • Even when a deploy DOES go red, the failure router's only delivery is a
//     GitHub issue, and a GitHub issue only reaches the board because the
//     github-sync worker mirrors it — so the deploy that kills the worker cannot
//     report itself. That is precisely how GOL-2585 stayed silent for five days
//     after run 35939085377 went red and minted issue #710 within a minute.
//   • `github_sync_delivery` cannot substitute: it only advances when a webhook
//     actually arrives, so a quiet inbound window and a dead worker are
//     indistinguishable. The heartbeat is unconditional (GOL-2371).
//
// The alert is also the ONLY signal that covers the disarm case: the heartbeat is
// written by the `worker-heartbeat` scheduled job, which exists only in plugin
// manifest >= 0.16.9. If a stale artifact ever puts an older manifest back in the
// registry, that job is paused and the heartbeat silently stops — a stale row is
// the only outward sign. So `stale` deliberately does NOT claim "the worker is
// dead"; it says "we have lost the liveness signal" and names both causes.
//
// Usage: node scripts/ci/github-sync-heartbeat-probe.mjs <reading.txt>
//   env DISCORD_WEBHOOK_URL       Grove ops webhook. Unset → report only, exit per verdict.
//   env HEARTBEAT_STALE_MINUTES   staleness threshold, default 90 (see below).
//   env HEARTBEAT_DRY_RUN         "1" → never POST, just print (dispatch self-test).
//   env RUN_URL                   Actions run URL, included in the page.
//
// Exit: 0 when the heartbeat is fresh; 1 on any bad verdict, so the job is red in
// the Actions UI even if Discord is unreachable.

import { readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Default staleness threshold: 90 minutes.
 *
 * NOT the plugin's own 15-minute `HEARTBEAT_STALE_MS`. The writer is a five-minute
 * scheduled job whose ticks are subject to scheduler jitter, a busy 2-vCPU box, and
 * the ~minute-scale gaps around a worker reload — a 15-minute external threshold was
 * measured going "stale" on 2026-09-29 while the worker was demonstrably alive and
 * still logging webhook deliveries. A false page trains people to ignore the real
 * one, which is the failure mode this whole issue exists to fix. 90 minutes is 18
 * missed ticks: unmistakable, and still ~80x faster than the five days of GOL-2585.
 */
export const DEFAULT_STALE_MINUTES = 90;

/**
 * Parse one line emitted by scripts/github-sync-heartbeat-read.sh. Anything that is
 * not a recognised line is `unparseable` — never silently treated as healthy, since
 * "the reader changed shape" and "the worker is fine" must never look the same.
 */
export function parseReading(text) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("HEARTBEAT "))
    .pop();
  if (!line) return { kind: "unparseable", detail: String(text ?? "").trim().slice(0, 200) };

  const parts = line.split(/\s+/);
  const kind = parts[1];
  if (kind === "no_table" || kind === "missing") return { kind };
  if (kind === "unreadable") return { kind, detail: parts.slice(2).join(" ") };
  if (kind === "ok") {
    const [updatedAt, workerBootedAt, workerVersion] = parts.slice(2);
    if (!updatedAt || !workerBootedAt) {
      return { kind: "unparseable", detail: line.slice(0, 200) };
    }
    return { kind: "ok", updatedAt, workerBootedAt, workerVersion: workerVersion || "-" };
  }
  return { kind: "unparseable", detail: line.slice(0, 200) };
}

/**
 * Verdict + human sentence. `now` and `staleMinutes` are injected so the whole
 * decision is deterministic in tests (no clock, no network, no droplet).
 */
export function evaluateHeartbeat(reading, { now = Date.now(), staleMinutes = DEFAULT_STALE_MINUTES } = {}) {
  const staleMs = staleMinutes * 60 * 1000;
  switch (reading?.kind) {
    case "ok": {
      const t = Date.parse(reading.updatedAt);
      if (Number.isNaN(t)) {
        return {
          verdict: "unparseable",
          ageSeconds: null,
          message: `heartbeat timestamp is not parseable: ${reading.updatedAt}`,
        };
      }
      // Clamp: a heartbeat "in the future" means clock skew, not freshness.
      const ageMs = Math.max(0, now - t);
      const ageMin = Math.round(ageMs / 60000);
      if (ageMs > staleMs) {
        return {
          verdict: "stale",
          ageSeconds: Math.round(ageMs / 1000),
          message:
            `last heartbeat ${ageMin} min ago (threshold ${staleMinutes} min). ` +
            `Either the worker is dead, or the \`worker-heartbeat\` job is paused ` +
            `because the registry fell back to a manifest older than 0.16.9. ` +
            `Worker booted ${reading.workerBootedAt}, version ${reading.workerVersion}.`,
        };
      }
      return {
        verdict: "ok",
        ageSeconds: Math.round(ageMs / 1000),
        message: `heartbeat fresh (${ageMin} min old, threshold ${staleMinutes} min), worker version ${reading.workerVersion}`,
      };
    }
    case "missing":
      return {
        verdict: "missing",
        ageSeconds: null,
        message:
          "the heartbeat table exists but holds no row — the worker has never stamped a heartbeat since migration 007 ran. Treat as a dead/never-booted worker.",
      };
    case "no_table":
      return {
        verdict: "no_table",
        ageSeconds: null,
        message:
          "the heartbeat table does not exist — migration 007 has not run, or the plugin DB namespace drifted (pluginKey/slug change). The tripwire is disarmed.",
      };
    case "unreadable":
      return {
        verdict: "unreadable",
        ageSeconds: null,
        message: `could not read the heartbeat on the droplet: ${reading.detail || "(no detail)"}. The tripwire is disarmed until this is fixed.`,
      };
    default:
      return {
        verdict: "unparseable",
        ageSeconds: null,
        message: `unrecognised reading from the droplet: ${reading?.detail || "(empty)"}. The tripwire is disarmed until this is fixed.`,
      };
  }
}

/** A bad verdict is anything that is not a confirmed-fresh heartbeat. */
export function isAlerting(verdict) {
  return verdict !== "ok";
}

export function buildHeartbeatAlert(result, { runUrl = "" } = {}) {
  const head = result.verdict === "stale" ? "github-sync worker heartbeat STALE" : `github-sync heartbeat ${result.verdict.toUpperCase()}`;
  const lines = [
    `🚨 **${head}**`,
    result.message,
    "Inbound GitHub→Paperclip sync may be dead: PR review twins, `agent-review/*` checks and issue mirroring all run inside this worker, so nothing on the board will tell you (GOL-2585 ran 5 days this way).",
    "Runbook: `docs/runbooks/github-issue-sync.md` — check `/proc/self/mountinfo` for `//deleted` plugin mounts first, then the plugin registry version.",
  ];
  if (runUrl) lines.push(runUrl);
  return lines.join("\n");
}

/** POST the alert. Returns the HTTP status; throws only on a network failure. */
export async function postDiscord(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return res.status;
}

// --- CLI ---------------------------------------------------------------------
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: github-sync-heartbeat-probe.mjs <reading.txt>");
    process.exit(2);
  }
  const staleMinutes = Number(process.env.HEARTBEAT_STALE_MINUTES || DEFAULT_STALE_MINUTES);
  const reading = parseReading(readFileSync(path, "utf8"));
  const result = evaluateHeartbeat(reading, { staleMinutes });
  console.log(`github-sync-heartbeat: ${result.verdict} — ${result.message}`);

  if (!isAlerting(result.verdict)) process.exit(0);

  const content = buildHeartbeatAlert(result, { runUrl: process.env.RUN_URL || "" });
  const webhook = process.env.DISCORD_WEBHOOK_URL || "";
  if (process.env.HEARTBEAT_DRY_RUN === "1") {
    console.log("--- dry run, not posting ---");
    console.log(content);
    process.exit(1);
  }
  if (!webhook) {
    console.error("github-sync-heartbeat: DISCORD_WEBHOOK_URL unset — no page sent.");
    console.error(content);
    process.exit(1);
  }
  const status = await postDiscord(webhook, content);
  console.error(
    status >= 200 && status < 300
      ? `github-sync-heartbeat: paged Grove ops Discord (HTTP ${status}).`
      : `github-sync-heartbeat: Discord POST FAILED (HTTP ${status}).`,
  );
  process.exit(1);
}
