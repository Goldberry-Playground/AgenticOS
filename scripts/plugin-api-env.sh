#!/usr/bin/env bash
#
# plugin-api-env.sh — GOL-804 (extracted from finish-plugin-upgrade.sh)
#
# Resolve the two things any on-droplet plugin-API script needs and export them:
#   PAPERCLIP_BASE  — the VPC-bound host origin for paperclip-server:3100,
#                     derived from `docker compose port` (never hard-coded), and
#                     WAITED ON until it actually answers (see below).
#   BOARD_KEY       — the board bearer key, read on the box from 1Password via a
#                     pinned op container using the credential-broker OP service-
#                     account token (GOL-313 pattern; no op CLI on the box, no
#                     GitHub Actions secret — this repo has no CI secrets:write).
#
# Source it (do NOT execute): `source "${HERE}/plugin-api-env.sh"`. Keeping this
# in one place means finish-plugin-upgrade.sh and assert-plugin-versions.sh can
# never disagree on how they reach or authenticate to the board API.
#
# Readiness (GOL-2686)
# --------------------
# `docker compose port` answers from the container's published-port mapping, which
# exists the instant the container is CREATED — seconds before the Node server
# inside it binds :3100 (migrations + plugin activation run first). Any consumer
# that fetches immediately gets a bare connection refusal, and undici renders that
# as the single undebuggable word `fetch failed`.
#
# That is exactly how run 36662917269 went RED on main @dfc09e1: the new GOL-2585
# mount guard force-recreated paperclip-server at 03:07:19, reported "all plugin
# mounts re-resolved" at 03:07:25 (its probe is `docker compose exec test -s`, i.e.
# filesystem-only), and the GOL-804 convergence assert fetched at 03:07:28 — three
# seconds after container start — and died. Nothing had drifted; the box was simply
# still booting. A guard that cannot survive the recreate it sits behind is exactly
# the guard we lose on the runs that need it most.
#
# So: after resolving the origin, poll it until it SERVES, and only then hand it to
# the caller. A never-ready API is still FATAL — this waits for a boot, it does not
# excuse an outage.
#
# Env overrides:
#   COMPOSE_DIR    default /opt/agenticos
#   BROKER_ENV     default $COMPOSE_DIR/secrets/credential-broker.env
#   BOARD_KEY_REF  default op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key
#   OP_IMG         default 1password/op:2
#   PAPERCLIP_BASE preset to skip the docker-compose port derivation
#   API_READY_PATH     default /api/health   unauthenticated liveness path
#   API_READY_TIMEOUT  default 120           seconds to wait for the API to serve
#   API_READY_POLL     default 3             seconds between readiness probes
#                      (API_READY_TIMEOUT=0 skips the wait entirely)

COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
BROKER_ENV="${BROKER_ENV:-${COMPOSE_DIR}/secrets/credential-broker.env}"
BOARD_KEY_REF="${BOARD_KEY_REF:-op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key}"
OP_IMG="${OP_IMG:-1password/op:2}"

command -v docker >/dev/null || { echo "FATAL: docker not found" >&2; exit 1; }
command -v curl   >/dev/null || { echo "FATAL: curl not found" >&2; exit 1; }

# --- API origin: the VPC-bound host port for paperclip-server:3100 ------------
if [ -z "${PAPERCLIP_BASE:-}" ]; then
  hostport="$(cd "$COMPOSE_DIR" && docker compose port paperclip-server 3100 2>/dev/null | tail -n1 || true)"
  [ -n "$hostport" ] || {
    echo "FATAL: could not resolve paperclip-server:3100 host port (is the container up?)" >&2
    exit 1
  }
  PAPERCLIP_BASE="http://${hostport}"
fi

# --- wait until that origin is actually SERVING (GOL-2686) --------------------
# Deliberately unauthenticated (/api/health) so this probes ONLY reachability and
# can never be confused with an auth failure. `curl -o /dev/null -w %{http_code}`
# rather than `-f`: a 5xx from a half-booted server must read as "not ready yet",
# not as a hard error, and 000 (connection refused) must too.
API_READY_PATH="${API_READY_PATH:-/api/health}"
API_READY_TIMEOUT="${API_READY_TIMEOUT:-120}"
API_READY_POLL="${API_READY_POLL:-3}"

if [ "$API_READY_TIMEOUT" -gt 0 ]; then
  ready=0
  code=000
  deadline=$(( $(date +%s) + API_READY_TIMEOUT ))
  attempt=0
  while :; do
    attempt=$(( attempt + 1 ))
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 \
              "${PAPERCLIP_BASE}${API_READY_PATH}" 2>/dev/null || echo 000)"
    case "$code" in
      2*) ready=1; break ;;
    esac
    [ "$(date +%s)" -lt "$deadline" ] || break
    if [ "$attempt" = 1 ]; then
      echo "waiting for ${PAPERCLIP_BASE}${API_READY_PATH} to serve (up to ${API_READY_TIMEOUT}s) — last HTTP ${code}"
    fi
    sleep "$API_READY_POLL"
  done
  if [ "$ready" != 1 ]; then
    echo "FATAL: ${PAPERCLIP_BASE}${API_READY_PATH} did not serve within ${API_READY_TIMEOUT}s (last HTTP ${code}). paperclip-server is not answering — check 'docker compose logs paperclip-server' before retrying." >&2
    exit 1
  fi
  [ "$attempt" = 1 ] || echo "paperclip API ready after ${attempt} probe(s)"
fi

# --- board key from 1Password via the on-box credential-broker OP token -------
[ -f "$BROKER_ENV" ] || {
  echo "FATAL: $BROKER_ENV absent — the credential-broker OP service-account token is not provisioned, so the board key cannot be read. Finish manually per docs/runbooks/deploy-plugin-manifest-change.md" >&2
  exit 1
}
OP_TOKEN="$(grep -E '^OP_SERVICE_ACCOUNT_TOKEN=' "$BROKER_ENV" | head -n1 | cut -d= -f2-)"
OP_TOKEN="${OP_TOKEN%\"}"; OP_TOKEN="${OP_TOKEN#\"}"
OP_TOKEN="${OP_TOKEN%\'}"; OP_TOKEN="${OP_TOKEN#\'}"
[ -n "${OP_TOKEN:-}" ] || { echo "FATAL: OP_SERVICE_ACCOUNT_TOKEN empty in $BROKER_ENV" >&2; exit 1; }
BOARD_KEY="$(docker run --rm --entrypoint op -e OP_SERVICE_ACCOUNT_TOKEN="$OP_TOKEN" "$OP_IMG" read "$BOARD_KEY_REF" 2>/dev/null || true)"
[ -n "$BOARD_KEY" ] || { echo "FATAL: board key did not resolve from 1Password ($BOARD_KEY_REF)" >&2; exit 1; }
export BOARD_KEY PAPERCLIP_BASE
