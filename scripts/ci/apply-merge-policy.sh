#!/usr/bin/env bash
#
# apply-merge-policy.sh — align merge policy across the active Goldberry-Playground
# repos (GOL-1819). Four settings each independently invalidate an already-green PR
# and fight the merge queue; this script reads the declared target state from
# .github/merge-policy.json and either reports drift (--check) or converges it
# (--apply). GOL-3051 added a second managed surface: the repo's own named
# merge-queue ruleset, whose check_response_timeout_minutes can silently make the
# queue non-functional (see the merge-queue section below).
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
#   --surface <name>     Limit to ONE managed surface: `protection` (branch
#                        protection / required contexts / dormant ruleset) or
#                        `merge-queue`. Default `all`.
#                        REQUIRED to converge a merge-queue timeout on a repo whose
#                        required_contexts promotion is still paused (GOL-1953 /
#                        GOL-1958): a bare `--apply` there would ALSO promote that
#                        repo's paused contexts, which is a separate board decision.
#                        `--surface merge-queue --apply` touches nothing but the
#                        merge-queue ruleset.
#   --config <path>      Override the policy file (default: repo .github/merge-policy.json).
#
# WRITES ARE BOARD-GATED -- BY POLICY, NOT BY CAPABILITY (corrected GOL-3051).
# This block used to say "no admin token is provisioned in these repos", which is
# no longer true and was keeping routine convergence on Josh's plate for no
# reason. Verified 2026-10-05: an installation token minted from the
# `agenticos-developer` App (scripts/agent-git/github-app-token.mjs) DOES carry
# ruleset write -- a same-value `PUT /repos/.../rulesets/{id}` returns 200. What
# remains true is that an Actions-workflow `GITHUB_TOKEN` cannot.
# So the gate is a deliberate policy choice about blast radius, not a missing
# credential: branch protection and required-context promotion are board
# decisions (GOL-1953 is paused pending GOL-1958). Treat --apply on the
# `protection` surface as board-gated, and prefer
# `--surface merge-queue` for the narrow, non-weakening queue settings.
# See GOL-1819 / GOL-392 / GOL-1207 / GOL-3051.
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
SURFACE="all"

while [ $# -gt 0 ]; do
  case "$1" in
    --check)   MODE="check" ;;
    --apply)   MODE="apply" ;;
    --dry-run) DRY=1 ;;
    --repo)    ONLY_REPO="${2:?--repo needs a value}"; shift ;;
    --surface) SURFACE="${2:?--surface needs a value}"; shift ;;
    --config)  CONFIG="${2:?--config needs a value}"; shift ;;
    # Print the leading comment block by SHAPE, not by line number: the hardcoded
    # range this replaces had already drifted into spilling `set -euo pipefail`
    # and the first two assignments into the usage text, and every edit to the
    # doc block re-broke it (GOL-3051).
    -h|--help) awk 'NR>1 && /^#/ {print; next} NR>1 {exit}' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$SURFACE" in
  all|protection|merge-queue) ;;
  *) echo "error: --surface must be one of: all, protection, merge-queue (got '$SURFACE')" >&2; exit 2 ;;
esac

# Surface predicates. Kept as functions so both the display loop and summary()
# gate on exactly the same condition and cannot drift apart.
want_protection() { [ "$SURFACE" = all ] || [ "$SURFACE" = protection ]; }
want_merge_queue() { [ "$SURFACE" = all ] || [ "$SURFACE" = merge-queue ]; }

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

# ---- required-context helpers (GOL-1953) -----------------------------------
# The guard layer (config-freeze / fix-touches-test / CI scripts /
# required-checks-audit + per-repo security checks) only bound agent-authored
# PRs via auto-approve's shell logic; the branch merge gate ignored them. Promote each verified context (it must report success on an
# actual `merge_group` commit first — acceptance #1) into the required list.

# Newline-separated sorted required-check contexts currently set on a RULESET.
ruleset_required_contexts() { # <ruleset-json>
  jq -r '[.rules[]?|select(.type=="required_status_checks")
          .parameters.required_status_checks[]?.context] | sort | .[]' <<<"$1"
}
# Newline-separated sorted required-check contexts on LEGACY branch protection.
# Reads the app_id-pinned `checks[]`, not the deprecated `contexts[]` mirror.
legacy_required_contexts() { # <protection-json>
  jq -r '[.required_status_checks.checks[]?.context] | sort | .[]' <<<"$1"
}

# Render the required_contexts row: green when the live set equals the declared
# set, else OFF with an explicit +add / -remove breakdown. Bumps OFFTARGET on
# drift and returns 1 (so the caller can set off_here); returns 0 when aligned.
req_contexts_row() { # <live-newline> <declared-newline>
  local live decl livej declj add rem
  live=$(printf '%s\n' "$1" | sed '/^$/d' | sort -u)
  decl=$(printf '%s\n' "$2" | sed '/^$/d' | sort -u)
  livej=$(printf '%s' "$live" | paste -sd, -); declj=$(printf '%s' "$decl" | paste -sd, -)
  if [ "$livej" = "$declj" ]; then
    printf '    %-34s %s\n' "required_contexts" "${C_GRN}ok${C_RST} ${C_DIM}(${livej:-none})${C_RST}"
    return 0
  fi
  OFFTARGET=$((OFFTARGET+1))
  printf '    %-34s %s\n' "required_contexts" "${C_RED}OFF${C_RST}"
  add=$(comm -13 <(printf '%s\n' "$live") <(printf '%s\n' "$decl"))
  rem=$(comm -23 <(printf '%s\n' "$live") <(printf '%s\n' "$decl"))
  [ -n "$add" ] && printf '%s\n' "$add" | sed "s/^/        ${C_GRN}+ require:${C_RST} /"
  [ -n "$rem" ] && printf '%s\n' "$rem" | sed "s/^/        ${C_RED}- drop:${C_RST}    /"
  return 1
}

# The declared required-context list for a repo row, newline-separated (empty =
# not managed for this repo, i.e. `required_contexts` key absent).
declared_contexts() { # <row-json>
  jq -r '(.required_contexts // [])[]' <<<"$1"
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

# ---- merge-queue ruleset (GOL-3051) ----------------------------------------
# GitHub keeps merge-queue settings in their OWN named ruleset, separate from the
# branch-protection surface above — so this leg is independent of a row's
# `system` and runs for `ruleset` and `legacy` repos alike. The canonical target
# keys here are the raw `merge_queue` parameter names (they sit flat under
# `.parameters`), so adding another knob needs no mapping table.
#
# WHY THIS IS MANAGED NOW (GOL-3051): every one of the six repos carried
# check_response_timeout_minutes = 30, while the observed hosted-runner queue
# wait under ordinary multi-agent PR load is 45-90 min. Once the wait exceeds
# that timeout the merge queue is not merely slow, it is NON-FUNCTIONAL — and it
# fails SILENTLY: GitHub removes the entry, nothing turns red, and the PR reverts
# to open + APPROVED + CLEAN, so the next agent reads it as "just needs merging"
# and re-enqueues, burning another full merge_group fan-out against the saturated
# runner pool. AgenticOS PR #814 was dequeued 31m50s after enqueue with its
# required `CI` run still sitting in `queued`. Declaring the value here makes the
# number a reviewable diff and a `--check` row instead of invisible click-ops.

# Read one merge_queue parameter out of a merge-queue ruleset detail JSON.
# Same array-wrap + .[0] trick as the boolean readers so an absent parameter
# renders "unset" rather than being confused with a real falsy value.
mq_current() { # <ruleset-json> <parameter-name>
  jq -r --arg k "$2" "[ .rules[]? | select(.type==\"merge_queue\").parameters[\$k] ] | $_boolstr" <<<"$1"
}

# The declared merge-queue target value for a key, rendered as a string.
mq_target() { # <row-json> <parameter-name>
  jq -r --arg k "$2" '.merge_queue_targets[$k]|tostring' <<<"$1"
}

process_merge_queue() { # <row-json>
  local row="$1" repo rs_name rs_id detail keys k tgt cur off_here=0
  want_merge_queue || return 0
  # A row without `merge_queue_targets` is simply not managed on this surface.
  jq -e 'has("merge_queue_targets")' <<<"$row" >/dev/null || return 0
  repo=$(jq -r '.repo' <<<"$row")
  rs_name=$(jq -r '.merge_queue_ruleset_name' <<<"$CONFIG_JSON")
  echo "  [$repo]  (merge-queue ruleset: $rs_name)"

  rs_id=$(ruleset_id_by_name "$repo" "$rs_name")
  if [ -z "$rs_id" ]; then
    echo "    ${C_RED}ERROR${C_RST}: merge-queue ruleset '$rs_name' not found"
    OFFTARGET=$((OFFTARGET+1)); return 0
  fi
  detail=$(ghapi "/repos/$OWNER/$repo/rulesets/$rs_id")

  keys=$(jq -r '.merge_queue_targets|keys[]' <<<"$row")
  for k in $keys; do
    tgt=$(mq_target "$row" "$k")
    cur=$(mq_current "$detail" "$k")
    local before=$OFFTARGET; row "$k" "$cur" "$tgt"
    [ "$OFFTARGET" -gt "$before" ] && off_here=1
  done

  [ "$MODE" = apply ] || return 0
  [ "$off_here" = 1 ] || { echo "    ${C_GRN}already aligned — no change${C_RST}"; return 0; }

  # Override ONLY the declared merge_queue parameters (`.parameters + $t`); every
  # other parameter — merge_method, grouping_strategy, the entry-count knobs —
  # and every other rule in the ruleset is carried through verbatim. A PUT that
  # dropped merge_method would change how the queue merges, so this must stay a
  # merge and never a replacement.
  local body
  body=$(jq --argjson t "$(jq -c '.merge_queue_targets' <<<"$row")" '
    {name, target, enforcement, bypass_actors, conditions,
     rules: (.rules | map(
       if .type=="merge_queue" then .parameters = (.parameters + $t) else . end))}' <<<"$detail")

  say_write "PUT merge-queue ruleset '$rs_name' ($rs_id) with aligned merge_queue params"
  CHANGES=$((CHANGES+1))
  if [ "$DRY" != 1 ]; then
    printf '%s' "$body" | ghapi --method PUT "/repos/$OWNER/$repo/rulesets/$rs_id" --input - >/dev/null
  fi
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

  # Required-check contexts (GOL-1953) — managed only when the row declares them.
  local manages_ctx="no" declared_ctx="" live_ctx=""
  if jq -e 'has("required_contexts")' <<<"$row" >/dev/null; then
    manages_ctx="yes"
    declared_ctx=$(declared_contexts "$row")
    live_ctx=$(ruleset_required_contexts "$detail")
    req_contexts_row "$live_ctx" "$declared_ctx" || off_here=1
  fi

  # Dormant second-reviewer ruleset — target: deleted.
  local del_name del_id=""
  if [ "$(jq -r '.delete_dormant_reviewer_ruleset // false' <<<"$row")" = "true" ]; then
    del_name=$(jq -r '.dormant_reviewer_ruleset_name' <<<"$CONFIG_JSON")
    del_id=$(ruleset_id_by_name "$repo" "$del_name")
    # Target renders as "absent" once the ruleset is gone so a converged --check
    # paints the row green; "deleted" is only the target while it still exists.
    if [ -n "$del_id" ]; then row "dormant-reviewer-ruleset" "present" "deleted"; off_here=1; else row "dormant-reviewer-ruleset" "absent" "absent"; fi
  fi

  [ "$MODE" = apply ] || return 0
  [ "$off_here" = 1 ] || { echo "    ${C_GRN}already aligned — no change${C_RST}"; return 0; }

  # Build the mutated ruleset PUT body: override only managed pull_request /
  # required_status_checks params, preserve everything else. When required
  # contexts are managed, rebuild the required_status_checks[] array to the
  # declared set — preserving the integration_id pin for any context that
  # already carried one, so we never loosen an app-pinned check (GOL-1819).
  local strict dismiss thread extra ctx_json
  strict=$(target_val "$row" strict)
  dismiss=$(target_val "$row" dismiss_stale_reviews)
  thread=$(target_val "$row" thread_resolution)
  extra=$(target_val "$row" extra_approval_unattributed)
  if [ "$manages_ctx" = yes ]; then ctx_json=$(jq -R . <<<"$declared_ctx" | jq -s 'map(select(.!=""))'); else ctx_json="null"; fi

  local body
  body=$(jq \
    --argjson strict "$strict" --argjson dismiss "$dismiss" \
    --argjson thread "$thread" --argjson extra "$extra" --argjson ctx "$ctx_json" '
    {name, target, enforcement, bypass_actors, conditions,
     rules: (.rules | map(
       if .type=="pull_request" then
         (if $dismiss!=null then .parameters.dismiss_stale_reviews_on_push=$dismiss else . end)
         | (if $thread!=null then .parameters.required_review_thread_resolution=$thread else . end)
         | (if $extra!=null then .parameters.require_extra_approval_for_unattributed_changes=$extra else . end)
       elif .type=="required_status_checks" then
         (if $strict!=null then .parameters.strict_required_status_checks_policy=$strict else . end)
         | (if $ctx!=null then
              (.parameters.required_status_checks) as $cur
              | .parameters.required_status_checks = ($ctx | map(. as $c
                  | (($cur // [])[] | select(.context==$c)) // {context:$c}))
            else . end)
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

  # Surface guard (GOL-2049 regression): a repo declared `legacy` that has since
  # been migrated to a ruleset 404s here. Without this, `gh api` exits nonzero
  # under `set -euo pipefail` and kills the WHOLE run on the first such repo —
  # which is exactly what happened when AgenticOS migrated. Report it as drift
  # with an actionable message instead of taking the tool down.
  local prot
  if ! prot=$(ghapi "/repos/$OWNER/$repo/branches/$branch/protection" 2>/dev/null); then
    echo "    ${C_RED}ERROR${C_RST}: declared system=legacy but '$branch' has no classic branch protection."
    echo "           Surface mismatch — has this repo migrated to a ruleset? Repoint this entry"
    echo "           to system=ruleset + protection_ruleset in .github/merge-policy.json (see //systems)."
    OFFTARGET=$((OFFTARGET+1)); return
  fi

  local keys; keys=$(jq -r '.targets|keys[]' <<<"$row")
  local off_here=0 k tgt cur
  for k in $keys; do
    tgt=$(jq -r ".targets.$k" <<<"$row")
    cur=$(legacy_current "$prot" "$k")
    local before=$OFFTARGET; row "$k" "$cur" "$tgt"
    [ "$OFFTARGET" -gt "$before" ] && off_here=1
  done

  # Required-check contexts (GOL-1953).
  local manages_ctx="no" declared_ctx="" live_ctx=""
  if jq -e 'has("required_contexts")' <<<"$row" >/dev/null; then
    manages_ctx="yes"
    declared_ctx=$(declared_contexts "$row")
    live_ctx=$(legacy_required_contexts "$prot")
    req_contexts_row "$live_ctx" "$declared_ctx" || off_here=1
  fi

  local del_name del_id=""
  if [ "$(jq -r '.delete_dormant_reviewer_ruleset // false' <<<"$row")" = "true" ]; then
    del_name=$(jq -r '.dormant_reviewer_ruleset_name' <<<"$CONFIG_JSON")
    del_id=$(ruleset_id_by_name "$repo" "$del_name")
    # Target renders as "absent" once the ruleset is gone so a converged --check
    # paints the row green; "deleted" is only the target while it still exists.
    if [ -n "$del_id" ]; then row "dormant-reviewer-ruleset" "present" "deleted"; off_here=1; else row "dormant-reviewer-ruleset" "absent" "absent"; fi
  fi

  [ "$MODE" = apply ] || return 0
  [ "$off_here" = 1 ] || { echo "    ${C_GRN}already aligned — no change${C_RST}"; return 0; }

  local strict dismiss thread manages_thread ctx_json default_app="-1"
  strict=$(target_val "$row" strict)
  dismiss=$(target_val "$row" dismiss_stale_reviews)
  thread=$(target_val "$row" thread_resolution)
  manages_thread=$(jq -r 'if (.targets|has("thread_resolution")) then "yes" else "no" end' <<<"$row")
  # New required contexts inherit the app_id shared by the repo's existing
  # Actions checks (unanimous → that id; else -1 = any app). Existing contexts
  # keep their own pin. This never loosens an already-pinned check (GOL-1819).
  if [ "$manages_ctx" = yes ]; then
    default_app=$(jq -r '[.required_status_checks.checks[]?.app_id]|unique|if length==1 then (.[0]|tostring) else "-1" end' <<<"$prot")
    ctx_json=$(jq -R . <<<"$declared_ctx" | jq -s 'map(select(.!=""))')
  else ctx_json="null"; fi

  if [ "$manages_thread" = "yes" ]; then
    # required_conversation_resolution can only be set via the full protection PUT,
    # so reconstruct the whole protection body from current state and override all
    # managed fields in one declarative, idempotent call.
    #
    # required_status_checks is rebuilt as `checks` (context + app_id), NOT the
    # deprecated `contexts` array: `contexts` carries no App binding, so PUTting it
    # would null out the app_id pin on every required check and let any GitHub App
    # satisfy the gate — a real loosening introduced as a side effect of flipping
    # the booleans. `checks[]?` preserves the existing pins verbatim.
    local body
    body=$(jq \
      --argjson strict "$strict" --argjson dismiss "$dismiss" --argjson thread "$thread" \
      --argjson ctx "$ctx_json" --argjson defapp "$default_app" '
      ([.required_status_checks.checks[]? | {context, app_id}]) as $existing
      | ($existing
         | if $ctx==null then .
           else ($ctx | map(. as $c | (($existing[] | select(.context==$c)) // {context:$c, app_id:$defapp}))) end) as $checks
      | {
        required_status_checks: (if .required_status_checks==null then null else
          {strict: (if $strict!=null then $strict else .required_status_checks.strict end),
           checks: $checks} end),
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
    local ctxnote=""; [ "$manages_ctx" = yes ] && ctxnote="/required_contexts"
    say_write "PUT full branch protection on $branch (strict/dismiss/thread_resolution${ctxnote} overridden)"
    CHANGES=$((CHANGES+1))
    [ "$DRY" = 1 ] || printf '%s' "$body" | ghapi --method PUT "/repos/$OWNER/$repo/branches/$branch/protection" --input - >/dev/null
  else
    # Only strict / dismiss / required contexts managed — granular sub-endpoints
    # (smaller blast radius than the full-protection PUT).
    if [ "$strict" != "null" ]; then
      say_write "PATCH required_status_checks.strict=$strict on $branch"
      CHANGES=$((CHANGES+1))
      [ "$DRY" = 1 ] || ghapi --method PATCH "/repos/$OWNER/$repo/branches/$branch/protection/required_status_checks" -F "strict=$strict" >/dev/null
    fi
    if [ "$manages_ctx" = yes ]; then
      # Rebuild the app_id-pinned checks[] to the declared set. `contexts` is
      # intentionally omitted — sending it would null the app_id pins.
      local ckbody
      ckbody=$(jq -n --argjson ctx "$ctx_json" --argjson defapp "$default_app" --argjson cur "$(jq -c '[.required_status_checks.checks[]? | {context, app_id}]' <<<"$prot")" \
        '{checks: ($ctx | map(. as $c | (($cur[] | select(.context==$c)) // {context:$c, app_id:$defapp})))}')
      say_write "PATCH required_status_checks.checks on $branch (declared required_contexts, app_id-pinned)"
      CHANGES=$((CHANGES+1))
      [ "$DRY" = 1 ] || printf '%s' "$ckbody" | ghapi --method PATCH "/repos/$OWNER/$repo/branches/$branch/protection/required_status_checks" --input - >/dev/null
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
  if want_protection; then
    case "$system" in
      ruleset)      process_ruleset_repo "$rowjson" ;;
      legacy)       process_legacy_repo "$rowjson" ;;
      out-of-scope) process_out_of_scope "$rowjson" ;;
      *) echo "  [$repo] unknown system: $system"; OFFTARGET=$((OFFTARGET+1)) ;;
    esac
  fi
  # Merge-queue settings live in a separate ruleset, so this leg is deliberately
  # outside the `system` dispatch (GOL-3051).
  process_merge_queue "$rowjson"
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
    # Merge-queue leg first: it is a different ruleset, so neither the
    # out-of-scope skip nor the legacy-404 `continue` below may mask its drift
    # (GOL-3051).
    if want_merge_queue && jq -e 'has("merge_queue_targets")' <<<"$rowjson" >/dev/null; then
      local mq_name mq_id mq_detail mq_k
      mq_name=$(jq -r '.merge_queue_ruleset_name' <<<"$CONFIG_JSON")
      mq_id=$(ruleset_id_by_name "$repo" "$mq_name")
      if [ -z "$mq_id" ]; then off=$((off+1))
      else
        mq_detail=$(ghapi "/repos/$OWNER/$repo/rulesets/$mq_id")
        for mq_k in $(jq -r '.merge_queue_targets|keys[]' <<<"$rowjson"); do
          [ "$(mq_current "$mq_detail" "$mq_k")" = "$(mq_target "$rowjson" "$mq_k")" ] || off=$((off+1))
        done
      fi
    fi
    # Everything below this line is the protection surface (GOL-3051): skip it
    # wholesale under `--surface merge-queue` so the exit code reflects only the
    # surface the operator asked about. Without this, converging just the
    # merge-queue timeout on a repo whose required_contexts promotion is paused
    # would still exit 1 and read as a failed apply.
    want_protection || continue
    [ "$system" = "out-of-scope" ] && continue
    local keys k tgt cur detail prot rs_id rs_name branch
    keys=$(jq -r '.targets|keys[]' <<<"$rowjson")
    local decl_ctx live_ctx
    if [ "$system" = ruleset ]; then
      rs_name=$(jq -r '.protection_ruleset' <<<"$rowjson")
      rs_id=$(ruleset_id_by_name "$repo" "$rs_name")
      [ -z "$rs_id" ] && { off=$((off+1)); continue; }
      detail=$(ghapi "/repos/$OWNER/$repo/rulesets/$rs_id")
      for k in $keys; do tgt=$(jq -r ".targets.$k" <<<"$rowjson"); cur=$(ruleset_current "$detail" "$k"); [ "$cur" = "$tgt" ] || off=$((off+1)); done
      if jq -e 'has("required_contexts")' <<<"$rowjson" >/dev/null; then
        decl_ctx=$(declared_contexts "$rowjson" | sort -u | paste -sd, -); live_ctx=$(ruleset_required_contexts "$detail" | sort -u | paste -sd, -)
        [ "$decl_ctx" = "$live_ctx" ] || off=$((off+1))
      fi
    else
      branch=$(jq -r '.branch' <<<"$rowjson")
      # Same surface guard as process_legacy_repo — count as drift, never crash.
      prot=$(ghapi "/repos/$OWNER/$repo/branches/$branch/protection" 2>/dev/null) || { off=$((off+1)); continue; }
      for k in $keys; do tgt=$(jq -r ".targets.$k" <<<"$rowjson"); cur=$(legacy_current "$prot" "$k"); [ "$cur" = "$tgt" ] || off=$((off+1)); done
      if jq -e 'has("required_contexts")' <<<"$rowjson" >/dev/null; then
        decl_ctx=$(declared_contexts "$rowjson" | sort -u | paste -sd, -); live_ctx=$(legacy_required_contexts "$prot" | sort -u | paste -sd, -)
        [ "$decl_ctx" = "$live_ctx" ] || off=$((off+1))
      fi
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
