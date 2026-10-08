#!/usr/bin/env bash
# AgenticOS host wrapper for the merge-queue arming sweep (GOL-3125).
#
# WHY THIS RUNS ON THE HOST AND NOT IN GITHUB ACTIONS
#
# GOL-3118 measured that auto-merge inherits the identity of whoever ARMED it,
# so arming an agent PR as the App makes every subsequent merge-queue enqueue
# healthy. It shipped the tool (vendor/merge-queue-arm-automerge.sh) but nothing
# called it: an agent PR was armed only if an agent remembered. A forgotten PR
# builds a merge group that no `merge_group` workflow runs on, and because the
# queue is sequential that dead entry stalls every healthy entry behind it for
# the full eviction timeout. The cost of one forgotten PR is the whole queue.
#
# This cannot be a GitHub Actions workflow. A workflow has only the default
# `GITHUB_TOKEN`, and arming as `github-actions` rebuilds the identical dead
# group — that is the bug, not a workaround for it. Minting a non-GITHUB_TOKEN
# identity inside Actions would need the App private key in Actions secrets,
# which ADR-0001 declines. So the arming identity has to come from OUTSIDE
# Actions, and `gh-token-broker` already runs on this box: the sweep mints a
# short-lived, repo-scoped App installation token per run. No new secret
# anywhere.
#
# WHAT IT DOES
#
# Sweeps every target repo with ARM_UNAPPROVED=1 and, always, ARM_PROTECTED=0.
# Per grove-sites #993, ARM_UNAPPROVED=1 skips unapproved protected-path PRs by
# evaluating each TARGET repo's own base-branch protected-paths carve-out, so it
# carries no board decision. ARM_PROTECTED=1 does carry one — it would turn a
# human reviewer's approval into the merge itself — so this wrapper REFUSES to
# run if anything tries to set it (see hard_guard below). All the other
# guardrails (drafts, non-agent authors, already-armed, already-queued,
# conflicting, fail-closed carve-out lookups) live in the vendored sweep.
#
# The sweep is idempotent: it skips PRs already armed by the App, so a tick on a
# quiet queue is a no-op costing one broker mint + one GraphQL read per repo.
#
# BROKER REACHABILITY (the one host-specific wrinkle)
#
# `gh-token-broker` deliberately publishes NO ports (security review 2026-07-12,
# M3), so the compose-internal name `gh-token-broker:9099` does not resolve from
# the host network namespace and there is no loopback port to hit. Rather than
# publish the broker — undoing a documented security property for a timer — this
# resolves the container's current IP with `docker inspect` on every run.
# Container IPs change on recreate, which is exactly why it is resolved per run
# and never cached.
#
#   Default (arms):   infra/scripts/merge-queue-arm-sweep.sh
#   Preview only:     infra/scripts/merge-queue-arm-sweep.sh --dry-run
#   One repo:         TARGET_REPOS=Goldberry-Playground/grove-sites ... --dry-run
#
# Env:
#   TARGET_REPOS          space-separated owner/name list (default: the three)
#   REPO_DIR              host clone              (default /opt/agenticos/repo)
#   ENV_FILE              Discord webhook source  (default /opt/agenticos/.env)
#   BROKER_KEY_FILE       broker client bearer    (default /opt/agenticos/secrets/gh-broker-client.key)
#   GH_TOKEN_BROKER_URL   skip docker-inspect resolution and use this URL
#   SWEEP                 path to the vendored sweep
#   CANONICAL_SHA256      expected sha256 of the vendored sweep (drift pin)
#   SKIP_DRIFT_CHECK      1 = skip the cross-repo vendor drift compare
#   DRIFT_STATE_FILE      last-alerted drift state (default /var/lib/agenticos/merge-queue-arm/drift.state)
#   DRIFT_REALERT_SECONDS re-alert interval for unresolved drift; 0 = never (default 86400)
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/agenticos/repo}"
ENV_FILE="${ENV_FILE:-/opt/agenticos/.env}"
BROKER_KEY_FILE="${BROKER_KEY_FILE:-/opt/agenticos/secrets/gh-broker-client.key}"
SWEEP="${SWEEP:-${REPO_DIR}/infra/scripts/vendored/merge-queue-arm-automerge.sh}"
TARGET_REPOS="${TARGET_REPOS:-Goldberry-Playground/grove-sites Goldberry-Playground/odoocker-goldberrygrove Goldberry-Playground/AgenticOS}"
BROKER_CONTAINER="${BROKER_CONTAINER:-gh-token-broker}"
SKIP_DRIFT_CHECK="${SKIP_DRIFT_CHECK:-0}"

# Pin: sha256 of grove-sites scripts/ci/merge-queue-arm-automerge.sh at the
# commit vendor/README.md records. Advisory only — see drift_check().
CANONICAL_SHA256="${CANONICAL_SHA256:-66c23d2e4db717a123782baa0469435d2263d30d172a8da67f621447c69afbf1}"
CANONICAL_REPO="${CANONICAL_REPO:-Goldberry-Playground/grove-sites}"
CANONICAL_PATH="${CANONICAL_PATH:-scripts/ci/merge-queue-arm-automerge.sh}"

HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo agenticos-droplet)"
log() { printf '[%s] merge-queue-arm-sweep: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }

post_discord() { # $1 = message. Degrades to a log line when the webhook is unset.
  local url=""
  if [ -r "${ENV_FILE}" ]; then
    url="$(grep -E '^DISCORD_OPS_WEBHOOK_URL=' "${ENV_FILE}" | cut -d= -f2- || true)"
  fi
  if [ -z "${url}" ]; then
    log "DISCORD_OPS_WEBHOOK_URL unset/unreadable — skipping webhook" >&2
    return 0
  fi
  curl -fsS -m 15 -H 'Content-Type: application/json' \
    -d "$(jq -n --arg c "$1" '{content:$c}')" "${url}" >/dev/null 2>&1 \
    && log "posted to Discord ops webhook" \
    || log "WARN webhook post failed" >&2
}

# --- the one non-negotiable guardrail -------------------------------------
# ARM_PROTECTED=1 is the board-gated override: it would pre-arm an UNAPPROVED
# protected-path PR, so the human review that `auto-approve.yml` withholds for
# would *be* the merge. Refusing loudly beats silently dropping it, because a
# silent drop reads as "the override works" to whoever set it.
hard_guard() {
  if [ "${ARM_PROTECTED:-0}" != "0" ]; then
    log "FATAL: ARM_PROTECTED=${ARM_PROTECTED} is set. This timer must never pre-arm an"
    log "       unapproved protected-path PR — that needs an explicit board decision, not a"
    log "       cron job. Unset it, or run the sweep by hand with the board's sign-off."
    exit 2
  fi
}
hard_guard

APPLY_ARG="--apply"
MODE="apply"
if [ "${1:-}" = "--dry-run" ]; then APPLY_ARG=""; MODE="dry-run"; fi

[ -x "${SWEEP}" ] || { log "FATAL: sweep not executable at ${SWEEP}"; exit 1; }
[ -r "${BROKER_KEY_FILE}" ] || { log "FATAL: broker client key not readable at ${BROKER_KEY_FILE}"; exit 1; }

# --- broker URL -----------------------------------------------------------
resolve_broker_url() {
  if [ -n "${GH_TOKEN_BROKER_URL:-}" ]; then
    printf '%s' "${GH_TOKEN_BROKER_URL}"; return 0
  fi
  local ip
  ip="$(docker inspect "${BROKER_CONTAINER}" 2>/dev/null \
        | jq -r '.[0].NetworkSettings.Networks | to_entries[0].value.IPAddress // empty' 2>/dev/null || true)"
  [ -n "${ip}" ] || return 1
  printf 'http://%s:9099' "${ip}"
}

BROKER_URL="$(resolve_broker_url || true)"
if [ -z "${BROKER_URL}" ]; then
  log "FATAL: could not resolve the ${BROKER_CONTAINER} container IP (is it running?)"
  post_discord ":rotating_light: **${HOSTNAME_SHORT}** merge-queue arm sweep could not reach \`${BROKER_CONTAINER}\` — agent PRs are NOT being armed, so a forgotten PR can wedge the merge queue. Check \`docker ps\` / \`docker compose up -d ${BROKER_CONTAINER}\`."
  exit 1
fi
if ! curl -fsS -m 10 "${BROKER_URL}/health" >/dev/null 2>&1; then
  log "FATAL: broker at ${BROKER_URL} is not answering /health"
  post_discord ":rotating_light: **${HOSTNAME_SHORT}** merge-queue arm sweep: \`${BROKER_CONTAINER}\` resolved to \`${BROKER_URL}\` but \`/health\` failed — agent PRs are NOT being armed."
  exit 1
fi
log "mode=${MODE} broker=${BROKER_URL} repos=${TARGET_REPOS}"

# --- vendor drift check (advisory; never blocks the sweep) -----------------
# Deliberately non-fatal. A stale vendored copy still arms PRs with all its
# guardrails intact; a check that could stop the timer would reintroduce exactly
# the "nothing arms the PR unless a human remembers" failure this ticket deletes.
#
# Alerts on TRANSITIONS, not ticks (GOL-3226). The first version posted the same
# drift warning on every 5-minute tick (~288/day) from the moment grove-sites
# changed the canonical script until AgenticOS re-vendored it, which trains
# everyone to mute the channel. Each tick now reduces to one key:
#
#   sync             vendored copy == pin == grove-sites@main
#   drift:<remote>   pin intact, grove-sites@main moved to <remote>
#   edited:<local>   vendored copy no longer matches its own pin
#
# and Discord hears only when the key changes: entering drift, a NEW remote sha
# while still drifted, an in-place edit, and one all-clear back to sync. A key
# that stays bad re-alerts every DRIFT_REALERT_SECONDS (default 24h) so it can't
# be forgotten. The journal still gets a line every tick. A tick that cannot
# read grove-sites says nothing about drift, so it leaves the state untouched.
#
# --dry-run reads the state but never writes it or posts: the installer's
# self-check runs it as `deploy`, which can't write the root-owned state dir,
# and a preview that alerted would double-post the next real tick's transition.
# If the state file can't be written on a real tick, dedupe degrades to the old
# per-tick alerting — loud, never silent.
DRIFT_STATE_FILE="${DRIFT_STATE_FILE:-/var/lib/agenticos/merge-queue-arm/drift.state}"
DRIFT_REALERT_SECONDS="${DRIFT_REALERT_SECONDS:-86400}"

drift_state_get() { # $1 = field
  [ -r "${DRIFT_STATE_FILE}" ] || return 0
  grep -E "^$1=" "${DRIFT_STATE_FILE}" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

drift_state_put() { # $1 = key, $2 = last-alert epoch
  local dir tmp
  dir="$(dirname "${DRIFT_STATE_FILE}")"
  if mkdir -p "${dir}" 2>/dev/null && tmp="$(mktemp "${dir}/.drift.state.XXXXXX" 2>/dev/null)" \
     && printf 'key=%s\nalerted=%s\n' "$1" "$2" >"${tmp}" && mv -f "${tmp}" "${DRIFT_STATE_FILE}"; then
    return 0
  fi
  [ -n "${tmp:-}" ] && rm -f "${tmp}"
  log "WARN drift check: could not write ${DRIFT_STATE_FILE}; drift alerts will repeat every tick until it is writable" >&2
}

# $1 = new key, $2 = alert text for a bad key. Posts only on a change of key (or
# the re-alert interval), then records what was posted.
drift_transition() {
  local key="$1" msg="$2" prev alerted now
  prev="$(drift_state_get key)"; alerted="$(drift_state_get alerted)"
  now="${DRIFT_NOW:-$(date +%s)}"
  case "${alerted}" in ''|*[!0-9]*) alerted=0 ;; esac

  if [ "${key}" = "${prev}" ]; then
    if [ "${key}" != sync ] && [ "${DRIFT_REALERT_SECONDS}" -gt 0 ] \
       && [ $(( now - alerted )) -ge "${DRIFT_REALERT_SECONDS}" ]; then
      [ "${MODE}" = apply ] || { log "dry-run: would re-alert (${key} unchanged for $(( now - alerted ))s)"; return 0; }
      post_discord "${msg} _(still unresolved — reminder every $(( DRIFT_REALERT_SECONDS / 3600 ))h)_"
      drift_state_put "${key}" "${now}"
    fi
    return 0
  fi

  [ "${MODE}" = apply ] || { log "dry-run: state ${prev:-none} -> ${key} (not recorded, not posted)"; return 0; }
  if [ "${key}" = sync ]; then
    # Only an all-clear for something we actually alerted on; a fresh install
    # that starts in sync records the baseline silently.
    case "${prev}" in
      drift:*|edited:*)
        post_discord ":white_check_mark: **${HOSTNAME_SHORT}** vendored \`merge-queue-arm-automerge.sh\` is back in sync with \`${CANONICAL_REPO}@main\` — the arm-sweep timer runs the current logic again." ;;
    esac
    drift_state_put sync "${now}"
  else
    post_discord "${msg}"
    drift_state_put "${key}" "${now}"
  fi
}

drift_check() {
  [ "${SKIP_DRIFT_CHECK}" = "1" ] && return 0
  local local_sha owner name tok remote_sha tmp
  local_sha="$(sha256sum "${SWEEP}" | cut -d' ' -f1)"
  if [ "${local_sha}" != "${CANONICAL_SHA256}" ]; then
    log "WARN vendored sweep sha256 ${local_sha:0:12} != pinned ${CANONICAL_SHA256:0:12} — it was edited in place"
    drift_transition "edited:${local_sha}" ":warning: **${HOSTNAME_SHORT}** vendored \`merge-queue-arm-automerge.sh\` no longer matches its pin in \`infra/scripts/merge-queue-arm-sweep.sh\` — someone edited the vendored copy in place. Re-vendor from ${CANONICAL_REPO} and bump \`CANONICAL_SHA256\`."
    return 0
  fi
  owner="${CANONICAL_REPO%%/*}"; name="${CANONICAL_REPO##*/}"
  tok="$(curl -fsS -m 20 -H "Authorization: Bearer $(cat "${BROKER_KEY_FILE}")" \
        "${BROKER_URL}/token?owner=${owner}&repo=${name}" 2>/dev/null \
        | jq -r '.token // empty' || true)"
  [ -n "${tok}" ] || { log "WARN drift check: could not mint a ${CANONICAL_REPO} token; skipping"; return 0; }
  tmp="$(mktemp)"
  if ! curl -fsS -m 20 -H "Authorization: Bearer ${tok}" -H 'Accept: application/vnd.github.raw' \
       "https://api.github.com/repos/${owner}/${name}/contents/${CANONICAL_PATH}?ref=main" -o "${tmp}" \
     || [ ! -s "${tmp}" ]; then
    log "WARN drift check: could not fetch ${CANONICAL_REPO}@main:${CANONICAL_PATH}; skipping"
    rm -f "${tmp}"; return 0
  fi
  remote_sha="$(sha256sum "${tmp}" | cut -d' ' -f1)"; rm -f "${tmp}"
  if [ "${remote_sha}" != "${local_sha}" ]; then
    log "WARN vendor drift: ${CANONICAL_REPO}@main is ${remote_sha:0:12}, vendored copy is ${local_sha:0:12}"
    drift_transition "drift:${remote_sha}" ":warning: **${HOSTNAME_SHORT}** vendor drift: \`${CANONICAL_REPO}@main:${CANONICAL_PATH}\` is now \`${remote_sha:0:12}\` but AgenticOS vendors \`${local_sha:0:12}\`. The arm-sweep timer is running the OLD logic. Re-vendor into \`infra/scripts/vendored/\` and bump \`CANONICAL_SHA256\` (GOL-3125)."
  else
    log "vendor in sync with ${CANONICAL_REPO}@main (${local_sha:0:12})"
    drift_transition sync ""
  fi
}
drift_check

# --- the sweep ------------------------------------------------------------
armed_total=0
failed_repos=()
for repo in ${TARGET_REPOS}; do
  log "--- ${repo}"
  out=""
  if out="$(cd "${REPO_DIR}" && \
      REPO="${repo}" \
      GH_TOKEN_BROKER_URL="${BROKER_URL}" \
      GH_BROKER_API_KEY_FILE="${BROKER_KEY_FILE}" \
      ARM_UNAPPROVED=1 \
      ARM_PROTECTED=0 \
      "${SWEEP}" ${APPLY_ARG} 2>&1)"; then
    :
  else
    failed_repos+=("${repo}")
  fi
  printf '%s\n' "${out}" | sed 's/^/    /'
  n="$(printf '%s\n' "${out}" | grep -c '^[0-9:]*Z armed #' || true)"
  armed_total=$(( armed_total + n ))
done

log "done: mode=${MODE} armed=${armed_total} failed_repos=${#failed_repos[@]}"

if [ "${#failed_repos[@]}" -gt 0 ]; then
  post_discord ":warning: **${HOSTNAME_SHORT}** merge-queue arm sweep had failures in: ${failed_repos[*]} — see \`/var/log/agenticos/merge-queue-arm.log\`. Unarmed agent PRs can wedge the sequential merge queue (GOL-3125)."
  exit 1
fi
exit 0
