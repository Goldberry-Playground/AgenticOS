#!/usr/bin/env bash
#
# sync-paperclip-secrets.sh — push plugin config (incl. tokens) from 1Password
# into the running Paperclip instance, with NO secret ever touching a terminal
# transcript or chat. Values flow 1Password -> this process -> the Paperclip API.
#
# WHY plain config (not the encrypted secrets vault): Paperclip 2026.609.0 has
# the plugin secret-resolution path disabled ("disabled until company-scoped
# plugin config lands") AND the resolve handler is stubbed. So plugin secrets
# live in plugin config (plaintext at rest in Postgres) until that lands
# upstream. See the plugin manifests for the migration note.
#
# WHAT it does (idempotent):
#   1. delete + reinstall the AgenticOS plugins in PLUGIN_DIRS
#      (scripts/plugin-registry.sh) — refreshes their manifests. Plugins listed
#      in PLUGIN_CONFIG_EXTERNAL are KEPT, not deleted: their config comes from
#      elsewhere and a DELETE would drop it with nothing here to restore it.
#   2. set github-plugin + openviking-plugin config (token/key + non-secret opts)
#   3. (optional) trigger the pr-triage job to verify end to end
#
# PREREQUISITES
#   - Run from the Mac (where `op` lives) with an SSH tunnel to Paperclip open:
#       ssh -N -L 3100:10.116.16.2:3100 deploy@<droplet>
#   - `op` (1Password CLI) signed in: `op signin`
#   - An instance-admin board API key stored in 1Password. Mint one once:
#       docker compose exec paperclip-server paperclipai token board create \
#         --name secret-sync --never-expires
#     then save the returned `pcp_board_...` value into the AgenticOS Infra item
#     as field `paperclip_board_key`.
#
# CONFIG (override via env):
#   PAPERCLIP_BASE   default http://localhost:3100   (the tunnel)
#   OP_ITEM          default "AgenticOS Infra"
#   OP_VAULT         default "Goldberry Grove - Admin"
# Field names within the item (override if yours differ):
#   OP_FIELD_BOARD_KEY   default paperclip_board_key
#   OP_FIELD_GITHUB      default github_token
#   OP_FIELD_OPENVIKING  default openviking_root_api_key
#   TRIGGER_TRIAGE   set to "1" to fire pr-triage at the end
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/paperclip-lib.sh
source "${HERE}/paperclip-lib.sh"
# shellcheck source=scripts/plugin-registry.sh
source "${HERE}/plugin-registry.sh"

GITHUB_ORG="${GITHUB_ORG:-EngineeringMoonBear}"
TRIGGER_TRIAGE="${TRIGGER_TRIAGE:-0}"

pc_require_tools
pc_load_board_key

echo "==> 1/3 refreshing plugins (delete + reinstall to pick up new manifests)"
# The refresh is destructive by design — DELETE drops the plugin row AND its
# config, and the reinstall below re-supplies config for the plugins this script
# knows about. Plugins whose config comes from somewhere else
# (PLUGIN_CONFIG_EXTERNAL) must therefore be left alone: deleting one would
# de-configure a working plugin that nothing here can put back.
protected_keys=""
for name in ${PLUGIN_DIRS}; do
  # `if`, not `a && b`: under `set -e` a false trailing `&&` list exits.
  if plugin_config_is_external "$name"; then protected_keys="${protected_keys} $(plugin_key "$name")"; fi
done
existing="$(api GET /api/plugins)"
echo "$existing" | jq -r '(if type=="object" then .plugins else . end)[] | select(.pluginKey|startswith("agenticos.")) | "\(.id) \(.pluginKey)"' \
  | while read -r id key; do
      [ -n "$id" ] || continue
      case " ${protected_keys} " in
        *" ${key} "*)
          echo "    kept ${key} — config set out of band; DELETE would drop it."
          echo "        refresh its manifest with POST /api/plugins/${id}/upgrade instead"
          continue
          ;;
      esac
      api DELETE "/api/plugins/${id}" >/dev/null
      echo "    deleted ${id} (${key})"
    done
# discord-plugin is installed here; config is set below via configure_discord_plugin.
# PLUGIN_PENDING_INSTALL plugins are built + bind-mounted but not installed yet;
# this script will NOT perform that gated first install unless you opt in with
# INSTALL_PENDING=1, so an unrelated secret-sync can't do it by accident.
for name in ${PLUGIN_DIRS}; do
  if plugin_config_is_external "$name"; then
    echo "    skipped ${name} (kept above; config is external to this script)"
    continue
  fi
  if plugin_is_pending_install "$name" && [ "${INSTALL_PENDING:-0}" != "1" ]; then
    echo "    skipped ${name} (pending first install; re-run with INSTALL_PENDING=1 to install)"
    continue
  fi
  status="$(api POST /api/plugins/install \
    "{\"packageName\":\"/paperclip/plugins/${name}\",\"isLocalPath\":true}" \
    | jq -r '.status')"
  echo "    installed ${name} -> ${status}"
done

echo "==> 2/3 setting plugin config (token values supplied inline by jq, not echoed)"
configure_github
configure_openviking
# discord-plugin config requires env vars; skip gracefully if not set so the
# script can still run for a partial refresh (e.g., only github/openviking).
if [[ -n "${DISCORD_RECEIPTS_CHANNEL_ID:-}" && -n "${PAPERCLIP_COMPANY_ID:-}" && \
      -n "${PENNY_AGENT_ID:-}" && -n "${JOSH_DISCORD_USER_ID:-}" ]]; then
  configure_discord_plugin
else
  echo "    discord-plugin: skipped (set DISCORD_RECEIPTS_CHANNEL_ID / PAPERCLIP_COMPANY_ID / PENNY_AGENT_ID / JOSH_DISCORD_USER_ID to configure)"
fi

gh_id="$(resolve_plugin_id agenticos.github-plugin)"
if [ "${TRIGGER_TRIAGE}" = "1" ]; then
  echo "==> 3/3 triggering pr-triage"
  job_id="$(api GET "/api/plugins/${gh_id}/jobs" | jq -r '(if type=="object" then .jobs else . end)[] | select(.jobKey=="pr-triage") | .id' | head -1)"
  if [ -n "$job_id" ]; then
    api POST "/api/plugins/${gh_id}/jobs/${job_id}/trigger" '{}' >/dev/null && echo "    pr-triage triggered"
  else
    echo "    WARN: could not resolve pr-triage job id; trigger it from the UI"
  fi
else
  echo "==> 3/3 skipped trigger (set TRIGGER_TRIAGE=1 to fire pr-triage)"
fi

echo "==> done. Plugins refreshed + configured from 1Password."
