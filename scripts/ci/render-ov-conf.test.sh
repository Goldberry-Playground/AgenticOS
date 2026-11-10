#!/usr/bin/env bash
# Tests for infra/scripts/render-ov-conf.sh.
#
# Pins the 2026-11-10 regression: every droplet deploy's `git archive | tar x`
# reset openviking-config/ov.conf to the committed placeholder root key, and
# the next openviking recreate came up authenticating the PUBLIC placeholder.
# The render step must (a) write the .env key, (b) be idempotent, (c) refuse
# to leave the placeholder in place, and (d) never print the key.
#
# Runs against a copy of the real committed ov.conf, so a shape change there
# (e.g. root_api_key moving out of `server`) fails here, not on the droplet.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${REPO_ROOT}/infra/scripts/render-ov-conf.sh"
SRC_CONF="${REPO_ROOT}/openviking-config/ov.conf"
PLACEHOLDER="__OPENVIKING_ROOT_API_KEY__"
KEY="ovk_test_0123456789abcdefghijklmnopqrstuvwxyzABCD"
FAILED=0

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; FAILED=1; }

[ -x "${SCRIPT}" ] || { echo "::error::${SCRIPT} is missing or not executable" >&2; exit 1; }
grep -q "${PLACEHOLDER}" "${SRC_CONF}" || { echo "::error::committed ov.conf no longer carries the placeholder; update this test" >&2; exit 1; }

new_case() { # $1 = .env body ; echoes fixture dir
  local d; d="$(mktemp -d)"
  cp "${SRC_CONF}" "${d}/ov.conf"
  printf '%s' "$1" > "${d}/.env"
  echo "${d}"
}
conf_key() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["server"]["root_api_key"])' "$1"; }

echo "render-ov-conf.sh"

# 1. Renders the real key over the placeholder, without echoing it.
d="$(new_case "FOO=bar
OPENVIKING_ROOT_API_KEY=${KEY}
")"
out="$("${SCRIPT}" "${d}/.env" "${d}/ov.conf" 2>&1)"; rc=$?
[ "${rc}" -eq 0 ] && pass "exit 0 with a real key" || fail "exit ${rc} with a real key: ${out}"
[ "$(conf_key "${d}/ov.conf")" = "${KEY}" ] && pass "server.root_api_key set from .env" || fail "root_api_key not rendered"
grep -q "${PLACEHOLDER}" "${d}/ov.conf" && fail "placeholder still present" || pass "placeholder gone"
case "${out}" in *"${KEY}"*) fail "key printed to output" ;; *) pass "key not printed" ;; esac
python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "${d}/ov.conf" && pass "ov.conf still valid JSON" || fail "ov.conf invalid JSON"

# 2. Idempotent: a second run leaves the file byte-identical.
before="$(cksum < "${d}/ov.conf")"
out="$("${SCRIPT}" "${d}/.env" "${d}/ov.conf" 2>&1)"; rc=$?
[ "${rc}" -eq 0 ] && [ "$(cksum < "${d}/ov.conf")" = "${before}" ] && pass "re-run is a no-op" || fail "re-run changed the file or failed (rc=${rc})"
case "${out}" in *"already current"*) pass "re-run reports already current" ;; *) fail "re-run output: ${out}" ;; esac
rm -rf "${d}"

# 3. Last assignment wins when .env repeats the key (shell-sourcing semantics).
d="$(new_case "OPENVIKING_ROOT_API_KEY=ovk_old
OPENVIKING_ROOT_API_KEY=${KEY}
")"
"${SCRIPT}" "${d}/.env" "${d}/ov.conf" >/dev/null 2>&1
[ "$(conf_key "${d}/ov.conf")" = "${KEY}" ] && pass "last duplicate assignment wins" || fail "duplicate handling wrong"
rm -rf "${d}"

# 4/5/6. Refuses (non-zero, ::error::, file untouched) when .env can't supply a real key.
refuse_case() { # $1 = label, $2 = .env body
  local d out rc before
  d="$(new_case "$2")"; before="$(cksum < "${d}/ov.conf")"
  out="$("${SCRIPT}" "${d}/.env" "${d}/ov.conf" 2>&1)"; rc=$?
  if [ "${rc}" -ne 0 ] && [[ "${out}" == *"::error::"* ]] && [ "$(cksum < "${d}/ov.conf")" = "${before}" ]; then
    pass "$1: fails loudly, ov.conf untouched"
  else
    fail "$1: rc=${rc} out=${out}"
  fi
  rm -rf "${d}"
}
refuse_case ".env holds the placeholder" "OPENVIKING_ROOT_API_KEY=${PLACEHOLDER}
"
refuse_case ".env lacks the key" "FOO=bar
"
refuse_case ".env key is empty" "OPENVIKING_ROOT_API_KEY=
"

[ "${FAILED}" -eq 0 ] && echo "all render-ov-conf tests passed" || { echo "render-ov-conf tests FAILED" >&2; exit 1; }
