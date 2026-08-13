#!/usr/bin/env bash
#
# inbound-deadman-probe.sh — dead-man probe for the GitHub→Paperclip inbound
# webhook (GOL-1394). The inbound sibling of the hourly OUTBOUND mirror-reconcile.
#
# WHY: the inbound path (GitHub App `issues`/`pull_request` deliveries →
# /api/plugins/<id>/webhooks/github-app, through a Cloudflare Access *bypass*
# app) fails SILENTLY on our side. When the plugin id rotates on a reinstall, or
# a CF Access re-scope drifts, every delivery 302s at the edge (or 404s at the
# host) and no GitHub-created issue reaches the board — GitHub logs the failed
# deliveries, but nothing on our side alerts (the 2026-08-12 incident ran ~20h
# undetected; GitHub auto-disables a webhook after enough failures). This probe
# replays exactly what GitHub does: an HMAC-signed `ping` POST to the SAME URL,
# with NO Cloudflare Access service-token headers (the github-app endpoint is a
# Bypass app — GitHub can't send them either). A healthy edge+id returns 200
# from the plugin; a severed edge returns a 302 to the CF Access login, and a
# rotated id returns 404 from the host. Anything but 200 → alert Grove ops
# Discord.
#
# This is a READ-ONLY reachability probe: `ping` is ignored by the plugin
# (X-GitHub-Event != issues → 200, no board write, no scratch issue, zero
# board noise), so it is safe to run on a schedule.
#
# Env:
#   INBOUND_WEBHOOK_URL       full github-app webhook URL (the value configured
#                             on the AgenticOS Developer GitHub App). REQUIRED.
#   GITHUB_APP_WEBHOOK_SECRET the App's webhook secret (== plugin appWebhookSecret).
#                             REQUIRED — signs X-Hub-Signature-256.
#   DISCORD_WEBHOOK_URL       Grove ops Discord webhook for the failure alert.
#                             Optional; if unset the probe still exits non-zero.
#   PROBE_FORCE_FAIL          test hook: "1" forces a synthetic failure so you
#                             can demonstrate the Discord alert path end-to-end.
#   PROBE_TIMEOUT             curl max-time seconds (default 15).
#
# Exit: 0 = inbound edge healthy; 1 = severed/misconfigured (alert posted).
set -euo pipefail

WEBHOOK_URL="${INBOUND_WEBHOOK_URL:-}"
SECRET="${GITHUB_APP_WEBHOOK_SECRET:-}"
DISCORD="${DISCORD_WEBHOOK_URL:-}"
TIMEOUT="${PROBE_TIMEOUT:-15}"

# No-op (success) until configured — safe to schedule before secrets exist,
# mirroring issue-sync-to-paperclip.yml.
if [ -z "$WEBHOOK_URL" ] || [ -z "$SECRET" ]; then
  echo "inbound-deadman-probe: INBOUND_WEBHOOK_URL / GITHUB_APP_WEBHOOK_SECRET unset — skipping (not configured)."
  exit 0
fi

command -v openssl >/dev/null || { echo "FATAL: openssl not found" >&2; exit 2; }
command -v curl    >/dev/null || { echo "FATAL: curl not found" >&2; exit 2; }

# Minimal, valid GitHub `ping` payload. Static bytes so the HMAC is exact.
PAYLOAD='{"zen":"Keep it logically awesome.","hook_id":0,"deadman":"gol-1394"}'
SIG="$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')"

# Replicate a GitHub App delivery: X-GitHub-Event + HMAC, NO CF Access headers.
# -s no progress, no -f (we must inspect non-2xx), no -L (a 302 IS the signal).
HTTP_CODE="$(curl -s -o /tmp/deadman-body.$$ -w '%{http_code}' \
  --max-time "$TIMEOUT" \
  -X POST "$WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: ping' \
  -H "X-Hub-Signature-256: sha256=${SIG}" \
  -H 'X-GitHub-Delivery: deadman-gol1394-probe' \
  --data "$PAYLOAD" || echo "000")"
BODY_SNIP="$(head -c 200 /tmp/deadman-body.$$ 2>/dev/null | tr '\n' ' ')"
rm -f /tmp/deadman-body.$$

# Test hook: force a failure to demonstrate the alert path.
[ "${PROBE_FORCE_FAIL:-}" = "1" ] && HTTP_CODE="302"

echo "inbound-deadman-probe: POST ${WEBHOOK_URL} -> HTTP ${HTTP_CODE}"

if [ "$HTTP_CODE" = "200" ]; then
  echo "inbound-deadman-probe: OK — inbound edge + plugin id healthy."
  exit 0
fi

# --- failure: classify + alert ------------------------------------------------
case "$HTTP_CODE" in
  301|302|303|307|308) DIAG="Cloudflare Access edge SEVERED — request 302'd to the SSO login (CF Access app not scoped to the current plugin id, or the github-app Bypass app is missing). This is the 2026-08-12 class." ;;
  403)                 DIAG="Cloudflare edge 403 — the service-token app is matching this path instead of the github-app Bypass app (most-specific-app drift)." ;;
  404)                 DIAG="Host 404 — reached Paperclip but the plugin id in the webhook URL no longer exists (rotated on reinstall). Re-scope TF + GitHub App URL to the live id." ;;
  000)                 DIAG="No response (timeout/DNS/connection) within ${TIMEOUT}s — host or edge down." ;;
  5*)                  DIAG="Plugin/host 5xx — reached the plugin but it errored on delivery." ;;
  *)                   DIAG="Unexpected status — inbound path is not returning the plugin's 200." ;;
esac

echo "inbound-deadman-probe: FAIL (HTTP ${HTTP_CODE}) — ${DIAG}" >&2
echo "  body: ${BODY_SNIP}" >&2

if [ -n "$DISCORD" ]; then
  MSG="🚨 **Inbound GitHub→Paperclip sync DEAD** (dead-man probe, GOL-1394)
HTTP \`${HTTP_CODE}\` from the github-app webhook.
${DIAG}
URL: ${WEBHOOK_URL}
No GitHub-created issue is reaching the board. Fix: re-scope infra/terraform/cloudflare-qa-webhook.tf + the AgenticOS Developer GitHub App webhook URL to the live plugin id, then Redeliver failed deliveries (github-issue-sync runbook)."
  PING_PAYLOAD="$(printf '%s' "$MSG" | python3 -c 'import json,sys; print(json.dumps({"content": sys.stdin.read()}))' 2>/dev/null || printf '{"content":"%s"}' "inbound dead-man probe FAILED (HTTP ${HTTP_CODE}) — GOL-1394")"
  curl -s -X POST "$DISCORD" -H 'Content-Type: application/json' --data "$PING_PAYLOAD" >/dev/null \
    && echo "inbound-deadman-probe: posted failure alert to Grove ops Discord." \
    || echo "inbound-deadman-probe: WARN Discord alert POST failed." >&2
else
  echo "inbound-deadman-probe: DISCORD_WEBHOOK_URL unset — no alert posted." >&2
fi

exit 1
