#!/usr/bin/env bash
# Tests for infra/scripts/vendor-status-guard.py (GOL-3021).
#
# The guard's whole value is that it alerts on the EDGE — one message when a
# vendor degrades, one when it recovers, and silence in between. That rule is
# invisible in a single live run and impossible to exercise against a real
# vendor whose status we do not control, so it is pinned here offline through
# the VENDOR_STATUS_FIXTURES seam (see the seam's comment in the guard).
#
# Everything here is hermetic: no network, no webhook (ENV_FILE=/dev/null and
# DISCORD_OPS_WEBHOOK_URL unset ⇒ the post is skipped), temp state + snapshot.
#
# Run:  bash infra/scripts/vendor-status-guard.test.sh
# CI gates it via scripts/ci/vendor-status-guard.test.sh.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="${REPO_ROOT}/infra/scripts/vendor-status-guard.py"
FAILED=0
PASSES=0

pass() { PASSES=$((PASSES + 1)); echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; FAILED=1; }

# --- fixture builders -------------------------------------------------------
# Statuspage URLs -> fixture filenames, matching the guard's sanitiser
# (non-alphanumeric runs collapse to "_").
fx_name() { printf '%s' "$1" | sed 's/[^A-Za-z0-9][^A-Za-z0-9]*/_/g'; }

# write_components <fixture-dir> <statuspage-base> <name=status> ...
write_components() {
  local dir="$1" base="$2"; shift 2
  local url="${base}/api/v2/components.json"
  {
    printf '{"page":{"name":"fx"},"components":['
    local first=1 kv n s
    for kv in "$@"; do
      n="${kv%%=*}"; s="${kv##*=}"
      [ "${first}" -eq 1 ] || printf ','
      first=0
      printf '{"id":"%s","name":"%s","status":"%s","group":false,"updated_at":"2026-10-05T19:11:58Z"}' \
        "$(fx_name "${n}")" "${n}" "${s}"
    done
    printf ']}'
  } >"${dir}/$(fx_name "${url}").json"
}

# write_incidents <fixture-dir> <statuspage-base> [<component-name> <title>]
write_incidents() {
  local dir="$1" base="$2" comp="${3:-}" title="${4:-}"
  local url="${base}/api/v2/incidents/unresolved.json"
  if [ -z "${comp}" ]; then
    printf '{"incidents":[]}' >"${dir}/$(fx_name "${url}").json"
  else
    printf '{"incidents":[{"id":"inc1","name":"%s","impact":"minor","status":"investigating","created_at":"2026-10-05T19:11:58Z","shortlink":"https://stspg.io/x","components":[{"name":"%s","status":"degraded_performance"}]}]}' \
      "${title}" "${comp}" >"${dir}/$(fx_name "${url}").json"
  fi
}

GH_BASE="https://www.githubstatus.com"

# A fixture dir where GitHub is the only vendor polled. Callers pass the
# component statuses they want; everything else is filled in healthy.
new_github_fixture() { # $@ = name=status pairs
  local dir; dir="$(mktemp -d)"
  write_components "${dir}" "${GH_BASE}" "$@"
  write_incidents "${dir}" "${GH_BASE}"
  echo "${dir}"
}

# run_poll <fixture-dir> <state> <snapshot> [extra args...]
run_poll() {
  local fx="$1" state="$2" snap="$3"; shift 3
  env -u DISCORD_OPS_WEBHOOK_URL \
      VENDOR_STATUS_FIXTURES="${fx}" ENV_FILE=/dev/null \
      python3 "${GUARD}" poll --state "${state}" --snapshot "${snap}" "$@" 2>&1
}

# transitions_in <poll output> -> the integer the guard reports
transitions_in() { sed -n 's/^vendor-status: \([0-9]*\) transition(s).*/\1/p' <<<"$1"; }

jqp() { python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2],{},{'d':d}))" "$1" "$2"; }

echo "vendor-status-guard: allowlist + classification"
# ---------------------------------------------------------------------------
# A degraded component we do NOT depend on must be invisible. This is the whole
# reason the allowlist exists: Cloudflare ships 479 components and is routinely
# degraded on a dozen we never touch.
fx="$(new_github_fixture "Actions=operational" "API Requests=operational" \
      "Git Operations=operational" "Pull Requests=operational" \
      "Webhooks=operational" "Issues=operational" "Copilot=major_outage")"
st="$(mktemp -u)"; sn="$(mktemp -u)"
out="$(run_poll "${fx}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "0" ] \
  && pass "a major_outage on a NON-allowlisted component (Copilot) raises nothing" \
  || fail "non-allowlisted component leaked into alerts: ${out}"
[ "$(jqp "${sn}" "d['overall']")" = "ok" ] \
  && pass "overall stays ok when only non-allowlisted components are down" \
  || fail "overall was $(jqp "${sn}" "d['overall']")"

# Each statuspage status maps to the class we expect.
for pair in "degraded_performance degraded" "partial_outage degraded" \
            "major_outage down" "under_maintenance maintenance" "operational ok"; do
  set -- ${pair}
  fx="$(new_github_fixture "Actions=$1" "API Requests=operational" "Git Operations=operational" \
        "Pull Requests=operational" "Webhooks=operational" "Issues=operational")"
  st="$(mktemp -u)"; sn="$(mktemp -u)"
  run_poll "${fx}" "${st}" "${sn}" --vendor github >/dev/null
  got="$(jqp "${sn}" "[c['class'] for c in d['vendors']['github']['components'] if c['name']=='Actions'][0]")"
  [ "${got}" = "$2" ] && pass "$1 -> ${2}" || fail "$1 -> ${got}, expected $2"
done

# under_maintenance is recorded but must never page: planned work is not an
# incident, and DO/Cloudflare schedule it constantly.
fx="$(new_github_fixture "Actions=under_maintenance" "API Requests=operational" \
      "Git Operations=operational" "Pull Requests=operational" "Webhooks=operational" "Issues=operational")"
st="$(mktemp -u)"; sn="$(mktemp -u)"
out="$(run_poll "${fx}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "0" ] \
  && pass "under_maintenance does not page" || fail "maintenance paged: ${out}"

# An allowlisted name that vanished upstream must surface as unknown, not be
# silently dropped — otherwise a vendor rename rots the allowlist into a no-op.
fx="$(new_github_fixture "API Requests=operational" "Git Operations=operational" \
      "Pull Requests=operational" "Webhooks=operational" "Issues=operational")"
st="$(mktemp -u)"; sn="$(mktemp -u)"
run_poll "${fx}" "${st}" "${sn}" --vendor github >/dev/null
got="$(jqp "${sn}" "[c['class'] for c in d['vendors']['github']['components'] if c['name']=='Actions'][0]")"
[ "${got}" = "unknown" ] \
  && pass "an allowlisted component missing upstream reports unknown (stale allowlist is loud)" \
  || fail "missing component reported '${got}', expected unknown"

echo
echo "vendor-status-guard: edge-only alerting (the acceptance criterion)"
# ---------------------------------------------------------------------------
BAD_FX="$(new_github_fixture "Actions=degraded_performance" "API Requests=operational" \
          "Git Operations=operational" "Pull Requests=operational" "Webhooks=operational" "Issues=operational")"
write_incidents "${BAD_FX}" "${GH_BASE}" "Actions" "Incident with Actions"
OK_FX="$(new_github_fixture "Actions=operational" "API Requests=operational" \
         "Git Operations=operational" "Pull Requests=operational" "Webhooks=operational" "Issues=operational")"
DOWN_FX="$(new_github_fixture "Actions=major_outage" "API Requests=operational" \
           "Git Operations=operational" "Pull Requests=operational" "Webhooks=operational" "Issues=operational")"

st="$(mktemp -u)"; sn="$(mktemp -u)"
out="$(run_poll "${BAD_FX}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "1" ] \
  && pass "degradation produces exactly ONE transition" || fail "first bad poll: ${out}"
out="$(run_poll "${BAD_FX}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "0" ] \
  && pass "the same degradation on the next poll is silent (dedupe on the edge)" || fail "re-alert: ${out}"
out="$(run_poll "${BAD_FX}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "0" ] && pass "…and silent on the third poll too" || fail "re-alert: ${out}"

out="$(run_poll "${DOWN_FX}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "1" ] \
  && pass "degraded -> down escalates once" || fail "escalation: ${out}"
out="$(run_poll "${DOWN_FX}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "0" ] && pass "…then silent at the new level" || fail "re-alert: ${out}"

out="$(run_poll "${OK_FX}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "1" ] \
  && pass "recovery produces exactly ONE transition" || fail "recovery: ${out}"
out="$(run_poll "${OK_FX}" "${st}" "${sn}" --vendor github)"
[ "$(transitions_in "${out}")" = "0" ] \
  && pass "…and a healthy vendor never speaks again" || fail "re-alert after recovery: ${out}"

# A first run with no state must alert for anything already bad — nobody has
# been told yet, so silence there would be a missed incident, not dedupe.
st2="$(mktemp -u)"; sn2="$(mktemp -u)"
out="$(run_poll "${BAD_FX}" "${st2}" "${sn2}" --vendor github)"
[ "$(transitions_in "${out}")" = "1" ] \
  && pass "a cold start alerts for an already-degraded vendor" || fail "cold start: ${out}"

echo
echo "vendor-status-guard: unknown is not an outage"
# ---------------------------------------------------------------------------
# An unreadable vendor means "we can't tell", which is NOT the same as "the
# vendor is down" — one flaky DNS lookup from our own box must not page the
# channel and pin the blame on GitHub. It speaks up once, only once it has
# stopped looking transient.
EMPTY_FX="$(mktemp -d)"   # no fixture files at all ⇒ http_json raises
st="$(mktemp -u)"; sn="$(mktemp -u)"
for i in 1 2; do
  out="$(run_poll "${EMPTY_FX}" "${st}" "${sn}" --vendor github --unknown-streak 3)"
  [ "$(transitions_in "${out}")" = "0" ] \
    && pass "unreadable poll ${i}/3 stays quiet" || fail "unknown paged early on poll ${i}: ${out}"
done
out="$(run_poll "${EMPTY_FX}" "${st}" "${sn}" --vendor github --unknown-streak 3)"
[ "$(transitions_in "${out}")" = "1" ] \
  && pass "a persistent blind spot pages once on the 3rd consecutive failure" || fail "streak: ${out}"
out="$(run_poll "${EMPTY_FX}" "${st}" "${sn}" --vendor github --unknown-streak 3)"
[ "$(transitions_in "${out}")" = "0" ] \
  && pass "…and does not repeat afterwards" || fail "unknown re-alerted: ${out}"
[ "$(jqp "${sn}" "d['overall']")" = "unknown" ] \
  && pass "overall reports unknown, never a fabricated ok" || fail "overall was $(jqp "${sn}" "d['overall']")"

echo
echo "vendor-status-guard: duplicate component names collapse to the WORST"
# ---------------------------------------------------------------------------
# 1Password publishes the same component name once per region. Taking the last
# row wins would let a healthy USA row mask a Europe outage.
fx="$(mktemp -d)"
write_components "${fx}" "https://status.1password.com" \
  "Service Accounts=operational" "Command Line Interface (CLI)=operational" \
  "1Password Connect=operational" "Sign in=operational"
python3 - "${fx}" <<'PY'
import glob, json, sys
# Append a SECOND, degraded "Service Accounts" row (a different region) to the
# components fixture, the way 1Password really serves it.
path = [p for p in glob.glob(sys.argv[1] + "/*.json") if "components" in p][0]
d = json.load(open(path))
d["components"].append({"id": "sa-eu", "name": "Service Accounts",
                        "status": "major_outage", "group": False,
                        "updated_at": "2026-10-05T19:00:00Z"})
json.dump(d, open(path, "w"))
PY
write_incidents "${fx}" "https://status.1password.com"
st="$(mktemp -u)"; sn="$(mktemp -u)"
run_poll "${fx}" "${st}" "${sn}" --vendor 1password >/dev/null
got="$(jqp "${sn}" "[c['class'] for c in d['vendors']['1password']['components'] if c['name']=='Service Accounts'][0]")"
[ "${got}" = "down" ] \
  && pass "operational + major_outage under one name -> down" || fail "collapsed to '${got}', expected down"

echo
echo "vendor-status-guard: Stripe synthetic probe"
# ---------------------------------------------------------------------------
# Stripe publishes no live status API, so it is probed by response code. 401
# from api.stripe.com is HEALTHY: Stripe is up and refused us, which is the
# liveness signal we want with no credential in play.
probe_stripe() { # $1 = api code, $2 = js code -> prints the Stripe severity
  local fx; fx="$(mktemp -d)"
  printf '{"https://api.stripe.com/v1/charges":%s,"https://js.stripe.com/v3/":%s}' "$1" "$2" \
    >"${fx}/codes.json"
  local st sn; st="$(mktemp -u)"; sn="$(mktemp -u)"
  run_poll "${fx}" "${st}" "${sn}" --vendor stripe >/dev/null
  jqp "${sn}" "d['vendors']['stripe']['severity']"
}
[ "$(probe_stripe 401 200)" = "ok" ]       && pass "401 + 200 -> ok (Stripe up, refused us)" || fail "healthy probe: $(probe_stripe 401 200)"
[ "$(probe_stripe 500 200)" = "down" ]     && pass "500 -> down"                             || fail "500 -> $(probe_stripe 500 200)"
[ "$(probe_stripe 200 200)" = "degraded" ] && pass "unexpected-but-serving 200 -> degraded"   || fail "200 -> $(probe_stripe 200 200)"
[ "$(probe_stripe 0 200)" = "unknown" ]    && pass "no response -> unknown, not down"         || fail "0 -> $(probe_stripe 0 200)"

echo
echo "vendor-status-guard: snapshot contract (what agents read)"
# ---------------------------------------------------------------------------
st="$(mktemp -u)"; sn="$(mktemp -u)"
run_poll "${BAD_FX}" "${st}" "${sn}" --vendor github >/dev/null
[ "$(jqp "${sn}" "d['schema']")" = "1" ] && pass "snapshot carries schema 1" || fail "no schema"
[ "$(jqp "${sn}" "d['degraded'][0]['component']")" = "Actions" ] \
  && pass "degraded[] names the component an agent is about to blame itself for" || fail "degraded[] wrong"
[ "$(jqp "${sn}" "d['degraded'][0]['incident']")" = "Incident with Actions" ] \
  && pass "the upstream incident title rides along" || fail "incident title missing"
[ "$(jqp "${sn}" "'github_actions' in d['hints']")" = "True" ] \
  && pass "a degraded Actions ships the CI incident-debris triage rule inline" || fail "hint missing"
[ "$(jqp "${sn}" "'BlobNotFound' in d['hints']['github_actions']")" = "True" ] \
  && pass "…including the BlobNotFound / empty runner_name classifier" || fail "hint content wrong"
[ "$(jqp "${sn}" "'close + reopen' in d['hints']['github_actions']")" = "True" ] \
  && pass "…and the close+reopen re-trigger lever (no actions:write needed)" || fail "re-trigger lever missing"
run_poll "${OK_FX}" "${st}" "${sn}" --vendor github >/dev/null
[ "$(jqp "${sn}" "'github_actions' in d['hints']")" = "False" ] \
  && pass "the hint disappears once Actions is healthy" || fail "hint lingered"

# `read` must answer from a fresh snapshot WITHOUT polling. Proven by running it
# with no fixtures and no network reachability expectation: a re-poll here would
# need the seam and fail.
out="$(env -u DISCORD_OPS_WEBHOOK_URL VENDOR_STATUS_FIXTURES="$(mktemp -d)" \
       python3 "${GUARD}" read --snapshot "${sn}" --max-age 3600 2>&1)"
grep -q 'all watched vendor components operational' <<<"${out}" \
  && pass "read serves a fresh snapshot without re-polling" || fail "read output: ${out}"

echo
echo "vendor-status-guard: no webhook is a degraded mode, not a failure"
# ---------------------------------------------------------------------------
st="$(mktemp -u)"; sn="$(mktemp -u)"
out="$(run_poll "${BAD_FX}" "${st}" "${sn}" --vendor github)"; rc=$?
[ "${rc}" -eq 0 ] && pass "poll exits 0 with no webhook configured" || fail "exit ${rc}"
[ -s "${sn}" ] && pass "…and the snapshot is still written (no alerts ≠ no data)" || fail "snapshot missing"
grep -q 'DISCORD_OPS_WEBHOOK_URL unset' <<<"${out}" \
  && pass "…and it says so out loud" || fail "silent about the missing webhook: ${out}"

# An unknown --vendor is a typo, and a typo must not silently narrow monitoring
# to nothing.
env -u DISCORD_OPS_WEBHOOK_URL python3 "${GUARD}" poll --vendor nope \
  --state "$(mktemp -u)" --snapshot "$(mktemp -u)" >/dev/null 2>&1
[ $? -eq 2 ] && pass "an unknown --vendor exits 2 instead of monitoring nothing" || fail "bad vendor accepted"

echo
if [ "${FAILED}" -eq 0 ]; then
  echo "vendor-status-guard: ${PASSES} checks passed"
else
  echo "vendor-status-guard: FAILURES above (${PASSES} passed)" >&2
fi
exit "${FAILED}"
