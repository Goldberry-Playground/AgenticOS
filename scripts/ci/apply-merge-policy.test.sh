#!/usr/bin/env bash
#
# apply-merge-policy.test.sh — offline idempotency + write-path harness for
# apply-merge-policy.sh (GOL-1819). No network, no live repos: a stubbed `gh`
# serves JSON fixtures and mutates them on writes, so we can prove end-to-end that
#   1. --check reports drift and exits non-zero,
#   2. --apply converges every write path (ruleset PUT, legacy full PUT, legacy
#      granular PATCH, dormant-ruleset DELETE),
#   3. a second --apply reports ZERO changes (idempotent),
#   4. a repo declared system=legacy that has migrated to a ruleset (404 on classic
#      branch protection) is surfaced as drift, not a crash (GOL-2049 guard),
# without ever touching a board-gated production setting.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/apply-merge-policy.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FIX="$WORK/fix"; mkdir -p "$FIX"
export FAKE_GH_FIX="$FIX"
export FAKE_GH_CALLS="$WORK/calls.log"
: >"$FAKE_GH_CALLS"

# --- stubbed gh -------------------------------------------------------------
cat >"$WORK/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
FIX="$FAKE_GH_FIX"; CALLS="$FAKE_GH_CALLS"
[ "${1:-}" = api ] || { echo "fake gh supports only 'api': $*" >&2; exit 99; }
shift
method=GET path=""; jqf=""; input=""; declare -a F=()
while [ $# -gt 0 ]; do
  case "$1" in
    -H) shift ;;
    --method|-X) method="$2"; shift ;;
    --jq|-q) jqf="$2"; shift ;;
    --input) input="$2"; shift ;;
    -F|-f) F+=("$2"); shift ;;
    -*) ;;                       # ignore other flags
    *) path="$1" ;;
  esac
  shift
done
# path: /repos/OWNER/REPO/<rest...>
IFS='/' read -r _ _ owner repo r1 r2 r3 <<<"$path"
emit(){ if [ -n "$jqf" ]; then jq -r "$jqf" "$1"; else cat "$1"; fi; }
if [ "$method" = GET ]; then
  case "$r1/$r2" in
    rulesets/)  emit "$FIX/rulesets_$repo.json" ;;              # list
    rulesets/*) emit "$FIX/ruleset_$r2.json" ;;                 # detail by id
    branches/*) emit "$FIX/protection_${repo}_$r2.json" ;;      # branch protection (r3=protection)
    *) echo "fake gh: unhandled GET $path" >&2; exit 98 ;;
  esac
  exit 0
fi
# --- writes: record then converge fixture state ---
echo "$method $path ${F[*]:-}" >>"$CALLS"
tmp="$WORK_TMP"; mkdir -p "$FIX"
case "$method:$r1" in
  PUT:rulesets)
    # r2 = id; body on stdin is the new ruleset (name/rules/...). Store as detail.
    cat >"$FIX/ruleset_$r2.json" ;;
  DELETE:rulesets)
    jq "map(select(.id != ($r2|tonumber)))" "$FIX/rulesets_$repo.json" >"$FIX/.t" && mv "$FIX/.t" "$FIX/rulesets_$repo.json" ;;
  PATCH:branches)
    # r3=protection, r4 not parsed; distinguish by sub-resource in path tail
    sub="${path##*/protection/}"
    kv(){ for x in "${F[@]}"; do case "$x" in $1=*) echo "${x#*=}";; esac; done; }
    pf="$FIX/protection_${repo}_$r2.json"
    if [ "$sub" = "required_status_checks" ]; then
      if [ -n "$input" ]; then
        # JSON body on stdin, e.g. {"checks":[{"context":..,"app_id":..}]} (GOL-1953).
        body=$(cat); jq --argjson b "$body" '.required_status_checks.checks = $b.checks' "$pf" >"$FIX/.t" && mv "$FIX/.t" "$pf"
      else
        v=$(kv strict); jq ".required_status_checks.strict = ($v)" "$pf" >"$FIX/.t" && mv "$FIX/.t" "$pf"
      fi
    elif [ "$sub" = "required_pull_request_reviews" ]; then
      v=$(kv dismiss_stale_reviews); jq ".required_pull_request_reviews.dismiss_stale_reviews = ($v)" "$pf" >"$FIX/.t" && mv "$FIX/.t" "$pf"
    fi ;;
  PUT:branches)
    # Full protection PUT: body uses PUT schema (bools). Translate the fields our
    # reader consumes back into GET shape ({enabled:...}) and store.
    pf="$FIX/protection_${repo}_$r2.json"
    jq '
      .required_conversation_resolution = {enabled: (.required_conversation_resolution // false)}
      | .enforce_admins = {enabled: (.enforce_admins // false)}
    ' >"$pf" ;;
  *) echo "fake gh: unhandled write $method $path" >&2; exit 97 ;;
esac
exit 0
GH
chmod +x "$WORK/gh"
export WORK_TMP="$WORK/tmp"
export PATH="$WORK:$PATH"
export GH_TOKEN="fake"

# --- fixtures (OFF-TARGET starting state) -----------------------------------
# ruleset repo
cat >"$FIX/rulesets_rs-repo.json" <<'J'
[ {"id":100,"name":"main-branch-protection","enforcement":"active"},
  {"id":900,"name":"Code Quality Copilot review for default branch","enforcement":"disabled"},
  {"id":200,"name":"merge-queue","enforcement":"active"} ]
J
cat >"$FIX/ruleset_100.json" <<'J'
{ "id":100,"name":"main-branch-protection","target":"branch","enforcement":"active",
  "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],
  "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
  "rules":[
    {"type":"pull_request","parameters":{"required_approving_review_count":1,"dismiss_stale_reviews_on_push":true,"require_code_owner_review":false,"required_review_thread_resolution":true,"require_extra_approval_for_unattributed_changes":true,"require_last_push_approval":false,"allowed_merge_methods":["squash"]}},
    {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":[{"context":"Build"}]}},
    {"type":"merge_queue","parameters":{}}
  ] }
J
# legacy repo WITH thread resolution (full-PUT path)
cat >"$FIX/rulesets_legacy-thread.json" <<'J'
[ {"id":901,"name":"Code Quality Copilot review for default branch","enforcement":"disabled"} ]
J
# NOTE: live branch protection returns `checks` with an `app_id` binding (and a
# deprecated `contexts` mirror). The full-PUT reconstruction must preserve the
# app_id pin — re-PUTting `contexts` would null it out and let any App satisfy
# the gate (GOL-1819 review defect). Fixture carries both shapes, app_id=15368.
cat >"$FIX/protection_legacy-thread_4.x.json" <<'J'
{ "required_status_checks":{"strict":true,"contexts":["A","B"],"checks":[{"context":"A","app_id":15368},{"context":"B","app_id":15368}]},
  "enforce_admins":{"enabled":false},
  "required_pull_request_reviews":{"dismiss_stale_reviews":true,"require_code_owner_reviews":false,"required_approving_review_count":0,"require_last_push_approval":false},
  "restrictions":{"users":[{"login":"josh"}],"teams":[],"apps":[]},
  "required_linear_history":{"enabled":false},"allow_force_pushes":{"enabled":false},
  "allow_deletions":{"enabled":false},"block_creations":{"enabled":false},
  "required_conversation_resolution":{"enabled":true},"lock_branch":{"enabled":false},
  "allow_fork_syncing":{"enabled":false} }
J
# legacy repo strict-ONLY (granular PATCH path, no PR reviews)
cat >"$FIX/rulesets_legacy-strict.json" <<'J'
[]
J
cat >"$FIX/protection_legacy-strict_main.json" <<'J'
{ "required_status_checks":{"strict":true,"contexts":["Lint","Build"],"checks":[{"context":"Lint","app_id":15368},{"context":"Build","app_id":15368}]},
  "enforce_admins":{"enabled":true},
  "required_pull_request_reviews":null,
  "required_conversation_resolution":{"enabled":false} }
J

# --- test config ------------------------------------------------------------
cat >"$WORK/merge-policy.json" <<'J'
{ "dormant_reviewer_ruleset_name":"Code Quality Copilot review for default branch",
  "repos":[
    {"repo":"rs-repo","system":"ruleset","protection_ruleset":"main-branch-protection",
     "targets":{"strict":false,"dismiss_stale_reviews":false,"thread_resolution":false,"extra_approval_unattributed":false},
     "required_contexts":["Build","New guard"],
     "delete_dormant_reviewer_ruleset":true},
    {"repo":"legacy-thread","system":"legacy","branch":"4.x",
     "targets":{"strict":false,"dismiss_stale_reviews":false,"thread_resolution":false},
     "delete_dormant_reviewer_ruleset":true},
    {"repo":"legacy-strict","system":"legacy","branch":"main",
     "required_contexts":["Build","Lint","New legacy guard"],
     "targets":{"strict":false}}
  ] }
J

run(){ "$SCRIPT" --config "$WORK/merge-policy.json" "$@"; }
fail(){ echo "FAIL: $1" >&2; exit 1; }

echo "### 1. --check on off-target fixtures (expect drift, exit 1)"
if run --check >/dev/null 2>&1; then fail "--check should exit non-zero on drift"; fi
echo "    ok: exited non-zero"

echo "### 2. --apply --dry-run (expect exit 0, no fixtures mutated, no writes logged)"
run --apply --dry-run >/dev/null 2>&1 || fail "--dry-run should exit 0"
[ ! -s "$FAKE_GH_CALLS" ] || fail "--dry-run must not record writes"
echo "    ok: dry-run made zero writes"

echo "### 3. --apply (converge). expect exit 0 and writes recorded"
run --apply >/dev/null 2>&1 || fail "--apply should exit 0"
n1=$(wc -l <"$FAKE_GH_CALLS")
[ "$n1" -gt 0 ] || fail "--apply must record writes on off-target state"
echo "    ok: $n1 write call(s) recorded:"
sed 's/^/      /' "$FAKE_GH_CALLS"

echo "### 3a. legacy full-PUT preserves app_id pin on every required check"
ptc="$FIX/protection_legacy-thread_4.x.json"
# After the full PUT the stored protection must still carry a checks[] array with
# a non-null app_id on every context (the GOL-1819 review defect: reconstructing
# `contexts` instead of `checks` nulled these out, loosening the gate).
nchecks=$(jq '.required_status_checks.checks | length' "$ptc")
[ "$nchecks" -eq 2 ] || fail "expected 2 required checks preserved, got $nchecks"
unpinned=$(jq '[.required_status_checks.checks[] | select(.app_id == null)] | length' "$ptc")
[ "$unpinned" -eq 0 ] || fail "$unpinned required check(s) lost their app_id pin"
allpinned=$(jq '[.required_status_checks.checks[] | select(.app_id == 15368)] | length' "$ptc")
[ "$allpinned" -eq 2 ] || fail "expected app_id=15368 on both checks, got $allpinned"
echo "    ok: both required checks still pinned to app_id=15368"

echo "### 3b. ruleset required_contexts converged to the declared set (GOL-1953)"
rsc=$(jq -r '[.rules[]|select(.type=="required_status_checks").parameters.required_status_checks[].context]|sort|join(",")' "$FIX/ruleset_100.json")
[ "$rsc" = "Build,New guard" ] || fail "ruleset required contexts = [$rsc], expected [Build,New guard]"
echo "    ok: ruleset required_status_checks = [$rsc]"

echo "### 3c. legacy granular required_contexts set with app_id-pinned checks (GOL-1953)"
lsc=$(jq -r '[.required_status_checks.checks[].context]|sort|join(",")' "$FIX/protection_legacy-strict_main.json")
[ "$lsc" = "Build,Lint,New legacy guard" ] || fail "legacy required contexts = [$lsc]"
newpin=$(jq -r '.required_status_checks.checks[]|select(.context=="New legacy guard").app_id' "$FIX/protection_legacy-strict_main.json")
[ "$newpin" = "15368" ] || fail "new legacy context app_id=$newpin, expected 15368 (inherited from existing checks)"
echo "    ok: legacy checks = [$lsc], new context pinned to app_id=$newpin"

echo "### 4. --check again (expect exit 0, aligned)"
run --check >/dev/null 2>&1 || fail "--check should pass after apply"
echo "    ok: no drift"

echo "### 4a. converged --check emits ZERO 'OFF' rows (display matches summary)"
# The exit code alone (test #4) missed a display defect: a deleted dormant ruleset
# rendered its row as 'absent -> deleted' = OFF even though summary() counted it
# on-target. Assert no row is painted OFF once converged, so the per-row table can
# never contradict the green summary line.
chk4a="$(run --check 2>&1)"
offrows=$(printf '%s\n' "$chk4a" | grep -c -w 'OFF' || true)
[ "$offrows" -eq 0 ] || { printf '%s\n' "$chk4a" | grep -w 'OFF'; fail "converged --check printed $offrows OFF row(s)"; }
echo "    ok: zero OFF rows on a converged fleet"

echo "### 5. --apply again (expect exit 0 and ZERO new writes — idempotent)"
: >"$FAKE_GH_CALLS"
run --apply >/dev/null 2>&1 || fail "second --apply should exit 0"
n2=$(wc -l <"$FAKE_GH_CALLS")
[ "$n2" -eq 0 ] || { echo "second apply wrote:"; cat "$FAKE_GH_CALLS"; fail "second --apply must make zero writes"; }
echo "    ok: second apply made zero writes"

echo "### 6. legacy repo migrated to a ruleset (404 on classic protection) — GOL-2049/GOL-2105"
# Regression for the surface guard added in AgenticOS#666. A repo declared
# system=legacy that has since migrated to a ruleset makes GitHub's classic
# branch-protection endpoint 404. Before the guard, `gh api` exited non-zero under
# `set -euo pipefail` and killed the WHOLE run on the FIRST such repo — the GOL-2049
# tool-down. Assert the run instead: (a) reports the repo as OFFTARGET drift and
# still exits, (b) prints the actionable surface-mismatch message, and (c) keeps
# processing the remaining repos in BOTH the display loop and summary().
#
# Own config + fixtures so the permanent 404 never perturbs the convergence
# assertions above (#4/#4a/#5). The stub 404s by simply having no
# protection_<repo>_<branch>.json fixture: its GET falls through to `cat` on a
# missing file, which exits non-zero — a faithful stand-in for the 404 the guard
# is written against. `migrated-legacy` is listed FIRST so the healthy repo's
# section AND the final summary line only appear if NEITHER loop aborted on it.
#
# migrated-legacy also declares `required_contexts` on purpose: it is what pins
# the summary() leg's guard specifically. `OFF=$(summary)` runs in a command
# substitution, where bash disables errexit — so a missing summary guard would
# NOT crash; it would silently leave `prot` empty and then run legacy_current /
# legacy_required_contexts against that empty JSON. With the guard, summary()
# short-circuits to a single off++ and `continue` (drift == 1). Without it, the
# empty-prot contexts comparison fires a SECOND off++ (drift == 2) — so the
# `drift: 1` assertion below fails iff the summary() guard is removed, which is
# how this case genuinely covers that leg and not just process_legacy_repo's.
GUARD_CFG="$WORK/merge-policy-guard.json"
cat >"$GUARD_CFG" <<'J'
{ "dormant_reviewer_ruleset_name":"Code Quality Copilot review for default branch",
  "repos":[
    {"repo":"migrated-legacy","system":"legacy","branch":"main",
     "targets":{"strict":false},"required_contexts":["Build"]},
    {"repo":"healthy-legacy","system":"legacy","branch":"main",
     "targets":{"strict":false}}
  ] }
J
# healthy-legacy is present and already on-target (strict=false); migrated-legacy
# has NO fixture on purpose — that absence IS the 404.
cat >"$FIX/protection_healthy-legacy_main.json" <<'J'
{ "required_status_checks":{"strict":false,"contexts":[],"checks":[]},
  "enforce_admins":{"enabled":false},
  "required_pull_request_reviews":null,
  "required_conversation_resolution":{"enabled":false} }
J

if guard_out="$("$SCRIPT" --config "$GUARD_CFG" --check 2>&1)"; then guard_rc=0; else guard_rc=$?; fi
# (a) drift → non-zero exit. off-count is exactly 1: the migrated repo declares
#     strict + required_contexts, but the summary() guard short-circuits to ONE
#     off++ and `continue` before either is compared, and the healthy repo
#     contributes 0. A missing summary guard would instead compare both against an
#     empty protection and report `drift: 2` — so this line pins the summary leg's
#     off++/continue (see the config comment above).
[ "$guard_rc" -ne 0 ] || { printf '%s\n' "$guard_out"; fail "migrated legacy repo should make --check exit non-zero"; }
printf '%s\n' "$guard_out" | grep -q 'drift: 1 setting(s) off-target' \
  || { printf '%s\n' "$guard_out"; fail "expected summary to count exactly the migrated repo as drift (summary leg off++ / loop continues)"; }
# (b) actionable surface-mismatch message from the process_legacy_repo guard.
printf '%s\n' "$guard_out" | grep -q "no classic branch protection" \
  || { printf '%s\n' "$guard_out"; fail "expected surface-mismatch ERROR for the migrated legacy repo"; }
# (c) the display loop continued PAST the migrated repo to the healthy one — had the
#     404 aborted the run, this section would never have printed.
printf '%s\n' "$guard_out" | grep -q '\[healthy-legacy\]' \
  || { printf '%s\n' "$guard_out"; fail "run aborted on the migrated repo — remaining repos were not processed"; }
echo "    ok: 404 surfaced as drift, message shown, remaining repos still processed (display + summary)"

echo
echo "PASS — check/apply/idempotency verified across ruleset PUT, legacy full-PUT, legacy granular PATCH, dormant-ruleset DELETE, and the legacy→ruleset surface guard (GOL-2049)."
