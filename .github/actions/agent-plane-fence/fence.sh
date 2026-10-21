#!/usr/bin/env bash
# agent-plane-fence — admit or revoke THIS runner's public /32 on tcp/22 of the
# CI-owned DigitalOcean cloud firewall attached to the agent-plane droplet
# (GOL-3412).
#
# Since 2026-10-15 `grove-agent-plane-fw` (odoocker agent-plane-fw.tf, GOL-2569 /
# GOL-3392) fences the droplet's public :22 to admin_ip_cidrs. GitHub-hosted
# runners egress from ~7,000 rotating Azure CIDRs, so a static allow-list is
# impossible and every workflow that SSHes in from a runner timed out in
# `Configure SSH`. DO unions all firewalls attached to a droplet, so a SECOND,
# CI-owned firewall (`grove-agent-plane-ci-fw`) carrying one ephemeral /32 per
# job admits the runner without touching the Terraform-managed fence: no drift
# on `grove-agent-plane-fw`, and anything left behind by a killed runner is
# confined to a firewall whose name says who owns it.
#
#   fence.sh admit   -> add <runner ip>/32 on tcp/22, wait until live, export
#                       AGENT_PLANE_CI_FW_ID + AGENT_PLANE_CI_RUNNER_CIDR via
#                       $GITHUB_ENV for the revoke step.
#   fence.sh revoke  -> remove exactly that rule (reads the two env vars).
#
# Env:  DO_TOKEN (required, caller masks it)   HOST (optional: probe :22 after admit)
#       DROPLET_NAME (default agenticos-droplet) FW_NAME (default grove-agent-plane-ci-fw)
#       RUNNER_CIDR (optional override — tests use a TEST-NET address)
set -euo pipefail

MODE="${1:?usage: fence.sh admit|revoke}"
: "${DO_TOKEN:?DO_TOKEN is required}"
DROPLET_NAME="${DROPLET_NAME:-agenticos-droplet}"
FW_NAME="${FW_NAME:-grove-agent-plane-ci-fw}"
API="https://api.digitalocean.com/v2"
GITHUB_ENV="${GITHUB_ENV:-/dev/null}"

# do_api METHOD PATH [JSON] -> prints the body; non-2xx is a failure with the
# status + body on stderr (the token is never echoed).
do_api() {
  local method="$1" path="$2" body="${3:-}" out code
  out="$(curl -sS --max-time 30 -X "$method" \
          -H "Authorization: Bearer ${DO_TOKEN}" -H 'Content-Type: application/json' \
          ${body:+--data "$body"} -w $'\n%{http_code}' "${API}${path}")"
  code="${out##*$'\n'}"
  out="${out%$'\n'*}"
  if [ "$code" -ge 300 ] 2>/dev/null; then
    echo "DO API ${method} ${path} -> HTTP ${code}: ${out}" >&2
    return 1
  fi
  printf '%s' "$out"
}

rule_json() { # CIDR -> the one inbound rule we add/remove
  jq -cn --arg cidr "$1" \
    '{inbound_rules: [{protocol: "tcp", ports: "22", sources: {addresses: [$cidr]}}]}'
}

find_firewall_id() {
  do_api GET "/firewalls?per_page=200" \
    | jq -r --arg n "$FW_NAME" '.firewalls[] | select(.name == $n) | .id' | head -n1
}

runner_cidr() {
  if [ -n "${RUNNER_CIDR:-}" ]; then printf '%s' "$RUNNER_CIDR"; return 0; fi
  local url ip
  for url in https://api.ipify.org https://checkip.amazonaws.com https://ifconfig.me/ip; do
    ip="$(curl -4 -sS --max-time 10 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then printf '%s/32' "$ip"; return 0; fi
  done
  echo "::error title=agent-plane-fence::could not determine this runner's public IPv4" >&2
  return 1
}

wait_firewall_settled() { # ID — DO applies rule changes async; status flips waiting -> succeeded
  local id="$1" i status
  for i in $(seq 1 20); do
    status="$(do_api GET "/firewalls/${id}" | jq -r '.firewall.status')"
    case "$status" in
      succeeded) return 0 ;;
      failed) echo "::error title=agent-plane-fence::firewall ${id} reports status=failed" >&2; return 1 ;;
    esac
    sleep 3
  done
  echo "::warning title=agent-plane-fence::firewall ${id} still '${status}' after 60s; continuing" >&2
}

admit() {
  local cidr fw_id droplet_id attached n
  cidr="$(runner_cidr)"
  droplet_id="$(do_api GET "/droplets?name=${DROPLET_NAME}&per_page=5" \
                 | jq -r --arg n "$DROPLET_NAME" '.droplets[] | select(.name == $n) | .id' | head -n1)"
  if [ -z "$droplet_id" ]; then
    echo "::error title=agent-plane-fence::no droplet named '${DROPLET_NAME}' on this account" >&2
    return 1
  fi

  fw_id="$(find_firewall_id)"
  if [ -z "$fw_id" ]; then
    # First run (or the firewall was deleted): create it attached to the droplet
    # with NO inbound rules — the union with grove-agent-plane-fw is unchanged —
    # and the same wide-open outbound the main fence carries, so this firewall
    # can never be the one that blocks egress. odoocker Terraform imports it
    # afterwards (GOL-3412 follow-up) with ignore_changes on inbound_rule.
    echo "Creating ${FW_NAME} attached to ${DROPLET_NAME} (${droplet_id})."
    fw_id="$(do_api POST "/firewalls" "$(jq -cn --arg n "$FW_NAME" --argjson d "$droplet_id" '{
        name: $n, droplet_ids: [$d], inbound_rules: [],
        outbound_rules: [
          {protocol: "tcp",  ports: "1-65535", destinations: {addresses: ["0.0.0.0/0", "::/0"]}},
          {protocol: "udp",  ports: "1-65535", destinations: {addresses: ["0.0.0.0/0", "::/0"]}},
          {protocol: "icmp",                   destinations: {addresses: ["0.0.0.0/0", "::/0"]}}
        ]}')" | jq -r '.firewall.id')"
    [ -n "$fw_id" ] && [ "$fw_id" != null ] || { echo "::error title=agent-plane-fence::create returned no id" >&2; return 1; }
  else
    attached="$(do_api GET "/firewalls/${fw_id}" | jq -r --argjson d "$droplet_id" '.firewall.droplet_ids | index($d) != null')"
    if [ "$attached" != true ]; then
      echo "Re-attaching ${FW_NAME} to ${DROPLET_NAME} (${droplet_id})."
      do_api POST "/firewalls/${fw_id}/droplets" "$(jq -cn --argjson d "$droplet_id" '{droplet_ids: [$d]}')" >/dev/null
    fi
  fi

  # Leak canary: every job removes its own /32 in an always() step, so rules
  # accumulate only when runners die mid-job. Loud, not fatal.
  n="$(do_api GET "/firewalls/${fw_id}" | jq '.firewall.inbound_rules | length')"
  if [ "${n:-0}" -ge 5 ]; then
    echo "::warning title=agent-plane-fence::${FW_NAME} already carries ${n} inbound rules — stray /32s from killed runners; prune in the DO console or via the API."
  fi

  echo "Admitting ${cidr} on tcp/22 via ${FW_NAME} (${fw_id})."
  do_api POST "/firewalls/${fw_id}/rules" "$(rule_json "$cidr")" >/dev/null
  wait_firewall_settled "$fw_id"

  {
    echo "AGENT_PLANE_CI_FW_ID=${fw_id}"
    echo "AGENT_PLANE_CI_RUNNER_CIDR=${cidr}"
  } >> "$GITHUB_ENV"

  if [ -n "${HOST:-}" ]; then
    local i
    for i in $(seq 1 10); do
      if timeout 3 bash -c "exec 3<>/dev/tcp/${HOST}/22" 2>/dev/null; then
        echo "tcp/22 on ${HOST} reachable from this runner (probe ${i}/10)."
        return 0
      fi
      sleep 3
    done
    echo "::warning title=agent-plane-fence::tcp/22 on ${HOST} not yet reachable after 30s; the keyscan retries will keep trying."
  fi
}

revoke() {
  local fw_id="${AGENT_PLANE_CI_FW_ID:-}" cidr="${AGENT_PLANE_CI_RUNNER_CIDR:-}" i still
  if [ -z "$fw_id" ] || [ -z "$cidr" ]; then
    echo "No admission recorded in this job (AGENT_PLANE_CI_* unset) — nothing to revoke."
    return 0
  fi
  echo "Revoking ${cidr} from ${FW_NAME} (${fw_id})."
  for i in 1 2 3; do
    if do_api DELETE "/firewalls/${fw_id}/rules" "$(rule_json "$cidr")" >/dev/null; then
      still="$(do_api GET "/firewalls/${fw_id}" | jq -r --arg c "$cidr" '[.firewall.inbound_rules[]?.sources.addresses[]? | select(. == $c)] | length')"
      if [ "${still:-0}" -eq 0 ]; then
        echo "Revoked."
        return 0
      fi
      echo "rule for ${cidr} still listed after delete (attempt ${i}/3)" >&2
    fi
    sleep $(( i * 5 ))
  done
  echo "::error title=agent-plane-fence::could not remove ${cidr} from ${FW_NAME} (${fw_id}) — remove it by hand (DO console → Networking → Firewalls)." >&2
  return 1
}

case "$MODE" in
  admit)  admit ;;
  revoke) revoke ;;
  *) echo "usage: fence.sh admit|revoke" >&2; exit 2 ;;
esac
