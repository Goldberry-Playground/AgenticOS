#!/usr/bin/env bash
#
# plugin-registry.sh — GOL-2423
#
# THE single source of truth for "which plugins does the droplet deploy path
# manage, and what is each one's pluginKey". Source it; do not execute it.
#
# WHY: adding a plugin used to mean editing five hardcoded, independently
# drifting lists (deploy-droplet-plugins.yml build loop, detect-manifest-bumps.sh,
# finish-plugin-upgrade.sh VALID, assert-plugin-versions.sh VALID,
# deploy-plugin.sh VALID_PLUGINS, recreate-paperclip-server.yml). They DID
# drift: discord-plugin shipped in the workflow's build loop but was missing
# from detect-manifest-bumps.sh AND finish-plugin-upgrade.sh, so a discord
# manifest bump either went undetected or hard-failed CD with "unknown plugin" —
# the exact stale-registry trap GOL-733 was built to close.
#
# KEY DERIVATION: the pluginKey is READ FROM THE MANIFEST SOURCE, not assumed to
# be "agenticos.<dir>". grove-content-drafter-plugin declares
# id: "agenticos.grove-content-drafter" (no `-plugin` suffix), so the old
# string-concat would have asserted a key that does not exist and turned every
# deploy RED with "NOT INSTALLED". Reading the manifest cannot drift.
#
# Env: REPO_DIR (default: the repo this file lives in) — the checkout whose
# packages/<dir>/src/manifest.ts is authoritative.

# Every plugin the deploy path builds, in deploy order. Keep in lockstep with
# the pnpm --filter list + dist loop in .github/workflows/deploy-droplet-plugins.yml,
# the bind mounts in docker-compose.yml, and recreate-paperclip-server.yml.
PLUGIN_DIRS="vault-plugin openviking-plugin github-plugin github-sync-plugin discord-plugin grove-content-drafter-plugin"

# Plugins that are BUILT and bind-mounted but deliberately NOT installed in the
# Paperclip registry yet. Their dists deploy; their registry version is not
# asserted, because there is no install to assert against. This is a HOLDING
# state, not an escape hatch: assert-plugin-versions.mjs fails RED the moment a
# pending plugin turns up installed, forcing it out of this list and into full
# assertion coverage. Remove a name here in the same change that installs it.
#
# Currently EMPTY — every plugin in PLUGIN_DIRS is installed and fully asserted.
# grove-content-drafter-plugin was the last entry; it went in at
# f071f43f-b860-4629-88ad-70823426de2f / 0.2.0 / ready on 2026-09-29 (GOL-2423,
# Josh's out-of-train prod hotfix) and is removed here per the rule above. The
# guard worked exactly as designed: leaving the name in place would have failed
# the next deploy RED with "listed in PLUGIN_PENDING_INSTALL but IS INSTALLED".
PLUGIN_PENDING_INSTALL=""

# Resolved AT SOURCE TIME, where BASH_SOURCE[0] is reliably this file. Doing it
# inside a function instead would read the CALLER's frame and resolve wrong.
PLUGIN_REGISTRY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_plugin_registry_repo_root() {
  if [ -n "${REPO_DIR:-}" ]; then
    echo "${REPO_DIR}"
  else
    ( cd "${PLUGIN_REGISTRY_DIR}/.." && pwd )
  fi
}

# plugin_key <plugin-dir> -> the manifest's declared plugin id.
# Reads packages/<dir>/src/manifest.ts. Falls back to agenticos.<dir> only when
# the manifest is unreadable, so a missing checkout degrades to the old
# behaviour instead of emitting an empty key.
plugin_key() {
  local dir="$1" root k mf
  root="$(_plugin_registry_repo_root)"
  for mf in "${root}/packages/${dir}/src/manifest.ts" \
            "${root}/packages/${dir}/dist/manifest.js"; do
    k="$(grep -oE 'id:[[:space:]]*"agenticos\.[^"]+"' "$mf" 2>/dev/null \
         | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
    [ -n "$k" ] && break
  done
  echo "${k:-agenticos.${dir}}"
}

# Both predicates reject an EMPTY name before matching. Without that guard the
# space-padded `case` degenerates: with $1 unset the needle is `*"  "*`, which a
# space-padded EMPTY list (`"  "`) matches — so `plugin_is_pending_install ""`
# answered TRUE and a plugin with an unset/misread name would silently skip its
# version assertion. That is precisely the silence PLUGIN_PENDING_INSTALL's
# guard exists to prevent, so fail closed instead.

# plugin_is_valid <plugin-dir>
plugin_is_valid() {
  [ -n "${1:-}" ] || return 1
  case " ${PLUGIN_DIRS} " in *" ${1} "*) return 0 ;; *) return 1 ;; esac
}

# plugin_is_pending_install <plugin-dir>
plugin_is_pending_install() {
  [ -n "${1:-}" ] || return 1
  case " ${PLUGIN_PENDING_INSTALL} " in *" ${1} "*) return 0 ;; *) return 1 ;; esac
}
