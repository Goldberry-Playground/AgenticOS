#!/usr/bin/env bash
#
# apply-merge-policy.sh — align merge policy across the active Goldberry-Playground
# repos (GOL-1819). Four settings each independently invalidate an already-green PR
# and fight the merge queue; this script reads the declared target state from
# .github/merge-policy.json and either reports drift (--check) or converges it
# (--apply).
#
#   --check   (default)  Read-only. Print a before/after table for every repo and
#                        exit non-zero if any managed setting is off-target. Safe
#                        for anyone to run; performs no writes.
#   --apply              Converge live state to the declared targets. Idempotent:
#                        it only issues a write for a setting that is off-target, so
#                        a second run reports zero changes.
#   --dry-run            With --apply, print the API calls that WOULD be made
#                        without executing them.
#
#   --repo <name>        Limit to a single repo (matches the "repo" field).
#   --config <path>      Override the policy file (default: repo .github/merge-policy.json).
#
# WRITES ARE BOARD-GATED. The default GITHUB_TOKEN cannot write branch protection or
# rulesets, and no admin token is provisioned in these repos. --apply must be run by
# an operator (Josh) whose `gh` auth holds admin. See GOL-1819 / GOL-392 / GOL-1207.
#
# Auth: uses the ambient `gh` CLI credential (GH_TOKEN / gh auth login).
# Deps: gh, jq.
set -euo pipefail

OWNER="Goldberry-Playground"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${MERGE_POLICY_CONFIG:-$here/../../.github/merge-policy.json}"
MODE="check"
DRY=0
ONLY_REPO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --check)   MODE="check" ;;
    --apply)   MODE="apply" ;;
    --dry-run) DRY=1 ;;
    --repo)    ONLY_REPO="${2:?--repo needs a value}"; shift ;;
    --config)  CONFIG="${2:?--config needs a value}"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v gh >/dev/null || { echo "error: gh CLI not found" >&2; exit 3; }
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 3; }
[ -f "$CONFIG" ] || { echo "error: config not found: $CONFIG" >&2; exit 3; }

# ---- helpers ---------------------------------------------------------------

# gh api wrapper; all calls go through here so a test harness can stub `gh`.
ghapi() { gh api -H "Accept: application/vnd.github+json" "$@"; }

# Colour only on a tty.
if [ -t 1 ]; then C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else C_RED=""; C_GRN=""; C_DIM=""; C_RST=""; fi

OFFTARGET=0   # global drift counter (check + apply)
CHANGES=0     # writes performed/planned (apply)

# print one field row: label, current, target, and a status marker.
row() {
  local label="$1" cur="$2" tgt="$3" ok
  if [ "$cur" = "$tgt" ]; then ok="${C_GRN}ok${C_RST}"; else ok="${C_RED}OFF${C_RST}"; OFFTARGET=$((OFFTARGET+1)); fi
  printf '    %-34s %-7s -> %-7s  %s\n' "$label" "$cur" "$tgt" "$ok"
}

# Render a possibly-boolean jq value as "true"/"false"/"unset". We extract via an
# array wrap + `.[0]` (null when absent) rather than jq's `//`, because `//`
# treats a real `false` as empty and would mask it as "unset".
_boolstr='.[0] as $v | if $v==null then "unset" else ($v|tostring) end'

# jq extractor for a canonical target key out of a ruleset detail JSON.
ruleset_current() { # <ruleset-json> <canonical-key>
  local json="$1" key="$2" path
  case "$key" in
    strict)                      path='.rules[]?|select(.type=="required_status_checks").parameters.strict_required_status_checks_policy' ;;
    dismiss_stale_reviews)       path='.rules[]?|select(.type=="pull_request").parameters.dismiss_stale_reviews_on_push' ;;
    thread_resolution)           path='.rules[]?|select(.type=="pull_request").parameters.required_review_thread_resolution' ;;
    extra_approval_unattributed) path='.rules[]?|select(.type=="pull_request").parameters.require_extra_approval_for_unattributed_changes' ;;
    *) echo "unset"; return ;;
  esac
  jq -r "[ $path ] | $_boolstr" <<<"$json"
}

# jq extractor for a canonical target key out of a legacy branch-protection JSON.
legacy_current() { # <protection-json> <canonical-key>
  local json="$1" key="$2" path
  case "$key" in
    strict)                path='.required_status_checks.strict' ;;
    dismiss_stale_reviews) path='.required_pull_request_reviews.dismiss_stale_reviews' ;;
    thread_resolution)     path='.required_conversation_resolution.enabled' ;;
    *) echo "unset"; return ;;   # extra_approval_unattributed does not exist in legacy protection
  esac
  jq -r "[ $path ] | $_boolstr" <<<"$json"
}

# Resolve a ruleset id by name for a repo; empty if absent.
ruleset_id_by_name() { # <repo> <name>
  ghapi "/repos/$OWNER/$1/rulesets" --jq "map(select(.name==\"$2\"))[0].id // empty" 2>/dev/null || true
}

# Read a target value as true/false/null. Uses has() rather than `//` so a target
# of `false` is not swallowed (jq's `//` treats false as empty).
target_val() { # <row-json> <canonical-key>
  jq -r --arg k "$2" 'if (.targets|has($k)) then (.targets[$k]|tostring) else "null" end' <<<"$1"
}

say_write() { # <description>
  if [ "$DRY" = 1 ]; then echo "    ${C_DIM}[dry-run]${C_RST} would $1"
  else echo "    -> $1"; fi
}

# ---- per-repo processing ---------------------------------------------------

process_ruleset_repo() { # <row-json>
  local row="$1"
  local repo rs_name; repo=$(jq -r '.repo' <<<"$row"); rs_name=$(jq -r '.protection_ruleset' <<<"$row")
  echo "  [$repo]  (ruleset: $rs_name)"

  local rs_id; rs_id=$(ruleset_id_by_name "$repo" "$rs_name")
  if [ -z "$rs_id" ]; then echo "    ${C_RED}ERROR${C_RST}: ruleset '$rs_name' not found"; OFFTARGET=$((OFFTARGET+1)); return; fi
  local detail; detail=$(ghapi "/repos/$OWNER/$repo/rulesets/$rs_id")

  # Snapshot targets and current values.
  local keys; keys=$(jq -r '.targets|keys[]' <<<"$row")
  local off_here=0
  local k tgt cur
  for k in $keys; do
    tgt=$(jq -r ".targets.$k" <<<"$row")
    cur=$(ruleset_current "$detail" "$k")
    local before=$OFFTARGET; row "$k" "$cur" "$tgt"
    [ "$OFFTARGET" -gt "$before" ] && off_here=1
  done

  # Dormant second-reviewer ruleset — target: deleted.
  local del_name del_id=""
  if [ "$(jq -r '.delete_dormant_reviewer_ruleset // false' <<<"$row")" = "true" ]; then
    del_name=$(jq -r '.dormant_reviewer_ruleset_name' <<<"$CONFIG_JSON")
    del_id=$(ruleset_id_by_name "$repo" "$del_name")
    if [ -n "$del_id" ]; then row "dormant-reviewer-ruleset" "present" "deleted"; off_here=1; else row "dormant-reviewer-ruleset" "absent" "deleted"; fi
  fi

  [ "$MODE" = apply ] || return 0
  [ "$off_here" = 1 ] || { echo "    ${C_GRN}already aligned — no change${C_RST}"; return 0; }

  # Build the mutated ruleset PUT body: override only managed pull_request /
  # required_status_checks params, preserve everything else.
  local strict dismiss thread extra
  strict=$(target_val "$row" strict)
  dismiss=$(target_val "$row" dismiss_stale_reviews)
  thread=$(target_val "$row" thread_resolution)
  extra=$(target_val "$row" extra_approval_unattributed)

  local body
  body=$(jq \
    --argjson strict "$strict" --argjson dismiss "$dismiss" \
    --argjson thread "$thread" --argjson extra "$extra" '
    {name, target, enforcement, bypass_actors, conditions,
     rules: (.rules | map(
       if .type=="pull_request" then
         (if $dismiss!=null then .parameters.dismiss_stale_reviews_on_push=$dismiss else . end)
         | (if $thread!=null then .parameters.required_review_thread_resolution=$thread else . end)
         | (if $extra!=null then .parameters.require_extra_approval_for_unattributed_changes=$extra else . end)
       elif .type=="required_status_checks" then
         (if $strict!=null then .parameters.strict_required_status_checks_policy=$strict else . end)
       else . end))}' <<<"$detail")

  say_write "PUT ruleset '$rs_name' ($rs_id) with aligned pull_request/status params"
  CHANGES=$((CHANGES+1))
  if [ "$DRY" != 1 ]; then
    printf '%s' "$body" | ghapi --method PUT "/repos/$OWNER/$repo/rulesets/$rs_id" --input - >/dev/null
  fi

  if [ -n "$del_id" ]; then
    say_write "DELETE dormant-reviewer ruleset '$del_name' ($del_id)"
    CHANGES=$((CHANGES+1))
    [ "$DRY" = 1 ] || ghapi --method DELETE "/repos/$OWNER/$repo/rulesets/$del_id" >/dev/null
  fi
}

process_legacy_repo() { # <row-json>
  local row="$1"
  local repo branch; repo=$(jq -r '.repo' <<<"$row"); branch=$(jq -r '.branch' <<<"$row")
  echo "  [$repo]  (legacy branch protection: $branch)"

  local prot; prot=$(ghapi "/repos/$OWNER/$repo/branches/$branch/protection")

  local keys; keys=$(jq -r '.targets|keys[]' <<<"$row")
  local off_here=0 k tgt cur
  for k in $keys; do
    tgt=$(jq -r ".targets.$k" <<<"$row")
    cur=$(legacy_current "$prot" "$k")
    local before=$OFFTARGET; row "$k" "$cur" "$tgt"
    [ "$OFFTARGET" -gt "$before" ] && off_here=1
  done

  local del_name del_id=""
  if [ "$(jq -r '.delete_dormant_reviewer_ruleset // false' <<<"$row")" = "true" ]; then
    del_name=$(jq -r '.dormant_reviewer_ruleset_name' <<<"$CONFIG_JSON")
    del_id=$(ruleset_id_by_name "$repo" "$del_name")
    if [ -n "$del_id" ]; then row "dormant-reviewer-ruleset" "present" "deleted"; off_here=1; else row "dormant-reviewer-ruleset" "absent" "deleted"; fi
  fi

  [ "$MODE" = apply ] || return 0
  [ "$off_here" = 1 ] || { echo "    ${C_GRN}already aligned — no change${C_RST}"; return 0; }

  local strict dismiss thread manages_thread
  strict=$(target_val "$row" strict)
  dismiss=$(target_val "$row" dismiss_stale_reviews)
  thread=$(target_val "$row" thread_resolution)
  manages_thread=$(jq -r 'if (.targets|has("thread_resolution")) then "yes" else "no" end' <<<"$row")

  if [ "$manages_thread" = "yes" ]; then
    # required_conversation_resolution can only be set via the full protection PUT,
    # so reconstruct the whole protection body from current state and override all
    # managed fields in one declarative, idempotent call.
    local body
    body=$(jq \
      --argjson strict "$strict" --argjson dismiss "$dismiss" --argjson thread "$thread" '
      {
        required_status_checks: (if .required_status_checks==null then null else
          {strict: (if $strict!=null then $strict else .required_status_checks.strict end),
           contexts: (.required_status_checks.contexts // [])} end),
        enforce_admins: (.enforce_admins.enabled // false),
        required_pull_request_reviews: (if .required_pull_request_reviews==null then null else
          {dismiss_stale_reviews: (if $dismiss!=null then $dismiss else .required_pull_request_reviews.dismiss_stale_reviews end),
           require_code_owner_reviews: (.required_pull_request_reviews.require_code_owner_reviews // false),
           required_approving_review_count: (.required_pull_request_reviews.required_approving_review_count // 0),
           require_last_push_approval: (.required_pull_request_reviews.require_last_push_approval // false)} end),
        restrictions: (if .restrictions==null then null else
          {users: [.restrictions.users[].login], teams: [.restrictions.teams[].slug], apps: [.restrictions.apps[].slug]} end),
        required_linear_history: (.required_linear_history.enabled // false),
        allow_force_pushes: (.allow_force_pushes.enabled // false),
        allow_deletions: (.allow_deletions.enabled // false),
        block_creations: (.block_creations.enabled // false),
        required_conversation_resolution: (if $thread!=null then $thread else (.required_conversation_resolution.enabled // false) end),
        lock_branch: (.lock_branch.enabled // false),
        allow_fork_syncing: (.allow_fork_syncing.enabled // false)
      }' <<<"$prot")
    say_write "PUT full branch protection on $branch (strict/dismiss/thread_resolution overridden)"
    CHANGES=$((CHANGES+1))
    [ "$DRY" = 1 ] || printf '%s' "$body" | ghapi --method PUT "/repos/$OWNER/$repo/branches/$branch/protection" --input - >/dev/null
  else
    # Only strict / dismiss managed — use the granular sub-endpoints (smaller blast radius).
    if [ "$strict" != "null" ]; then
      say_write "PATCH required_status_checks.strict=$strict on $branch"
      CHANGES=$((CHANGES+1))
      [ "$DRY" = 1 ] || ghapi --method PATCH "/repos/$OWNER/$repo/branches/$branch/protection/required_status_checks" -F "strict=$strict" >/dev/null
    fi
    if [ "$dismiss" != "null" ]; then
      say_write "PATCH required_pull_request_reviews.dismiss_stale_reviews=$dismiss on $branch"
      CHANGES=$((CHANGES+1))
      [ "$DRY" = 1 ] || ghapi --method PATCH "/repos/$OWNER/$repo/branches/$branch/protection/required_pull_request_reviews" -F "dismiss_stale_reviews=$dismiss" >/dev/null
    fi
  fi

  if [ -n "$del_id" ]; then
    say_write "DELETE dormant-reviewer ruleset '$del_name' ($del_id)"
    CHANGES=$((CHANGES+1))
    [ "$DRY" = 1 ] || ghapi --method DELETE "/repos/$OWNER/$repo/rulesets/$del_id" >/dev/null
  fi
}

process_out_of_scope() { # <row-json>
  local repo note; repo=$(jq -r '.repo' <<<"$1"); note=$(jq -r '.note // ""' <<<"$1")
  echo "  [$repo]  ${C_DIM}(out of scope — read-only)${C_RST}"
  local rs; rs=$(ghapi "/repos/$OWNER/$repo/rulesets" --jq 'map("\(.name)=\(.enforcement)")|join(", ")' 2>/dev/null || echo "?")
  echo "    rulesets: ${rs:-none}"
  [ -n "$note" ] && echo "    ${C_DIM}$note${C_RST}"
}

# ---- main ------------------------------------------------------------------

CONFIG_JSON=$(cat "$CONFIG")
export CONFIG_JSON

echo "merge-policy $MODE — owner=$OWNER  config=$CONFIG"
[ "$MODE" = apply ] && [ "$DRY" = 1 ] && echo "(dry-run: no writes will be performed)"
echo

jq -c '.repos[]' <<<"$CONFIG_JSON" | while IFS= read -r rowjson; do
  repo=$(jq -r '.repo' <<<"$rowjson")
  [ -n "$ONLY_REPO" ] && [ "$ONLY_REPO" != "$repo" ] && continue
  system=$(jq -r '.system' <<<"$rowjson")
  case "$system" in
    ruleset)      process_ruleset_repo "$rowjson" ;;
    legacy)       process_legacy_repo "$rowjson" ;;
    out-of-scope) process_out_of_scope "$rowjson" ;;
    *) echo "  [$repo] unknown system: $system"; OFFTARGET=$((OFFTARGET+1)) ;;
  esac
  echo
# NOTE: the while loop runs in a subshell (pipe), so OFFTARGET/CHANGES mutations
# there do not survive. We recompute the exit disposition below from a summary line.
done

# Re-run the counters in the current shell for an accurate exit code. Cheap: the
# per-field reads are already warm and this avoids the subshell-variable trap.
summary() {
  local off=0
  while IFS= read -r rowjson; do
    local repo system; repo=$(jq -r '.repo' <<<"$rowjson"); system=$(jq -r '.system' <<<"$rowjson")
    [ -n "$ONLY_REPO" ] && [ "$ONLY_REPO" != "$repo" ] && continue
    [ "$system" = "out-of-scope" ] && continue
    local keys k tgt cur detail prot rs_id rs_name branch
    keys=$(jq -r '.targets|keys[]' <<<"$rowjson")
    if [ "$system" = ruleset ]; then
      rs_name=$(jq -r '.protection_ruleset' <<<"$rowjson")
      rs_id=$(ruleset_id_by_name "$repo" "$rs_name")
      [ -z "$rs_id" ] && { off=$((off+1)); continue; }
      detail=$(ghapi "/repos/$OWNER/$repo/rulesets/$rs_id")
      for k in $keys; do tgt=$(jq -r ".targets.$k" <<<"$rowjson"); cur=$(ruleset_current "$detail" "$k"); [ "$cur" = "$tgt" ] || off=$((off+1)); done
    else
      branch=$(jq -r '.branch' <<<"$rowjson")
      prot=$(ghapi "/repos/$OWNER/$repo/branches/$branch/protection")
      for k in $keys; do tgt=$(jq -r ".targets.$k" <<<"$rowjson"); cur=$(legacy_current "$prot" "$k"); [ "$cur" = "$tgt" ] || off=$((off+1)); done
    fi
    if [ "$(jq -r '.delete_dormant_reviewer_ruleset // false' <<<"$rowjson")" = "true" ]; then
      local dn di; dn=$(jq -r '.dormant_reviewer_ruleset_name' <<<"$CONFIG_JSON"); di=$(ruleset_id_by_name "$repo" "$dn")
      [ -n "$di" ] && off=$((off+1))
    fi
  done < <(jq -c '.repos[]' <<<"$CONFIG_JSON")
  echo "$off"
}

OFF=$(summary)
echo "----------------------------------------------------------------------"
if [ "$MODE" = check ]; then
  if [ "$OFF" -gt 0 ]; then echo "${C_RED}drift: $OFF setting(s) off-target${C_RST}"; exit 1
  else echo "${C_GRN}all managed settings on-target${C_RST}"; exit 0; fi
else
  if [ "$DRY" = 1 ]; then echo "dry-run complete."; exit 0; fi
  if [ "$OFF" -gt 0 ]; then echo "${C_RED}apply left $OFF setting(s) off-target — investigate${C_RST}"; exit 1
  else echo "${C_GRN}apply complete — all managed settings on-target${C_RST}"; exit 0; fi
fi
