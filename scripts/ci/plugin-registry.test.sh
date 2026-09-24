#!/usr/bin/env bash
#
# plugin-registry.test.sh — GOL-2423
#
# Offline behavioural test for scripts/plugin-registry.sh, the single source of
# truth for the deploy-managed plugin list. Also parse-checks every consumer, so
# a syntax error in a droplet-only script is caught on the PR instead of at
# 02:00 in a deploy. No op/ssh/api — runs on every PR via the `CI scripts` job.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail=0
ok()   { echo "  ok   $*"; }
bad()  { echo "  FAIL $*" >&2; fail=1; }

# --- parse-check every consumer ---------------------------------------------
for f in scripts/plugin-registry.sh scripts/assert-plugin-versions.sh \
         scripts/finish-plugin-upgrade.sh scripts/deploy-plugin.sh \
         scripts/sync-paperclip-secrets.sh scripts/detect-manifest-bumps.sh; do
  if bash -n "${ROOT}/${f}"; then ok "bash -n ${f}"; else bad "bash -n ${f}"; fi
done

# --- plugin_key reads the DECLARED manifest id, not "agenticos.<dir>" --------
# The whole point: grove-content-drafter-plugin declares
# agenticos.grove-content-drafter. String-concat would assert a key that does
# not exist and turn every deploy RED with "NOT INSTALLED".
# shellcheck source=scripts/plugin-registry.sh
REPO_DIR="${ROOT}" source "${ROOT}/scripts/plugin-registry.sh"

REPO_DIR="${ROOT}"
for p in ${PLUGIN_DIRS}; do
  want="$(grep -oE 'id:[[:space:]]*"agenticos\.[^"]+"' "${ROOT}/packages/${p}/src/manifest.ts" \
          | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  got="$(plugin_key "$p")"
  if [ "$got" = "$want" ]; then ok "plugin_key ${p} -> ${got}"
  else bad "plugin_key ${p} -> '${got}', manifest declares '${want}'"; fi
done

if [ "$(plugin_key grove-content-drafter-plugin)" != "agenticos.grove-content-drafter-plugin" ]; then
  ok "plugin_key does not assume the agenticos.<dir> convention"
else
  bad "plugin_key returned the naive agenticos.<dir> concat for grove-content-drafter-plugin"
fi

# Unreadable manifest -> documented fallback, never an empty key.
if [ "$(REPO_DIR=/nonexistent plugin_key some-plugin)" = "agenticos.some-plugin" ]; then
  ok "plugin_key falls back to agenticos.<dir> when the manifest is unreadable"
else
  bad "plugin_key fallback did not produce agenticos.some-plugin"
fi

# --- predicates are `set -e` safe -------------------------------------------
# A trailing `a && b` whose left side is false exits a `set -e` script; the
# consumers use `if`, and these helpers must return cleanly either way.
( set -euo pipefail
  REPO_DIR="${ROOT}"; source "${ROOT}/scripts/plugin-registry.sh"
  if plugin_is_pending_install vault-plugin; then exit 3; fi
  if plugin_is_valid not-a-plugin; then exit 4; fi
  plugin_is_valid vault-plugin || exit 5
  plugin_is_pending_install grove-content-drafter-plugin || exit 6
) && ok "plugin_is_valid / plugin_is_pending_install are set -e safe and correct" \
  || bad "predicate self-check exited $?"

if [ $fail -eq 0 ]; then echo "plugin-registry.test.sh: PASS"; else echo "plugin-registry.test.sh: FAIL" >&2; fi
exit $fail
