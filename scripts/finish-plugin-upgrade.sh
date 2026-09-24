#!/usr/bin/env bash
#
# finish-plugin-upgrade.sh — GOL-733 (follow-up to GOL-717 / GOL-727)
#
# Finish a manifest-version bump for one or more AgenticOS plugins by converging
# the STORED plugin-registry version with the freshly-deployed dist. Run ON the
# droplet by deploy-droplet-plugins.yml AFTER the dists are rebuilt, for each
# plugin whose src/manifest.ts changed (scripts/detect-manifest-bumps.sh).
#
# Why this exists: the deploy hot-reloads worker CODE, but the stored manifest
# version stays pinned to the old value, so the registry + a fresh install seed
# the OLD code path even though main and dist/ are already new (cost 2 full
# investigations: GOL-717, GOL-727). POST /api/plugins/<id>/upgrade is the
# idempotent, zero-downtime finish (safe from `ready`) that bumps the registry
# version AND reloads the worker. This script automates it in CD.
#
# Credentials: the board key is read on the box from 1Password via the
# credential-broker OP service-account token (GOL-313 pattern) — NEVER a GitHub
# Actions secret (no CI secrets:write on this repo; App token = read-only).
#
# Usage: scripts/finish-plugin-upgrade.sh <plugin> [<plugin> ...]
#   plugin ∈ any name in PLUGIN_DIRS (scripts/plugin-registry.sh)
#
# Env overrides:
#   COMPOSE_DIR    default /opt/agenticos      (docker compose project dir)
#   REPO_DIR       default /opt/agenticos/repo (deployed checkout with dist/)
#   BROKER_ENV     default $COMPOSE_DIR/secrets/credential-broker.env
#   BOARD_KEY_REF  default op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key
#   OP_IMG         default 1password/op:2
#   PAPERCLIP_BASE override the API origin (default: derived from `docker compose port`)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
REPO_DIR="${REPO_DIR:-/opt/agenticos/repo}"
BROKER_ENV="${BROKER_ENV:-${COMPOSE_DIR}/secrets/credential-broker.env}"
BOARD_KEY_REF="${BOARD_KEY_REF:-op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key}"
OP_IMG="${OP_IMG:-1password/op:2}"
# shellcheck source=scripts/plugin-registry.sh
source "${HERE}/plugin-registry.sh"
# Previously a hand-maintained list that had already drifted: discord-plugin was
# in the deploy workflow's build loop but NOT here, so a discord manifest bump
# would have hard-failed CD with "unknown plugin". One list now (GOL-2423).
VALID="${PLUGIN_DIRS}"

# --- validate args BEFORE touching op/docker so bad input fails fast ----------
[ "$#" -ge 1 ] || { echo "usage: $0 <plugin> [<plugin> ...]" >&2; exit 2; }
for p in "$@"; do
  case " ${VALID} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}' (valid: ${VALID})" >&2; exit 2 ;;
  esac
done
command -v node   >/dev/null || { echo "FATAL: node not found on PATH" >&2; exit 1; }

# --- resolve PAPERCLIP_BASE + BOARD_KEY (shared with assert-plugin-versions.sh)
# shellcheck source=scripts/plugin-api-env.sh
source "${HERE}/plugin-api-env.sh"

echo "paperclip API: ${PAPERCLIP_BASE}"

rc=0
for p in "$@"; do
  # Manifest-declared id, not "agenticos.<dir>" — they differ for
  # grove-content-drafter-plugin (agenticos.grove-content-drafter).
  key="$(plugin_key "$p")"
  if plugin_is_pending_install "$p"; then
    echo "== ${p}: pending first install (PLUGIN_PENDING_INSTALL) — nothing to /upgrade, skipping =="
    continue
  fi
  mf="${REPO_DIR}/packages/${p}/dist/manifest.js"
  want=""
  if [ -s "$mf" ]; then
    # Format-agnostic: read the version string straight out of the built dist.
    want="$(grep -oE 'version:[[:space:]]*"[^"]+"' "$mf" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  fi
  # Canonical container-visible source to reinstall from if /upgrade cannot
  # converge (packagePath drifted to a stale staged dir — GOL-804). This is the
  # CD-rebuilt bind mount the deploy step just refreshed; reinstalling from it
  # REPOINTS the registry's stored packagePath back to fresh code. The path is a
  # CONTAINER path resolved by paperclip-server, not a droplet-host path.
  reinstall_path="/paperclip/plugins/${p}"
  echo "== ${p}: /upgrade → converge registry to ${want:-<unknown>} (repoint fallback: ${reinstall_path}) =="
  if PLUGIN_KEY="$key" WANT_VERSION="$want" REINSTALL_PATH="$reinstall_path" \
       node "${HERE}/finish-plugin-upgrade.mjs"; then
    echo "   ${p}: converged"
  else
    echo "::error title=Plugin upgrade failed::${p}: the registry did not converge to ${want:-the deployed version} via /upgrade — the running worker may still serve the previous code path. Finish manually per docs/runbooks/deploy-plugin-manifest-change.md"
    rc=1
  fi
done
exit $rc
