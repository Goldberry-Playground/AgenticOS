#!/usr/bin/env bash
#
# deploy-plugin.sh — finish a manifest-change deploy for one or more AgenticOS
# plugins. Run from the Mac, exactly like sync-paperclip-secrets.sh:
#   - `op` signed in (`op signin`)
#   - SSH tunnel to Paperclip open:
#       ssh -fNL 3100:10.116.16.2:3100 deploy@<droplet>
# Idempotent: safe to re-run.
#
# Per plugin:
#   1. recreate-guard — force-recreate paperclip-server ONLY if the plugin dir
#      isn't visible in the container yet (a newly-added bind mount)
#   2. delete + reinstall — refreshes the stored manifest (install won't update)
#   3. apply config from 1Password — github/openviking only; vault has none;
#      github-sync is configured via its own runbook
#   4. disable -> enable — forces the worker setup() to re-run with fresh config
#   5. assert — plugin present and not in an error state
#
# Usage: scripts/deploy-plugin.sh <plugin> [<plugin> ...]
#   plugin ∈ vault-plugin | openviking-plugin | github-plugin | github-sync-plugin | discord-plugin
#
# Env: as paperclip-lib.sh, plus:
#   DROPLET_SSH   default "deploy@agenticos-droplet"  (recreate-guard SSH target)
#   COMPOSE_DIR   default "/opt/agenticos"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/paperclip-lib.sh
source "${HERE}/paperclip-lib.sh"

DROPLET_SSH="${DROPLET_SSH:-deploy@agenticos-droplet}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
VALID_PLUGINS="vault-plugin openviking-plugin github-plugin github-sync-plugin discord-plugin"

# --- github-sync inbound webhook id-drift gate (GOL-1394) ---------------------
# A github-sync reinstall ROTATES the plugin id (delete+install is Paperclip's
# only update path). That id is embedded in the inbound webhook URL in THREE
# places that must move together: the CF Access apps (cloudflare-qa-webhook.tf
# var.github_sync_plugin_id), the GitHub App webhook URL, and the install. On
# 2026-08-12 only the install moved → ~20h of silently-severed inbound sync
# (every GitHub delivery 302'd at the CF edge). This gate compares the live
# installed id against the committed TF var and, on mismatch, prints the exact
# operator legs. Default = FAIL (can't be silently ignored); PLUGIN_ID_GATE=warn
# downgrades to a non-fatal warning.
TF_WEBHOOK_FILE="${TF_WEBHOOK_FILE:-${HERE}/../infra/terraform/cloudflare-qa-webhook.tf}"
PLUGIN_ID_GATE="${PLUGIN_ID_GATE:-fail}"   # fail | warn

usage() {
  echo "Usage: $0 <plugin> [<plugin> ...]" >&2
  echo "  plugin ∈ ${VALID_PLUGINS}" >&2
  exit 2
}

# --- validate args BEFORE touching op/ssh so bad input fails fast & offline ---
[ "$#" -ge 1 ] || usage
for p in "$@"; do
  case " ${VALID_PLUGINS} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}'" >&2; usage ;;
  esac
done

pc_require_tools
command -v ssh >/dev/null || { echo "FATAL: 'ssh' not found" >&2; exit 1; }
pc_load_board_key

# recreate_guard PLUGIN — recreate paperclip-server iff the plugin dir is not
# yet visible in the container. Idempotent (skips when the mount resolves).
recreate_guard() {
  local p="$1"
  if ssh "${DROPLET_SSH}" \
       "cd ${COMPOSE_DIR} && docker compose exec -T paperclip-server test -s /paperclip/plugins/${p}/package.json" \
       >/dev/null 2>&1; then
    echo "    ${p}: mount already resolved (no recreate)"
    return 0
  fi
  echo "    ${p}: mount missing in container -> force-recreate paperclip-server"
  ssh "${DROPLET_SSH}" \
    "cd ${COMPOSE_DIR} && docker compose up -d --force-recreate paperclip-server"
  for _ in $(seq 1 30); do
    if api GET /api/plugins >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "FATAL: ${p}: API did not come back after recreate" >&2
  return 1
}

# reinstall PLUGIN — delete (if present) then install fresh.
#
# POST /api/plugins/install returns 400 in two distinct situations:
#   a) true install rejection (e.g. missing dist/ or manifest): NO plugin row
#      is created — fatal, nothing downstream can recover it.
#   b) worker ACTIVATION failed during install (e.g. required config such as
#      discordBotToken not applied yet): the plugin row IS created with
#      state=error, and the recovery is exactly what this script does next
#      anyway — apply_config then disable/enable. Continue with a warning.
# We distinguish them by probing for the plugin row after a failed install.
reinstall() {
  local p="$1" id status
  id="$(resolve_plugin_id "agenticos.${p}")"
  if [ -n "$id" ]; then
    api DELETE "/api/plugins/${id}" >/dev/null && echo "    ${p}: deleted ${id}"
  fi
  if status="$(api POST /api/plugins/install \
    "{\"packageName\":\"/paperclip/plugins/${p}\",\"isLocalPath\":true}" \
    | jq -r '.status')"; then
    echo "    ${p}: installed -> ${status}"
    return 0
  fi
  id="$(resolve_plugin_id "agenticos.${p}")"
  if [ -n "$id" ]; then
    echo "    ${p}: WARN install failed but plugin row ${id} exists (worker" >&2
    echo "    ${p}:   activation failed, likely missing config) — continuing;" >&2
    echo "    ${p}:   apply_config + disable/enable should recover it" >&2
    return 0
  fi
  echo "FATAL: ${p}: install rejected and no plugin row created (missing dist/manifest?)" >&2
  return 1
}

# apply_config PLUGIN — push config from 1Password for plugins that take it.
apply_config() {
  local p="$1"
  case "$p" in
    github-plugin)      configure_github ;;
    openviking-plugin)  configure_openviking ;;
    vault-plugin)       echo "    ${p}: no config" ;;
    github-sync-plugin) echo "    ${p}: config deferred -> see docs/runbooks/github-issue-sync.md" ;;
    discord-plugin)     configure_discord_plugin ;;
  esac
}

# cycle PLUGIN — disable then enable to force setup() to re-run.
cycle() {
  local p="$1" id
  id="$(resolve_plugin_id "agenticos.${p}")"
  [ -n "$id" ] || { echo "FATAL: ${p} missing after install" >&2; return 1; }
  api POST "/api/plugins/${id}/disable" >/dev/null 2>&1 || true
  api POST "/api/plugins/${id}/enable"  >/dev/null
  echo "    ${p}: disabled+enabled"
}

# assert_healthy PLUGIN — print status; fail on an error/empty state.
# Healthy = not in an error state. A plugin like github-sync-plugin stays
# inactive by design until separately configured, so we do NOT assert "active".
assert_healthy() {
  local p="$1" status
  status="$(api GET /api/plugins | jq -r --arg k "agenticos.${p}" \
    '(if type=="object" then .plugins else . end)[] | select(.pluginKey==$k) | .status')"
  echo "    ${p}: status=${status}"
  case "$status" in
    error|failed|"") echo "FATAL: ${p} not healthy (status='${status}')" >&2; return 1 ;;
  esac
}

# tf_github_sync_id — parse the committed default of var.github_sync_plugin_id
# from cloudflare-qa-webhook.tf. Empty if the file/var is missing. NOTE: this is
# the committed intent; a terraform.tfvars override is not read here (the gate is
# a drift tripwire, not a full plan) — see the runbook.
tf_github_sync_id() {
  [ -f "${TF_WEBHOOK_FILE}" ] || { echo ""; return 0; }
  awk '/variable "github_sync_plugin_id"/{f=1} f&&/default/{print; exit}' "${TF_WEBHOOK_FILE}" \
    | grep -oiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1
}

# assert_inbound_id_stable — after a github-sync reinstall, the live id must
# still match the id the inbound webhook path is scoped to (TF + GitHub App).
# On mismatch the inbound sync is SEVERED until an operator re-scopes all three.
assert_inbound_id_stable() {
  local live tf
  live="$(resolve_plugin_id "agenticos.github-sync-plugin")"
  tf="$(tf_github_sync_id)"
  if [ -z "$tf" ]; then
    echo "    github-sync-plugin: WARN could not read var.github_sync_plugin_id from ${TF_WEBHOOK_FILE} — id gate SKIPPED" >&2
    return 0
  fi
  if [ -z "$live" ]; then
    echo "    github-sync-plugin: WARN plugin not installed — id gate SKIPPED" >&2
    return 0
  fi
  if [ "$live" = "$tf" ]; then
    echo "    github-sync-plugin: inbound id gate OK (live=TF=${live})"
    return 0
  fi
  # --- DRIFT: inbound sync is now severed at the edge -------------------------
  cat >&2 <<EOF

  ============================================================================
  🚨 INBOUND WEBHOOK ID DRIFT — GitHub→Paperclip issue sync is SEVERED (GOL-1394)
  ============================================================================
    live installed id : ${live}
    TF-scoped id      : ${tf}   (var.github_sync_plugin_id)

  The github-sync plugin id rotated on reinstall. Until all three are re-scoped
  to ${live}, every GitHub issue/PR delivery 302s at the Cloudflare edge and NO
  GitHub-created issue reaches the board. Operator legs (see
  docs/runbooks/github-issue-sync.md):

    1. infra/terraform/cloudflare-qa-webhook.tf: set
         default = "${live}"  (var.github_sync_plugin_id), then \`terraform apply\`.
    2. GitHub App "AgenticOS Developer" → webhook URL:
         https://paperclip.gatheringatthegrove.com/api/plugins/${live}/webhooks/github-app
    3. Update the inbound dead-man probe target (repo var GITHUB_SYNC_PLUGIN_ID
       or the webhook URL secret) so the probe tracks the live id.
  ============================================================================
EOF
  if [ "${PLUGIN_ID_GATE}" = "warn" ]; then
    echo "    github-sync-plugin: id gate WARN-only (PLUGIN_ID_GATE=warn) — continuing" >&2
    return 0
  fi
  return 1
}

gate_rc=0
for p in "$@"; do
  echo "==> ${p}"
  recreate_guard "$p"
  reinstall "$p"
  apply_config "$p"
  cycle "$p"
  assert_healthy "$p"
  # A github-sync reinstall rotates the id — verify the inbound path still
  # resolves. Deferred non-fatal so the rest of the deploy completes; the
  # script exits non-zero at the end so CI/the operator can't miss the drift.
  if [ "$p" = "github-sync-plugin" ]; then
    assert_inbound_id_stable || gate_rc=1
  fi
done
echo "==> done. Plugins refreshed from 1Password: $*"
if [ "$gate_rc" -ne 0 ]; then
  echo "==> FAIL: github-sync inbound webhook id drift (see above). Re-scope TF + GitHub App, then re-run." >&2
  exit 1
fi
