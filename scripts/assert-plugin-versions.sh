#!/usr/bin/env bash
#
# assert-plugin-versions.sh — GOL-804
#
# Post-deploy invariant check, run ON the droplet after the plugin dists are
# rebuilt. For each plugin passed (default: every deploy-managed plugin), read the freshly-built
# version from its dist and assert the LIVE registry reports that exact version
# and a healthy status. The pluginKey comes from plugin_key() (the manifest's
# declared id), NOT from "agenticos.<dir>" — grove-content-drafter-plugin
# declares agenticos.grove-content-drafter and the old concat would have
# asserted a key that does not exist. Fails RED if any plugin's registry drifted
# from the built code — the backstop that turns a silent stale deploy (GOL-804) into a
# loud failure, regardless of whether a manifest bump was detected.
#
# Usage: scripts/assert-plugin-versions.sh [<plugin> ...]
#   plugin ∈ any name in PLUGIN_DIRS (scripts/plugin-registry.sh)
#   (no args → assert every deploy-managed plugin)
#
# Env: see plugin-api-env.sh, plus REPO_DIR (default /opt/agenticos/repo).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/opt/agenticos/repo}"
# shellcheck source=scripts/plugin-registry.sh
source "${HERE}/plugin-registry.sh"
VALID="${PLUGIN_DIRS}"

command -v node >/dev/null || { echo "FATAL: node not found on PATH" >&2; exit 1; }

plugins=("$@")
[ "${#plugins[@]}" -ge 1 ] || read -r -a plugins <<< "$VALID"
for p in "${plugins[@]}"; do
  case " ${VALID} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}' (valid: ${VALID})" >&2; exit 2 ;;
  esac
done

# shellcheck source=scripts/plugin-api-env.sh
source "${HERE}/plugin-api-env.sh"
echo "paperclip API: ${PAPERCLIP_BASE}"

# Build the <pluginKey>=<builtVersion> expectation map from the deployed dists.
expect=""
for p in "${plugins[@]}"; do
  mf="${REPO_DIR}/packages/${p}/dist/manifest.js"
  [ -s "$mf" ] || { echo "FATAL: ${p}: built manifest missing at ${mf}" >&2; exit 1; }
  v="$(grep -oE 'version:[[:space:]]*"[^"]+"' "$mf" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  [ -n "$v" ] || { echo "FATAL: ${p}: could not read version from ${mf}" >&2; exit 1; }
  expect="${expect} $(plugin_key "$p")=${v}"
done

# Plugins that are built + bind-mounted but not installed in the registry yet
# (PLUGIN_PENDING_INSTALL). The .mjs skips their version assertion AND fails RED
# if one is actually installed, so a pending entry can never silently outlive
# the install it is waiting on.
pending=""
for p in "${plugins[@]}"; do
  # `if`, not `a && b`: under `set -e` a trailing `&&` list whose left side is
  # false exits the script.
  if plugin_is_pending_install "$p"; then pending="${pending} $(plugin_key "$p")"; fi
done

EXPECT="${expect# }" PENDING="${pending# }" node "${HERE}/assert-plugin-versions.mjs"
