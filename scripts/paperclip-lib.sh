#!/usr/bin/env bash
#
# paperclip-lib.sh — shared helpers for Paperclip plugin management scripts.
# SOURCE this (don't execute). Used by sync-paperclip-secrets.sh and
# deploy-plugin.sh. Reads credentials from 1Password and talks to the Paperclip
# board API. NEVER prints a secret value.
#
# Requires: op, jq, curl (assert with pc_require_tools).
# Env defaults (override before sourcing or in the caller's environment):

PAPERCLIP_BASE="${PAPERCLIP_BASE:-http://localhost:3100}"
OP_ITEM="${OP_ITEM:-AgenticOS Infra}"
OP_VAULT="${OP_VAULT:-Goldberry Grove - Admin}"
OP_FIELD_BOARD_KEY="${OP_FIELD_BOARD_KEY:-paperclip_board_key}"
OP_FIELD_GITHUB="${OP_FIELD_GITHUB:-github_token}"
OP_FIELD_OPENVIKING="${OP_FIELD_OPENVIKING:-openviking_root_api_key}"
GITHUB_ORG="${GITHUB_ORG:-Goldberry-Playground}"

pc_require_tools() {
  command -v op   >/dev/null || { echo "FATAL: 1Password CLI 'op' not found" >&2; exit 1; }
  command -v jq   >/dev/null || { echo "FATAL: 'jq' not found" >&2; exit 1; }
  command -v curl >/dev/null || { echo "FATAL: 'curl' not found" >&2; exit 1; }
}

op_read() { op read "op://${OP_VAULT}/${OP_ITEM}/$1"; }

# pc_load_board_key — read the board key into PC_BOARD_KEY once (memory only).
pc_load_board_key() {
  [ -n "${PC_BOARD_KEY:-}" ] && return 0
  PC_BOARD_KEY="$(op_read "${OP_FIELD_BOARD_KEY}")"
  [ -n "${PC_BOARD_KEY}" ] || { echo "FATAL: board key empty" >&2; exit 1; }
}

# api METHOD PATH [JSON-BODY] — board-authed curl. Requires PC_BOARD_KEY.
api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" -H "Authorization: Bearer ${PC_BOARD_KEY}" \
      -H "Content-Type: application/json" -d "$body" "${PAPERCLIP_BASE}${path}"
  else
    curl -fsS -X "$method" -H "Authorization: Bearer ${PC_BOARD_KEY}" \
      "${PAPERCLIP_BASE}${path}"
  fi
}

# resolve_plugin_id PLUGINKEY — echoes the plugin id, or empty if not installed.
resolve_plugin_id() {
  api GET /api/plugins | jq -r --arg k "$1" \
    '(if type=="object" then .plugins else . end)[] | select(.pluginKey==$k) | .id'
}

# configure_github — POST github-plugin config (token read from 1Password,
# supplied inline to jq, never echoed).
configure_github() {
  local id token cfg
  token="$(op_read "${OP_FIELD_GITHUB}")"
  [ -n "$token" ] || { echo "FATAL: github token empty" >&2; return 1; }
  id="$(resolve_plugin_id agenticos.github-plugin)"
  [ -n "$id" ] || { echo "FATAL: github-plugin not installed" >&2; return 1; }
  cfg="$(jq -nc --arg t "$token" --arg org "$GITHUB_ORG" \
    '{configJson:{githubToken:$t, org:$org, staleDays:7, vaultPath:"wiki/_meta/dev-pr-digest.md", vaultServerUrl:"http://vault-server:7777"}}')"
  api POST "/api/plugins/${id}/config" "$cfg" >/dev/null
  echo "    github-plugin config set"
}

# configure_openviking — POST openviking-plugin config (key from 1Password).
configure_openviking() {
  local id key cfg
  key="$(op_read "${OP_FIELD_OPENVIKING}")"
  [ -n "$key" ] || { echo "FATAL: openviking key empty" >&2; return 1; }
  id="$(resolve_plugin_id agenticos.openviking-plugin)"
  [ -n "$id" ] || { echo "FATAL: openviking-plugin not installed" >&2; return 1; }
  cfg="$(jq -nc --arg k "$key" \
    '{configJson:{apiKey:$k, endpoint:"http://openviking:1933", account:"agenticos", user:"deploy"}}')"
  api POST "/api/plugins/${id}/config" "$cfg" >/dev/null
  echo "    openviking-plugin config set"
}

# configure_discord_plugin — POST discord-plugin config (secrets from 1Password).
# Env vars required (all :? so the script fails fast if unset):
#   DISCORD_RECEIPTS_CHANNEL_ID   Discord channel id for #receipts (or #receipts-test)
#   PAPERCLIP_COMPANY_ID          company row id from the Paperclip DB
#   PENNY_AGENT_ID                agent row id for Penny in the Paperclip DB
#   JOSH_DISCORD_USER_ID          Josh's Discord user snowflake (for DM digests)
# 1Password fields (same OP_VAULT/OP_ITEM as the rest of this lib):
#   discord-bot-token, spaces-receipts-key, spaces-receipts-secret
configure_discord_plugin() {
  local id discord_token spaces_key spaces_secret cfg
  discord_token="$(op_read discord-bot-token)"
  [ -n "$discord_token" ] || { echo "FATAL: discord-bot-token empty" >&2; return 1; }
  spaces_key="$(op_read spaces-receipts-key)"
  [ -n "$spaces_key" ] || { echo "FATAL: spaces-receipts-key empty" >&2; return 1; }
  spaces_secret="$(op_read spaces-receipts-secret)"
  [ -n "$spaces_secret" ] || { echo "FATAL: spaces-receipts-secret empty" >&2; return 1; }
  id="$(resolve_plugin_id agenticos.discord-plugin)"
  [ -n "$id" ] || { echo "FATAL: discord-plugin not installed" >&2; return 1; }
  cfg="$(jq -nc \
    --arg t  "$discord_token" \
    --arg chan "${DISCORD_RECEIPTS_CHANNEL_ID:?set DISCORD_RECEIPTS_CHANNEL_ID}" \
    --arg co  "${PAPERCLIP_COMPANY_ID:?set PAPERCLIP_COMPANY_ID}" \
    --arg penny "${PENNY_AGENT_ID:?set PENNY_AGENT_ID}" \
    --arg josh  "${JOSH_DISCORD_USER_ID:?set JOSH_DISCORD_USER_ID}" \
    --arg sk "$spaces_key" \
    --arg ss "$spaces_secret" \
    '{configJson:{
      discordBotToken:$t,
      receiptsChannelId:$chan,
      companyId:$co,
      pennyAgentId:$penny,
      joshDiscordUserId:$josh,
      spacesKey:$sk,
      spacesSecret:$ss,
      spacesBucket:"agenticos-receipts",
      spacesRegion:"nyc3",
      spacesEndpoint:"https://nyc3.digitaloceanspaces.com",
      presignExpirySeconds:604800}}')"
  api POST "/api/plugins/${id}/config" "$cfg" >/dev/null
  echo "    discord-plugin config set"
}
