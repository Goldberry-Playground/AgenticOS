#!/usr/bin/env bash
# Offline harness for scripts/ci/merge-group-paths.sh (GOL-3080).
# Auto-gated by the `CI scripts` job in ci.yml (globs scripts/ci/*.test.sh).
# Feeds the changed-file list via $MG_PATHS_FILES so no network is needed.
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/merge-group-paths.sh"
pass=0; fail=0

# run <name> <expected> <files> <pattern>...
run() {
  local name="$1" want="$2" files="$3"; shift 3
  local args=() p
  for p in "$@"; do args+=(--pattern "$p"); done
  local got
  got="$(MG_PATHS_FILES="$files" bash "$SCRIPT" --base b --head h --repo o/r "${args[@]}" 2>/dev/null | tail -1)"
  if [ "$got" = "$want" ]; then
    echo "  ok   $name"; pass=$((pass+1))
  else
    echo "  FAIL $name — want '$want', got '$got'"; fail=$((fail+1))
  fi
}

echo "== pattern semantics"
# `**` crosses directory separators; `*` must not.
run "dir/** matches deep file"      true  $'apps/dashboard/app/page.tsx' 'apps/dashboard/**'
run "dir/** matches direct child"   true  $'apps/dashboard/x.ts'         'apps/dashboard/**'
run "dir/** does not match sibling" false $'apps/hub/x.ts'               'apps/dashboard/**'
run "exact file matches"            true  $'pnpm-lock.yaml'              'pnpm-lock.yaml'
run "exact file is anchored"        false $'apps/pnpm-lock.yaml'         'pnpm-lock.yaml'
run "* does NOT cross a slash"      false $'docs/guide/a.md'             'docs/*.md'
run "* matches within a segment"    true  $'docs/guide.md'               'docs/*.md'
run "** does cross a slash"         true  $'docs/guide/a.md'             'docs/**'
run "? matches one non-slash char"  true  $'a1.ts'                       'a?.ts'
run "? does not match a slash"      false $'a/.ts'                       'a?.ts'
# A literal dot must not become the regex any-char wildcard.
run "dot is literal, not wildcard"  false $'turboXjson'                  'turbo.json'
run "dot matches itself"            true  $'turbo.json'                  'turbo.json'

echo "== matching across a pattern list and a multi-file diff"
run "second pattern can match"      true  $'README.md'                   'apps/**' 'README.md'
run "one file of many matches"      true  $'a.md\npackages/x/y.ts\nb.md' 'packages/**'
run "no file matches any pattern"   false $'README.md\ndocs/x.md'        'apps/dashboard/**' 'pnpm-lock.yaml'
# `dir/**` should also fire on the bare directory entry (submodule/symlink).
run "dir/** matches bare directory" true  $'packages'                    'packages/**'

echo "== fail-open on every ambiguity"
# A wrong 'false' silently skips a gate, so anything unclear must yield 'true'.
got="$(MG_PATHS_FILES='x.ts' bash "$SCRIPT" --base b --head h --repo o/r 2>/dev/null | tail -1)"
[ "$got" = true ] && { echo "  ok   no --pattern → true"; pass=$((pass+1)); } \
                  || { echo "  FAIL no --pattern → got '$got'"; fail=$((fail+1)); }

for missing in "--head h" "--base b"; do
  got="$(unset GH_TOKEN GITHUB_TOKEN; bash "$SCRIPT" $missing --repo o/r --pattern 'a/**' 2>/dev/null | tail -1)"
  [ "$got" = true ] && { echo "  ok   missing sha ($missing) → true"; pass=$((pass+1)); } \
                    || { echo "  FAIL missing sha ($missing) → got '$got'"; fail=$((fail+1)); }
done

got="$(unset GH_TOKEN GITHUB_TOKEN GITHUB_REPOSITORY; bash "$SCRIPT" --base b --head h --pattern 'a/**' 2>/dev/null | tail -1)"
[ "$got" = true ] && { echo "  ok   no repo → true"; pass=$((pass+1)); } \
                  || { echo "  FAIL no repo → got '$got'"; fail=$((fail+1)); }

got="$(unset GH_TOKEN GITHUB_TOKEN; bash "$SCRIPT" --base b --head h --repo o/r --pattern 'a/**' 2>/dev/null | tail -1)"
[ "$got" = true ] && { echo "  ok   no token → true"; pass=$((pass+1)); } \
                  || { echo "  FAIL no token → got '$got'"; fail=$((fail+1)); }

got="$(MG_PATHS_FILES='x.ts' bash "$SCRIPT" --bogus-flag 2>/dev/null | tail -1)"
[ "$got" = true ] && { echo "  ok   unknown flag → true"; pass=$((pass+1)); } \
                  || { echo "  FAIL unknown flag → got '$got'"; fail=$((fail+1)); }

echo "== an empty diff is a real 'false', not an ambiguity"
got="$(MG_PATHS_FILES=' ' bash "$SCRIPT" --base b --head h --repo o/r --pattern 'a/**' 2>/dev/null | tail -1)"
[ "$got" = false ] && { echo "  ok   empty diff → false"; pass=$((pass+1)); } \
                   || { echo "  FAIL empty diff → got '$got'"; fail=$((fail+1)); }

echo "== **/ means zero or more directories"
run "**/ matches at the root"        true  $'a.ts'                        '**/*.ts'
run "**/ matches nested"             true  $'pkg/src/a.ts'                '**/*.ts'
run "a/**/b matches a/b"             true  $'a/b'                         'a/**/b'
run "a/**/b matches a/x/y/b"         true  $'a/x/y/b'                     'a/**/b'

echo "== the live workflow filters this is wired into"
# e2e.yml — mirrors the `paths:` on its own pull_request leg, verbatim.
E2E=('apps/dashboard/**' 'packages/**' 'pnpm-lock.yaml' 'package.json' 'turbo.json' '.github/workflows/e2e.yml')
run "e2e: dashboard change"   true  $'apps/dashboard/app/page.tsx' "${E2E[@]}"
run "e2e: shared package"     true  $'packages/core/src/a.ts'      "${E2E[@]}"
run "e2e: lockfile change"    true  $'pnpm-lock.yaml'              "${E2E[@]}"
run "e2e: own workflow edit"  true  $'.github/workflows/e2e.yml'   "${E2E[@]}"
run "e2e: infra-only entry"   false $'infra/terraform/main.tf'     "${E2E[@]}"
run "e2e: docs-only entry"    false $'docs/a.md\nREADME.md'        "${E2E[@]}"
# A near-miss that must NOT skip: `packages/**` has to beat an exact-name trap.
run "e2e: packages dir only"  true  $'packages'                    "${E2E[@]}"

# decompose-test.yml — mirrors the `paths:` on its own pull_request leg.
DEC=('scripts/decompose.py' 'scripts/tests/**' '.github/workflows/decompose-test.yml')
run "dec: the script itself"  true  $'scripts/decompose.py'        "${DEC[@]}"
run "dec: a fixture"          true  $'scripts/tests/fixtures/x.yml' "${DEC[@]}"
run "dec: own workflow edit"  true  $'.github/workflows/decompose-test.yml' "${DEC[@]}"
run "dec: other script"       false $'scripts/ci/other.sh'         "${DEC[@]}"
run "dec: dashboard-only"     false $'apps/dashboard/app/page.tsx' "${DEC[@]}"
# `scripts/decompose.py` is an exact pattern: a same-prefix file must not match.
run "dec: decompose_util.py"  false $'scripts/decompose_util.py'   "${DEC[@]}"

echo
echo "merge-group-paths: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
