#!/usr/bin/env node
//
// deploy-failure-alert.mjs — GOL-2591
//
// WHY THIS EXISTS (read before "the router already covers this"):
// ci-failure-router.yml has watched `Deploy Droplet Plugins` since day one, and
// it DID fire for the GOL-2585 outage — run 35939085377 minted issue #710 at
// 2026-09-24T00:36:37Z. The outage still ran FIVE DAYS undetected, because the
// router's only output is a GitHub issue, and a GitHub issue only reaches a human
// or an agent by being mirrored into Paperclip **by the github-sync worker** —
// the exact component that was dead. The alarm was wired through the thing it
// was alarming about. A deploy that kills github-sync can therefore never report
// itself, no matter how loudly the router mints issues.
//
// This module is the OUT-OF-BAND leg: a direct HTTPS POST from the Actions runner
// to the Grove ops Discord webhook, which touches neither the droplet, the
// Paperclip host, nor the github-sync worker. It shares the router's existing
// `workflow_run` plumbing (no second notification workflow) but not its delivery
// path, which is the whole point.
//
// Split in two on purpose: the workflow's github-script step GATHERS facts
// (octokit: failed jobs, failed step names, the first `::error::` line from the
// job log) into a JSON file; this script FORMATS and POSTS them. The formatting
// is therefore pure and unit-testable offline with no network and no octokit —
// see deploy-failure-alert.test.mjs.
//
// Usage (CI):  node scripts/ci/deploy-failure-alert.mjs <facts.json>
//   env DISCORD_WEBHOOK_URL  Grove ops webhook. UNSET → warn + exit 0, so a
//                            missing secret can never turn the router red (the
//                            router's issue-minting leg still ran).
//   env DEPLOY_ALERT_DRY_RUN "1" → print the payload, never POST (used by the
//                            workflow's self-test and by hand.)
//
// Exit: 0 always on the happy path AND on a missing webhook; non-zero only when
// the facts file is unreadable or Discord hard-fails, so a broken alert path is
// itself visible as a red job.

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Discord rejects a message body over 2000 characters outright (HTTP 400). */
export const DISCORD_CONTENT_LIMIT = 2000;

/**
 * First actionable error line from a raw Actions job log.
 *
 * GitHub renders a `::error::` workflow command into the downloaded log as
 * `##[error]`, prefixed by an ISO timestamp — so matching only the literal
 * `::error::` finds nothing in a real log. We match both spellings, then fall
 * back to the loud-failure vocabulary this repo's deploy scripts actually use
 * (`FATAL:`, `MISSING `, `did not converge`, a bare `Error:`) so a script that
 * failed via `echo FATAL ... >&2; exit 1` — which is most of scripts/ — still
 * yields a usable line instead of an empty alert.
 *
 * The leading timestamp is stripped so the alert reads as the message, not a log
 * excerpt, and the result is clamped so one enormous line cannot eat the budget.
 */
export function extractFirstError(logText, { maxLen = 300 } = {}) {
  if (!logText || typeof logText !== "string") return null;
  const lines = logText.split(/\r?\n/);
  const strip = (l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, "").trim();
  const patterns = [
    /##\[error\]/i,
    /::error(\s|::)/i,
    /\bFATAL\b/,
    /^MISSING\s/,
    /did not converge/i,
    /\bError:/,
  ];
  for (const re of patterns) {
    for (const raw of lines) {
      if (!re.test(raw)) continue;
      const cleaned = strip(raw).replace(/^##\[error\]\s*/i, "").replace(/^::error(::)?\s*/i, "");
      if (cleaned) return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
    }
  }
  return null;
}

/**
 * Name of the step that actually failed, given a job's `steps[]`.
 * `listJobsForWorkflowRun` reports every step with its own conclusion, so the
 * failing step is the first `conclusion === "failure"`. A cancelled-after-timeout
 * job can have no failed step at all → null, and the caller falls back to the
 * job name (never an empty field in the alert).
 */
export function failingStepName(steps) {
  if (!Array.isArray(steps)) return null;
  const hit = steps.find((s) => s && s.conclusion === "failure");
  return hit && hit.name ? String(hit.name) : null;
}

/**
 * Build the Discord message. Compact by design: this lands in an ops channel that
 * a human reads on a phone, so it is workflow → what broke → where to click, and
 * nothing else. The run URL is last so it stays clickable even if a pathological
 * error line forces truncation (we truncate the error, never the link).
 */
export function buildDeployAlert(facts) {
  const {
    workflow = "(unknown workflow)",
    branch = "(unknown)",
    sha = "",
    event = "",
    runAttempt = 1,
    runUrl = "",
    failedJobs = [],
    firstError = null,
  } = facts || {};

  const jobLine = failedJobs.length
    ? failedJobs
        .map((j) => {
          const step = j.failingStep || j.name || "(unknown step)";
          return j.name && j.failingStep && j.failingStep !== j.name
            ? `${j.name} → ${j.failingStep}`
            : step;
        })
        .join(", ")
    : "(no job-level detail — open the run)";

  const head = [
    `🚨 **DEPLOY FAILED — ${workflow}**`,
    `**Failed step:** ${jobLine}`,
  ];
  if (firstError) head.push(`**Error:** \`${firstError.replace(/`/g, "'")}\``);
  head.push(
    `**Where:** \`${branch}\`${sha ? ` @ \`${String(sha).slice(0, 7)}\`` : ""}` +
      `${event ? ` (${event}` : ""}${event && Number(runAttempt) > 1 ? `, attempt ${runAttempt}` : ""}${event ? ")" : ""}`,
  );
  head.push(
    "Infra may be mid-outage and the board may not hear about it — the router's GitHub issue is mirrored by github-sync, which a bad plugin deploy can itself kill (GOL-2585). Check the run before trusting the board.",
  );
  head.push(runUrl);

  let content = head.join("\n");
  if (content.length > DISCORD_CONTENT_LIMIT) {
    // Truncate the body but always keep the run URL — the one thing that makes
    // the alert actionable.
    const keep = `\n…(truncated)\n${runUrl}`;
    content = content.slice(0, DISCORD_CONTENT_LIMIT - keep.length) + keep;
  }
  return content;
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
// `import.meta.main` is not available on the Node 20 runner, so compare the
// resolved module URL against argv[1]. realpath + pathToFileURL so a relative
// invocation, a symlinked checkout, or a `./scripts/...` prefix all still match
// (a substring check on the path silently stops running the CLI when any of
// those change, which would make this alerter a no-op in CI).
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const factsPath = process.argv[2];
  if (!factsPath) {
    console.error("usage: deploy-failure-alert.mjs <facts.json>");
    process.exit(2);
  }
  const facts = JSON.parse(readFileSync(factsPath, "utf8"));
  const content = buildDeployAlert(facts);
  const webhook = process.env.DISCORD_WEBHOOK_URL || "";

  if (process.env.DEPLOY_ALERT_DRY_RUN === "1") {
    console.log("--- dry run, not posting ---");
    console.log(content);
    process.exit(0);
  }
  if (!webhook) {
    // Never fail the router for an unset secret: the issue-minting leg already ran.
    console.warn("deploy-failure-alert: DISCORD_WEBHOOK_URL unset — no ops alert posted.");
    console.warn(content);
    process.exit(0);
  }
  const status = await postDiscord(webhook, content);
  if (status >= 200 && status < 300) {
    console.log(`deploy-failure-alert: posted to Grove ops Discord (HTTP ${status}).`);
    process.exit(0);
  }
  console.error(`deploy-failure-alert: Discord POST failed (HTTP ${status}).`);
  process.exit(1);
}
