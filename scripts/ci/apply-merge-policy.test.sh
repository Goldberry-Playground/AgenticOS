#!/usr/bin/env bash
#
# apply-merge-policy.test.sh — offline idempotency + write-path harness for
# apply-merge-policy.sh (GOL-1819). No network, no live repos: a stubbed `gh`
# serves JSON fixtures and mutates them on writes, so we can prove end-to-end that
#   1. --check reports drift and exits non-zero,
#   2. --apply converges every write path (ruleset PUT, legacy full PUT, legacy
#      granular PATCH, dormant-ruleset DELETE),
#   3. a second --apply reports ZERO changes (idempotent),
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
      v=$(kv strict); jq ".required_status_checks.strict = ($v)" "$pf" >"$FIX/.t" && mv "$FIX/.t" "$pf"
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
{ "required_status_checks":{"strict":true,"contexts":["Lint","Build"]},
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
     "delete_dormant_reviewer_ruleset":true},
    {"repo":"legacy-thread","system":"legacy","branch":"4.x",
     "targets":{"strict":false,"dismiss_stale_reviews":false,"thread_resolution":false},
     "delete_dormant_reviewer_ruleset":true},
    {"repo":"legacy-strict","system":"legacy","branch":"main",
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

echo "### 4. --check again (expect exit 0, aligned)"
run --check >/dev/null 2>&1 || fail "--check should pass after apply"
echo "    ok: no drift"

echo "### 5. --apply again (expect exit 0 and ZERO new writes — idempotent)"
: >"$FAKE_GH_CALLS"
run --apply >/dev/null 2>&1 || fail "second --apply should exit 0"
n2=$(wc -l <"$FAKE_GH_CALLS")
[ "$n2" -eq 0 ] || { echo "second apply wrote:"; cat "$FAKE_GH_CALLS"; fail "second --apply must make zero writes"; }
echo "    ok: second apply made zero writes"

echo
echo "PASS — check/apply/idempotency verified across ruleset PUT, legacy full-PUT, legacy granular PATCH, and dormant-ruleset DELETE."
