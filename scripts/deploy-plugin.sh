#!/usr/bin/env bash
#
# deploy-plugin.sh — finish a manifest-change deploy for one or more AgenticOS
# plugins. Run from the Mac, exactly like sync-paperclip-secrets.sh:
#   - `op` signed in (`op signin`)
#   - SSH tunnel to Paperclip open:
#       ssh -fNL 3100:10.116.16.2:3100 deploy@<droplet>
# Idempotent: safe to re-run.
#
# Per plugin:
#   0. version-bump guard — src/dist/package.json manifest versions must agree
#      (offline, fail-fast BEFORE any destructive delete; pre-#228 trap)
#   1. recreate-guard — force-recreate paperclip-server ONLY if the plugin dir
#      isn't visible in the container yet (a newly-added bind mount)
#   2. delete + reinstall — refreshes the stored manifest (install won't update)
#   3. id-rotation guard — surface a reinstall-rotated plugin id (extends #506)
#   4. apply config from 1Password + config round-trip guard — github/openviking/
#      discord; vault has none; github-sync is configured via its own runbook
#   5. disable -> enable — forces the worker setup() to re-run with fresh config
#   6. assert — plugin present and not in an error state; live manifest version
#      matches the shipped artifact (proves the reinstall actually refreshed it),
#      and a manifest CONTENT change carried a version bump vs the deployed one
#      (pre-#228 trap in full; GOL-1500 invariant #1)
#
# Lifecycle guardrails (GOL-1429 / GOL-1500) fail the deploy LOUDLY on the traps
# that have bitten us. Prove them offline without op/ssh/api:
#   scripts/deploy-plugin.sh --selftest
#
# Usage: scripts/deploy-plugin.sh <plugin> [<plugin> ...]
#   plugin ∈ vault-plugin | openviking-plugin | github-plugin | github-sync-plugin | discord-plugin
#
# Env: as paperclip-lib.sh, plus:
#   DROPLET_SSH   default "deploy@agenticos-droplet"  (recreate-guard SSH target)
#   COMPOSE_DIR   default "/opt/agenticos"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck source=scripts/paperclip-lib.sh
source "${HERE}/paperclip-lib.sh"

DROPLET_SSH="${DROPLET_SSH:-deploy@agenticos-droplet}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
VALID_PLUGINS="vault-plugin openviking-plugin github-plugin github-sync-plugin discord-plugin"

# --- github-sync inbound webhook id-drift gate (GOL-1394) ---------------------
# A github-sync reinstall ROTATES the plugin id (delete+install is Paperclip's
# only update path). That id is embedded in the inbound webhook URL in THREE
# places that must move together: the CF Access apps (cloudflare-qa-webhook.tf
# var.github_sync_plugin_id), the GitHub App webhook URL, and the install. On
# 2026-08-12 only the install moved → ~20h of silently-severed inbound sync
# (every GitHub delivery 302'd at the CF edge). This gate compares the live
# installed id against the committed TF var and, on mismatch, prints the exact
# operator legs. Default = FAIL (can't be silently ignored); PLUGIN_ID_GATE=warn
# downgrades to a non-fatal warning.
TF_WEBHOOK_FILE="${TF_WEBHOOK_FILE:-${HERE}/../infra/terraform/cloudflare-qa-webhook.tf}"
PLUGIN_ID_GATE="${PLUGIN_ID_GATE:-fail}"   # fail | warn

usage() {
  echo "Usage: $0 <plugin> [<plugin> ...]" >&2
  echo "       $0 --selftest        # inject each guardrail trap, assert it fails (offline)" >&2
  echo "  plugin ∈ ${VALID_PLUGINS}" >&2
  exit 2
}

# =============================================================================
# Lifecycle guardrails (GOL-1429) — PURE comparators.
# Each takes its inputs as args and never touches op/ssh/api, so --selftest can
# inject a trap and prove the deploy fails. The live wrappers below feed them
# values read from local files and the board API.
# =============================================================================

# ver_from_manifest FILE — extract the manifest `version:` string property.
# Anchored to a line starting `version:` so the many `// … version` comment
# lines in manifest.ts don't false-match.
ver_from_manifest() {
  grep -oE '^[[:space:]]*version:[[:space:]]*"[^"]+"' "$1" 2>/dev/null \
    | head -1 | sed -E 's/.*"([^"]+)".*/\1/'
}
ver_from_pkg() { jq -r '.version // ""' "$1" 2>/dev/null; }

# guard_version_consistency PLUGIN SRC DIST PKG — the shipped manifest artifact
# (dist/manifest.js) MUST carry the same version as its source (src/manifest.ts).
# Trap (pre-#228): you edit the manifest but never rebuild dist, so the artifact
# that gets installed carries a stale version and the stored manifest silently
# masks the change. src!=dist (or an unreadable version) FAILS the deploy.
# package.json is npm bookkeeping, not the installed artifact — a lag there is a
# loud WARN (surfaces the oversight) but does not hard-block the deploy.
guard_version_consistency() {
  local p="$1" src="$2" dist="$3" pkg="$4"
  if [ -z "$src" ] || [ -z "$dist" ]; then
    echo "FATAL: ${p}: could not read a manifest version (src='${src}' dist='${dist}')" >&2
    return 1
  fi
  if [ "$src" != "$dist" ]; then
    cat >&2 <<EOF
FATAL: ${p}: manifest version SKEW — the shipped artifact and source disagree.
    src/manifest.ts : ${src}
    dist/manifest.js: ${dist}
  dist was not rebuilt from the current source (pre-#228 stale-manifest trap: a
  stale stored manifest silently masks the change). Rebuild the plugin so
  dist/manifest.js matches src, bump version:, commit, then redeploy.
EOF
    return 1
  fi
  if [ -n "$pkg" ] && [ "$pkg" != "$src" ]; then
    echo "    ${p}: WARN package.json version ${pkg} lags the manifest ${src} — bump package.json to match (non-fatal)" >&2
  fi
  echo "    ${p}: manifest version ${src} (src=dist) OK"
  return 0
}

# guard_version_match PLUGIN SHIPPED LIVE — after reinstall, the live installed
# manifest version must equal the version of the artifact we just shipped.
# Trap: install is create-only ("won't update in place"); if the delete didn't
# take (or the mount was stale) the OLD manifest is still stored — live != shipped.
# Empty LIVE = the API didn't report a version → non-fatal skip (older host).
guard_version_match() {
  local p="$1" shipped="$2" live="$3"
  if [ -z "$shipped" ]; then
    echo "FATAL: ${p}: could not read shipped manifest version from dist/manifest.js" >&2
    return 1
  fi
  if [ -z "$live" ]; then
    echo "    ${p}: WARN live plugin version not reported by API — post-install version check SKIPPED" >&2
    return 0
  fi
  if [ "$live" = "$shipped" ]; then
    echo "    ${p}: live installed manifest version=${live} matches shipped OK"
    return 0
  fi
  echo "FATAL: ${p}: reinstall did NOT refresh the stored manifest — live=${live} != shipped=${shipped}" >&2
  echo "    ${p}:   install is create-only (pre-#228 'won't update in place' trap). The delete" >&2
  echo "    ${p}:   likely failed or the bind mount was stale. Recreate the mount and re-run." >&2
  return 1
}

# guard_version_bumped PLUGIN OLD_BODY NEW_BODY OLD_VER NEW_VER — the pre-#228 trap
# in its purest form (GOL-1500 invariant #1, literal): the manifest CONTENT changed
# vs what is deployed, yet the version string did NOT bump, so the change ships
# silently under an already-published version and every version-keyed consumer stays
# blind. This is the sub-case guard_version_consistency (src=dist) and
# guard_version_match (live=shipped) both PASS — all three agree on the un-bumped
# version — so it needs the deployed manifest body as a baseline to catch.
# OLD_BODY/NEW_BODY are the stored manifest bodies with the version field REMOVED,
# read from the SAME serialization (the board's own JSON) so they compare byte-for-
# byte. Empty OLD_BODY (fresh install, or a host whose API omits the manifest body)
# => no baseline => SKIP. This guard can only ever SKIP or FAIL-on-real-drift; it
# never false-blocks a deploy on a serialization artifact.
guard_version_bumped() {
  local p="$1" oldb="$2" newb="$3" oldv="$4" newv="$5"
  if [ -z "$oldb" ]; then
    echo "    ${p}: no deployed manifest body to compare (fresh install / API omits it) — bump check SKIPPED"
    return 0
  fi
  if [ "$oldb" = "$newb" ]; then
    echo "    ${p}: manifest content unchanged vs deployed — no version bump required OK"
    return 0
  fi
  if [ "$oldv" != "$newv" ]; then
    echo "    ${p}: manifest content changed and version bumped ${oldv} -> ${newv} OK"
    return 0
  fi
  cat >&2 <<EOF
FATAL: ${p}: manifest CONTENT changed but version did NOT bump (pre-#228 trap; GOL-1500).
    deployed & shipping version : ${newv}   (unchanged)
  The manifest just installed differs from the one previously deployed yet carries
  the same version string — the change ships silently under an already-published
  version and version-keyed consumers stay blind. Bump version: in src/manifest.ts,
  rebuild dist, commit, then redeploy.
EOF
  return 1
}

# guard_id_stable LIVE TF GATE — the live github-sync id must still match the id
# the inbound webhook path is scoped to (TF var). On drift the inbound sync is
# SEVERED at the CF edge until an operator re-scopes all three legs (GOL-1394).
guard_id_stable() {
  local live="$1" tf="$2" gate="$3"
  if [ -z "$tf" ]; then
    echo "    github-sync-plugin: WARN could not read var.github_sync_plugin_id from ${TF_WEBHOOK_FILE} — id gate SKIPPED" >&2
    return 0
  fi
  if [ -z "$live" ]; then
    echo "    github-sync-plugin: WARN plugin not installed — id gate SKIPPED" >&2
    return 0
  fi
  if [ "$live" = "$tf" ]; then
    echo "    github-sync-plugin: inbound id gate OK (live=TF=${live})"
    return 0
  fi
  # --- DRIFT: inbound sync is now severed at the edge -------------------------
  cat >&2 <<EOF

  ============================================================================
  🚨 INBOUND WEBHOOK ID DRIFT — GitHub→Paperclip issue sync is SEVERED (GOL-1394)
  ============================================================================
    live installed id : ${live}
    TF-scoped id      : ${tf}   (var.github_sync_plugin_id)

  The github-sync plugin id rotated on reinstall. Until all three are re-scoped
  to ${live}, every GitHub issue/PR delivery 302s at the Cloudflare edge and NO
  GitHub-created issue reaches the board. Operator legs (see
  docs/runbooks/github-issue-sync.md):

    1. infra/terraform/cloudflare-qa-webhook.tf: set
         default = "${live}"  (var.github_sync_plugin_id), then \`terraform apply\`.
    2. GitHub App "AgenticOS Developer" → webhook URL:
         https://paperclip.gatheringatthegrove.com/api/plugins/${live}/webhooks/github-app
    3. Update the inbound dead-man probe target (repo var GITHUB_SYNC_PLUGIN_ID
       or the webhook URL secret) so the probe tracks the live id.
  ============================================================================
EOF
  if [ "${gate}" = "warn" ]; then
    echo "    github-sync-plugin: id gate WARN-only (PLUGIN_ID_GATE=warn) — continuing" >&2
    return 0
  fi
  return 1
}

# guard_config_roundtrip PLUGIN READBACK_JSON KEY [KEY...] — every field we wrote
# must read back present and non-empty. Trap: the platform silently strips a
# secret field on write, so the worker enables with a blank credential and fails
# opaquely later. A redacted secret (e.g. "***") still counts as present — the
# strip trap yields an ABSENT or empty value, which is what we fail on.
guard_config_roundtrip() {
  local p="$1" json="$2"; shift 2
  local total="$#" missing=() k v
  for k in "$@"; do
    v="$(printf '%s' "$json" | jq -r --arg k "$k" '(.configJson // .)[$k] // empty' 2>/dev/null || true)"
    if [ -z "$v" ] || [ "$v" = "null" ]; then
      missing+=("$k")
    fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    echo "    ${p}: config round-trip OK (${total} field(s) survived write)"
    return 0
  fi
  echo "FATAL: ${p}: config round-trip FAILED — field(s) silently stripped on write: ${missing[*]}" >&2
  echo "    ${p}:   a field written to POST /config did not read back from GET /config" >&2
  echo "    ${p}:   (secret-field silent-strip trap). Do NOT enable — re-apply config and re-run." >&2
  return 1
}

# =============================================================================
# Live wrappers around the pure guardrails (touch local files + board API).
# =============================================================================

# guard_manifest_version PLUGIN — offline src/dist/pkg version-agreement check.
# Fail-fast BEFORE the destructive delete so a version skew never tears down a
# healthy plugin.
guard_manifest_version() {
  local p="$1" d="${REPO_ROOT}/packages/${p}"
  guard_version_consistency "$p" \
    "$(ver_from_manifest "${d}/src/manifest.ts")" \
    "$(ver_from_manifest "${d}/dist/manifest.js")" \
    "$(ver_from_pkg       "${d}/package.json")"
}

# live_plugin_version PLUGIN — installed manifest version from the board API
# (tolerant of both the flat `.version` and a nested `.manifest.version`).
live_plugin_version() {
  api GET /api/plugins | jq -r --arg k "agenticos.$1" \
    '(if type=="object" then .plugins else . end)[]
       | select(.pluginKey==$k) | (.version // .manifest.version // "")'
}

# guard_version_live PLUGIN — post-reinstall: live version == shipped version.
guard_version_live() {
  local p="$1"
  guard_version_match "$p" \
    "$(ver_from_manifest "${REPO_ROOT}/packages/${p}/dist/manifest.js")" \
    "$(live_plugin_version "$p")"
}

# live_manifest_body PLUGIN — the board's stored manifest for the plugin with the
# version field stripped and keys sorted (jq -S) so two reads at different times are
# byte-comparable. Empty when the plugin row / manifest body isn't present (fresh
# install, or a host whose /api/plugins payload omits the manifest object) — callers
# treat empty as "no baseline, skip", never as "changed".
live_manifest_body() {
  api GET /api/plugins 2>/dev/null | jq -S -c --arg k "agenticos.$1" \
    '[ (if type=="object" then .plugins else . end)[] | select(.pluginKey==$k) ][0]
       | (.manifest // empty) | del(.version)' 2>/dev/null || true
}

# guard_version_bumped_live PLUGIN OLD_BODY OLD_VER — post-reinstall content-vs-bump
# check. OLD_BODY/OLD_VER are captured BEFORE the destructive delete (the deployed
# manifest); we read the freshly-installed body/version back and hand both to the
# pure comparator.
guard_version_bumped_live() {
  local p="$1" oldb="$2" oldv="$3"
  guard_version_bumped "$p" "$oldb" "$(live_manifest_body "$p")" \
    "$oldv" "$(live_plugin_version "$p")"
}

# config_roundtrip_live PLUGIN KEY [KEY...] — GET the stored config and assert
# the named fields survived the write.
config_roundtrip_live() {
  local p="$1"; shift
  local id json
  id="$(resolve_plugin_id "agenticos.${p}")"
  [ -n "$id" ] || { echo "FATAL: ${p}: not installed for config round-trip" >&2; return 1; }
  json="$(api GET "/api/plugins/${id}/config" 2>/dev/null || echo '{}')"
  guard_config_roundtrip "$p" "$json" "$@"
}

# tf_github_sync_id — parse the committed default of var.github_sync_plugin_id
# from cloudflare-qa-webhook.tf. Empty if the file/var is missing. NOTE: this is
# the committed intent; a terraform.tfvars override is not read here (the gate is
# a drift tripwire, not a full plan) — see the runbook.
tf_github_sync_id() {
  [ -f "${TF_WEBHOOK_FILE}" ] || { echo ""; return 0; }
  awk '/variable "github_sync_plugin_id"/{f=1} f&&/default/{print; exit}' "${TF_WEBHOOK_FILE}" \
    | grep -oiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1
}

# assert_inbound_id_stable — after a github-sync reinstall, the live id must
# still match the id the inbound webhook path is scoped to (TF + GitHub App).
assert_inbound_id_stable() {
  guard_id_stable \
    "$(resolve_plugin_id "agenticos.github-sync-plugin")" \
    "$(tf_github_sync_id)" \
    "${PLUGIN_ID_GATE}"
}

# recreate_guard PLUGIN — recreate paperclip-server iff the plugin dir is not
# yet visible in the container. Idempotent (skips when the mount resolves).
recreate_guard() {
  local p="$1"
  if ssh "${DROPLET_SSH}" \
       "cd ${COMPOSE_DIR} && docker compose exec -T paperclip-server test -s /paperclip/plugins/${p}/package.json" \
       >/dev/null 2>&1; then
    echo "    ${p}: mount already resolved (no recreate)"
    return 0
  fi
  echo "    ${p}: mount missing in container -> force-recreate paperclip-server"
  ssh "${DROPLET_SSH}" \
    "cd ${COMPOSE_DIR} && docker compose up -d --force-recreate paperclip-server"
  for _ in $(seq 1 30); do
    if api GET /api/plugins >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "FATAL: ${p}: API did not come back after recreate" >&2
  return 1
}

# reinstall PLUGIN — delete (if present) then install fresh.
#
# POST /api/plugins/install returns 400 in two distinct situations:
#   a) true install rejection (e.g. missing dist/ or manifest): NO plugin row
#      is created — fatal, nothing downstream can recover it.
#   b) worker ACTIVATION failed during install (e.g. required config such as
#      discordBotToken not applied yet): the plugin row IS created with
#      state=error, and the recovery is exactly what this script does next
#      anyway — apply_config then disable/enable. Continue with a warning.
# We distinguish them by probing for the plugin row after a failed install.
reinstall() {
  local p="$1" id status
  id="$(resolve_plugin_id "agenticos.${p}")"
  if [ -n "$id" ]; then
    api DELETE "/api/plugins/${id}" >/dev/null && echo "    ${p}: deleted ${id}"
  fi
  if status="$(api POST /api/plugins/install \
    "{\"packageName\":\"/paperclip/plugins/${p}\",\"isLocalPath\":true}" \
    | jq -r '.status')"; then
    echo "    ${p}: installed -> ${status}"
    return 0
  fi
  id="$(resolve_plugin_id "agenticos.${p}")"
  if [ -n "$id" ]; then
    echo "    ${p}: WARN install failed but plugin row ${id} exists (worker" >&2
    echo "    ${p}:   activation failed, likely missing config) — continuing;" >&2
    echo "    ${p}:   apply_config + disable/enable should recover it" >&2
    return 0
  fi
  echo "FATAL: ${p}: install rejected and no plugin row created (missing dist/manifest?)" >&2
  return 1
}

# guard_id_rotation PLUGIN ID_BEFORE — a reinstall rotates the plugin id
# (delete+install is the only update path). Surface it: anything scoped to the
# id (webhook URLs, CF Access apps, dead-man probes) must track the new value.
# For github-sync the fatal TF gate is assert_inbound_id_stable; here we just
# make the rotation visible for every plugin so it can never happen silently.
guard_id_rotation() {
  local p="$1" before="$2" after
  after="$(resolve_plugin_id "agenticos.${p}")"
  [ -n "$after" ] || { echo "FATAL: ${p}: no plugin id after reinstall" >&2; return 1; }
  if [ -n "$before" ] && [ "$before" != "$after" ]; then
    echo "    ${p}: NOTE plugin id rotated on reinstall ${before} -> ${after}" >&2
    echo "    ${p}:   anything scoped to the id (webhook URLs, CF Access, probes) must track ${after}" >&2
  else
    echo "    ${p}: plugin id ${after}"
  fi
}

# apply_config PLUGIN — push config from 1Password for plugins that take it,
# then round-trip it back to prove no field was silently stripped on write.
apply_config() {
  local p="$1"
  case "$p" in
    github-plugin)      configure_github;         config_roundtrip_live "$p" githubToken org ;;
    openviking-plugin)  configure_openviking;     config_roundtrip_live "$p" apiKey endpoint ;;
    vault-plugin)       echo "    ${p}: no config" ;;
    github-sync-plugin) echo "    ${p}: config deferred -> see docs/runbooks/github-issue-sync.md" ;;
    discord-plugin)     configure_discord_plugin; config_roundtrip_live "$p" discordBotToken spacesKey spacesSecret ;;
  esac
}

# cycle PLUGIN — disable then enable to force setup() to re-run.
cycle() {
  local p="$1" id
  id="$(resolve_plugin_id "agenticos.${p}")"
  [ -n "$id" ] || { echo "FATAL: ${p} missing after install" >&2; return 1; }
  api POST "/api/plugins/${id}/disable" >/dev/null 2>&1 || true
  api POST "/api/plugins/${id}/enable"  >/dev/null
  echo "    ${p}: disabled+enabled"
}

# assert_healthy PLUGIN — print status; fail on an error/empty state.
# Healthy = not in an error state. A plugin like github-sync-plugin stays
# inactive by design until separately configured, so we do NOT assert "active".
assert_healthy() {
  local p="$1" status
  status="$(api GET /api/plugins | jq -r --arg k "agenticos.${p}" \
    '(if type=="object" then .plugins else . end)[] | select(.pluginKey==$k) | .status')"
  echo "    ${p}: status=${status}"
  case "$status" in
    error|failed|"") echo "FATAL: ${p} not healthy (status='${status}')" >&2; return 1 ;;
  esac
}

# =============================================================================
# --selftest — inject each guardrail's trap and assert it fails; assert the
# happy path passes. Pure comparators only: no op/ssh/api, safe to run in CI.
# =============================================================================
run_selftest() {
  local fails=0
  # expect_fail  DESC  <cmd...>   — the guard MUST return non-zero
  expect_fail() {
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then
      echo "SELFTEST FAIL: ${desc} — guard did NOT fail on its trap" >&2; fails=$((fails+1))
    else
      echo "  ok (trap tripped): ${desc}"
    fi
  }
  # expect_pass  DESC  <cmd...>   — the guard MUST return zero
  expect_pass() {
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then
      echo "  ok (happy path):  ${desc}"
    else
      echo "SELFTEST FAIL: ${desc} — guard failed on a valid input" >&2; fails=$((fails+1))
    fi
  }

  echo "== deploy-plugin.sh guardrail self-test =="

  echo "-- G1: manifest version bump / consistency --"
  expect_pass "src=dist=pkg agree"            guard_version_consistency t 0.16.0 0.16.0 0.16.0
  expect_pass "pkg lag is a WARN, not fatal"  guard_version_consistency t 0.16.0 0.16.0 0.15.0
  expect_fail "dist stale (not rebuilt)"      guard_version_consistency t 0.16.0 0.15.0 0.16.0
  expect_fail "src version unreadable"        guard_version_consistency t ""     0.16.0 0.16.0
  expect_fail "dist version unreadable"       guard_version_consistency t 0.16.0 ""     0.16.0
  expect_pass "live == shipped"               guard_version_match       t 0.16.0 0.16.0
  expect_fail "live != shipped (stale store)" guard_version_match       t 0.16.0 0.15.0
  expect_pass "live version unknown -> skip"  guard_version_match       t 0.16.0 ""

  echo "-- G1c: manifest CONTENT change REQUIRES a version bump (pre-#228) --"
  expect_pass "no deployed baseline -> skip"       guard_version_bumped t ''           '{"a":1}' ''     0.16.0
  expect_pass "content unchanged -> no bump req"   guard_version_bumped t '{"a":1}'    '{"a":1}' 0.16.0 0.16.0
  expect_pass "content changed WITH a bump"        guard_version_bumped t '{"a":1}'    '{"a":2}' 0.16.0 0.17.0
  expect_fail "content changed WITHOUT a bump"     guard_version_bumped t '{"a":1}'    '{"a":2}' 0.16.0 0.16.0

  echo "-- G2: plugin id unchanged vs TF (extends #506) --"
  expect_pass "live == TF"                    guard_id_stable AAA AAA fail
  expect_fail "live != TF (inbound severed)"  guard_id_stable AAA BBB fail
  expect_pass "drift but PLUGIN_ID_GATE=warn" guard_id_stable AAA BBB warn
  expect_pass "TF var missing -> skip"        guard_id_stable AAA ""  fail

  echo "-- G3: config round-trip (secret silent-strip) --"
  expect_pass "all fields present"            guard_config_roundtrip t '{"configJson":{"githubToken":"x","org":"y"}}' githubToken org
  expect_pass "secret redacted still counts"  guard_config_roundtrip t '{"configJson":{"githubToken":"***","org":"y"}}' githubToken org
  expect_fail "secret stripped (absent)"      guard_config_roundtrip t '{"configJson":{"org":"y"}}' githubToken org
  expect_fail "secret blanked (empty)"        guard_config_roundtrip t '{"configJson":{"githubToken":"","org":"y"}}' githubToken org

  echo "=========================================="
  if [ "$fails" -eq 0 ]; then
    echo "SELFTEST: all guardrails trip on their trap and pass the happy path ✅"
    exit 0
  fi
  echo "SELFTEST: ${fails} guardrail assertion(s) regressed ❌" >&2
  exit 1
}

# --- dispatch: --selftest short-circuits before requiring op/ssh --------------
if [ "${1:-}" = "--selftest" ]; then
  command -v jq >/dev/null || { echo "FATAL: 'jq' not found (needed for --selftest)" >&2; exit 1; }
  run_selftest
fi

# --- validate args BEFORE touching op/ssh so bad input fails fast & offline ---
[ "$#" -ge 1 ] || usage
for p in "$@"; do
  case " ${VALID_PLUGINS} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}'" >&2; usage ;;
  esac
done

pc_require_tools
command -v ssh >/dev/null || { echo "FATAL: 'ssh' not found" >&2; exit 1; }
pc_load_board_key

gate_rc=0
for p in "$@"; do
  echo "==> ${p}"
  # G1a: version agreement across src/dist/pkg — fail-fast BEFORE destructive delete.
  guard_manifest_version "$p"
  id_before="$(resolve_plugin_id "agenticos.${p}")"
  # G1c: snapshot the DEPLOYED manifest body + version BEFORE the destructive delete
  # so guard_version_bumped_live can prove a content change carried a version bump.
  body_before="$(live_manifest_body "$p")"
  ver_before="$(live_plugin_version "$p")"
  recreate_guard "$p"
  reinstall "$p"
  # G2: surface a reinstall-rotated id (fatal TF gate for github-sync is below).
  guard_id_rotation "$p" "$id_before"
  # G3: config round-trip happens inside apply_config right after each write.
  apply_config "$p"
  cycle "$p"
  assert_healthy "$p"
  # G1b: the live stored manifest version must match what we just shipped —
  # proves the delete+reinstall actually refreshed the manifest.
  guard_version_live "$p"
  # G1c: a manifest CONTENT change must carry a version bump (pre-#228 trap;
  # GOL-1500 invariant #1). Skips when there was no deployed baseline to compare.
  guard_version_bumped_live "$p" "$body_before" "$ver_before"
  # A github-sync reinstall rotates the id — verify the inbound path still
  # resolves. Deferred non-fatal so the rest of the deploy completes; the
  # script exits non-zero at the end so CI/the operator can't miss the drift.
  if [ "$p" = "github-sync-plugin" ]; then
    assert_inbound_id_stable || gate_rc=1
  fi
done
echo "==> done. Plugins refreshed from 1Password: $*"
if [ "$gate_rc" -ne 0 ]; then
  echo "==> FAIL: github-sync inbound webhook id drift (see above). Re-scope TF + GitHub App, then re-run." >&2
  exit 1
fi
