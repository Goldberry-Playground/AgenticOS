#!/usr/bin/env bash
# Tests for the bounded reclaim in infra/scripts/paperclip-volume-guard.sh
# (GOL-1632). The reclaim deletes files, so it gets a test that pins exactly
# which files it may and may not touch.
#
# The guard is driven entirely through env overrides here:
#   PAPERCLIP_DATA_DIR  — stand in for the docker volume mountpoint (no docker)
#   ENV_FILE=/dev/null  — no webhook URL ⇒ post_discord is a no-op
#   RECLAIM_PCT=0/101   — force Tier B on / off without controlling real df
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="${REPO_ROOT}/infra/scripts/paperclip-volume-guard.sh"
FAILED=0

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; FAILED=1; }

check_present() { # $1 = dir, rest = filenames that MUST still exist
  local d="$1"; shift
  for f in "$@"; do
    if [ -e "${d}/${f}" ]; then pass "kept ${f}"; else fail "expected ${f} to be KEPT, it was deleted"; fi
  done
}
check_absent() { # $1 = dir, rest = filenames that MUST be gone
  local d="$1"; shift
  for f in "$@"; do
    if [ -e "${d}/${f}" ]; then fail "expected ${f} to be RECLAIMED, it is still there"; else pass "reclaimed ${f}"; fi
  done
}

new_fixture() { # echoes the mount root; creates <root>/instances/default/data/backups
  local root; root="$(mktemp -d)"
  mkdir -p "${root}/instances/default/data/backups"
  echo "${root}"
}

run_guard() { # env overrides come from the caller
  PAPERCLIP_DATA_DIR="$1" \
  ENV_FILE=/dev/null \
  STAMP_DIR="$1/.stamps" \
  "${GUARD}" >"$1/.out" 2>&1
  local rc=$?
  if [ "${rc}" -ne 0 ]; then
    fail "guard exited ${rc}"; sed 's/^/      | /' "$1/.out" >&2
  fi
  return 0
}

echo "== Tier A: orphaned partial dumps =="
ROOT="$(new_fixture)"; B="${ROOT}/instances/default/data/backups"
printf -- '-- Paperclip database backup\nCOPY x FROM stdin;\n1\t2\t3' > "${B}/paperclip-20260910-005011.sql"
printf -- '-- Paperclip database backup\nCOMMIT;\n'                    > "${B}/paperclip-20260911-005011.sql"
printf -- '-- Paperclip database backup\nCOMMIT;\n'                    > "${B}/paperclip-20260912-005011.sql"
printf 'gz'                                                            > "${B}/paperclip-20260912-005011.sql.gz"
printf -- '-- in flight, no commit yet\n'                              > "${B}/paperclip-20260930-235959.sql"
touch -d '2026-09-10 00:50' "${B}/paperclip-20260910-005011.sql"
touch -d '2026-09-11 00:50' "${B}/paperclip-20260911-005011.sql"
touch -d '2026-09-12 00:50' "${B}/paperclip-20260912-005011.sql" "${B}/paperclip-20260912-005011.sql.gz"
# fresh .sql keeps "now" as its mtime
RECLAIM_PCT=101 run_guard "${ROOT}"
check_absent  "${B}" paperclip-20260910-005011.sql paperclip-20260912-005011.sql
check_present "${B}" paperclip-20260911-005011.sql paperclip-20260930-235959.sql paperclip-20260912-005011.sql.gz
grep -q 'ending in COMMIT; (looks complete' "${ROOT}/.out" \
  && pass "logged why the complete .sql was spared" \
  || fail "no log line explaining the spared complete .sql"
grep -q 'may be a dump in flight' "${ROOT}/.out" \
  && pass "logged why the fresh .sql was spared" \
  || fail "no log line explaining the spared in-flight .sql"
rm -rf "${ROOT}"

echo "== Tier A runs below RECLAIM_PCT, Tier B does not =="
ROOT="$(new_fixture)"; B="${ROOT}/instances/default/data/backups"
for s in 20260101-000000 20260101-060000 20260101-120000 20260102-000000; do
  printf 'gz' > "${B}/paperclip-${s}.sql.gz"; touch -d "${s:0:4}-${s:4:2}-${s:6:2} ${s:9:2}:00" "${B}/paperclip-${s}.sql.gz"
done
RECLAIM_PCT=101 run_guard "${ROOT}"
check_present "${B}" paperclip-20260101-000000.sql.gz paperclip-20260101-060000.sql.gz \
                     paperclip-20260101-120000.sql.gz paperclip-20260102-000000.sql.gz
rm -rf "${ROOT}"

echo "== Tier B: keep newest 2 + newest per day =="
ROOT="$(new_fixture)"; B="${ROOT}/instances/default/data/backups"
declare -a STAMPS=(
  "20260103-180000" "20260103-120000" "20260103-060000"
  "20260102-180000" "20260102-120000" "20260102-060000"
  "20260101-180000" "20260101-060000"
)
for s in "${STAMPS[@]}"; do
  printf 'gz' > "${B}/paperclip-${s}.sql.gz"
  touch -d "${s:0:4}-${s:4:2}-${s:6:2} ${s:9:2}:${s:11:2}" "${B}/paperclip-${s}.sql.gz"
done
RECLAIM_PCT=0 run_guard "${ROOT}"
check_present "${B}" paperclip-20260103-180000.sql.gz paperclip-20260103-120000.sql.gz \
                     paperclip-20260102-180000.sql.gz paperclip-20260101-180000.sql.gz
check_absent  "${B}" paperclip-20260103-060000.sql.gz paperclip-20260102-120000.sql.gz \
                     paperclip-20260102-060000.sql.gz paperclip-20260101-060000.sql.gz
rm -rf "${ROOT}"

echo "== Tier B respects MIN_KEEP =="
ROOT="$(new_fixture)"; B="${ROOT}/instances/default/data/backups"
for s in 20260105-180000 20260105-120000 20260105-060000; do
  printf 'gz' > "${B}/paperclip-${s}.sql.gz"; touch -d "2026-01-05 ${s:9:2}:00" "${B}/paperclip-${s}.sql.gz"
done
RECLAIM_PCT=0 run_guard "${ROOT}"
check_present "${B}" paperclip-20260105-180000.sql.gz paperclip-20260105-120000.sql.gz paperclip-20260105-060000.sql.gz
rm -rf "${ROOT}"

echo "== DRY_RUN=1 deletes nothing =="
ROOT="$(new_fixture)"; B="${ROOT}/instances/default/data/backups"
printf 'no commit here' > "${B}/paperclip-20260110-000000.sql"; touch -d '2026-01-10 00:00' "${B}/paperclip-20260110-000000.sql"
for s in 20260110-180000 20260110-120000 20260110-060000 20260111-060000; do
  printf 'gz' > "${B}/paperclip-${s}.sql.gz"; touch -d "${s:0:4}-${s:4:2}-${s:6:2} ${s:9:2}:00" "${B}/paperclip-${s}.sql.gz"
done
DRY_RUN=1 RECLAIM_PCT=0 run_guard "${ROOT}"
check_present "${B}" paperclip-20260110-000000.sql paperclip-20260110-180000.sql.gz \
                     paperclip-20260110-120000.sql.gz paperclip-20260110-060000.sql.gz paperclip-20260111-060000.sql.gz
grep -q 'DRY_RUN would reclaim' "${ROOT}/.out" && pass "DRY_RUN logged intent" || fail "DRY_RUN logged nothing"
rm -rf "${ROOT}"

echo "== RECLAIM=0 disables both tiers =="
ROOT="$(new_fixture)"; B="${ROOT}/instances/default/data/backups"
printf 'no commit here' > "${B}/paperclip-20260115-000000.sql"; touch -d '2026-01-15 00:00' "${B}/paperclip-20260115-000000.sql"
for s in 20260115-180000 20260115-120000 20260115-060000 20260116-060000; do
  printf 'gz' > "${B}/paperclip-${s}.sql.gz"; touch -d "${s:0:4}-${s:4:2}-${s:6:2} ${s:9:2}:00" "${B}/paperclip-${s}.sql.gz"
done
RECLAIM=0 RECLAIM_PCT=0 run_guard "${ROOT}"
check_present "${B}" paperclip-20260115-000000.sql paperclip-20260115-180000.sql.gz \
                     paperclip-20260115-120000.sql.gz paperclip-20260115-060000.sql.gz paperclip-20260116-060000.sql.gz
grep -q 'RECLAIM=0' "${ROOT}/.out" && pass "logged that reclaim is off" || fail "no RECLAIM=0 log line"
rm -rf "${ROOT}"

echo "== Tier B buckets by the filename stamp, not by mtime =="
# A late-evening local dump reads back as the NEXT day in UTC. Bucketing on
# mtime would fold it into the following day and delete it as a duplicate;
# bucketing on the server's own filename stamp keeps it. MIN_KEEP=2 so the
# floor cannot mask the difference.
ROOT="$(new_fixture)"; B="${ROOT}/instances/default/data/backups"
printf 'gz' > "${B}/paperclip-20260221-180000.sql.gz"; touch -d '2026-02-21 18:00' "${B}/paperclip-20260221-180000.sql.gz"
printf 'gz' > "${B}/paperclip-20260221-120000.sql.gz"; touch -d '2026-02-21 12:00' "${B}/paperclip-20260221-120000.sql.gz"
printf 'gz' > "${B}/paperclip-20260221-060000.sql.gz"; touch -d '2026-02-21 06:00' "${B}/paperclip-20260221-060000.sql.gz"
printf 'gz' > "${B}/paperclip-20260220-230000.sql.gz"; touch -d '2026-02-21 04:00' "${B}/paperclip-20260220-230000.sql.gz"
MIN_KEEP=2 RECLAIM_PCT=0 run_guard "${ROOT}"
check_present "${B}" paperclip-20260221-180000.sql.gz paperclip-20260221-120000.sql.gz paperclip-20260220-230000.sql.gz
check_absent  "${B}" paperclip-20260221-060000.sql.gz
rm -rf "${ROOT}"

echo "== empty / fresh box is a no-op =="
ROOT="$(new_fixture)"
RECLAIM_PCT=0 run_guard "${ROOT}"
grep -q 'nothing to reclaim' "${ROOT}/.out" && pass "no-op on an empty backups dir" || fail "expected 'nothing to reclaim'"
rm -rf "${ROOT}"

if [ "${FAILED}" -ne 0 ]; then echo "FAIL: paperclip-volume-guard reclaim tests" >&2; exit 1; fi
echo "PASS: paperclip-volume-guard reclaim tests"
