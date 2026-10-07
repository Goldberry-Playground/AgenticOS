#!/usr/bin/env bash
# Offline harness for infra/scripts/paperclip-db-catchup.sh (GOL-2858).
#
# Runs the REAL script with `docker` stubbed on PATH and a fake paperclip-data
# tree, so the freshness decision, the headroom gates, the completeness gate and
# the atomic publish are all exercised without a droplet, a DB or docker.
#
#   bash scripts/ci/paperclip-db-catchup.test.sh
#
# Gated by the CI "CI scripts" job, which runs every scripts/ci/*.test.sh — the
# same home as the off-box shipper's harness (paperclip-backup-offsite.test.sh).
#
# The stub understands the three docker calls the script makes:
#   docker inspect <server> --format ...   → the interval env line
#   docker volume inspect / volume ls      → never reached (PAPERCLIP_DATA_DIR set)
#   docker compose ... exec -T <db> pg_dump → STUB_DUMP_MODE decides the payload
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${REPO_ROOT}/infra/scripts/paperclip-db-catchup.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   — $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL — $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1: expected '$3', got '$2'"; fi; }
want()  { if grep -q "$1" <<<"${OUTPUT}"; then ok "$2"; else bad "$2 — got: ${OUTPUT}"; fi; }

# --- docker stub -------------------------------------------------------------
mkdir -p "${WORK}/bin"
cat >"${WORK}/bin/docker" <<'STUB'
#!/usr/bin/env bash
# args: inspect ... | compose -f X exec -T db pg_dump -U u name
case "$1" in
  inspect)
    [ "${STUB_INTERVAL:-240}" = "none" ] && exit 1
    echo "PATH=/usr/bin"
    echo "PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES=${STUB_INTERVAL:-240}"
    exit 0
    ;;
  compose)
    case "${STUB_DUMP_MODE:-good}" in
      # Incompressible payload on purpose: a run of 'x' would gzip to ~2K and
      # trip the MIN_DUMP_BYTES gate, which is a real production check.
      good)      printf -- '-- PostgreSQL database dump\n'; head -c 2000000 /dev/urandom | base64; printf -- '\nCOMMIT;\n' ;;
      truncated) printf -- '-- PostgreSQL database dump\n'; head -c 2000000 /dev/urandom | base64 ;;
      tiny)      printf -- 'COMMIT;\n' ;;
      fail)      echo "pg_dump: error: connection failed" >&2; exit 1 ;;
    esac
    exit 0
    ;;
esac
exit 0
STUB
chmod +x "${WORK}/bin/docker"
export PATH="${WORK}/bin:${PATH}"

# --- fixture -----------------------------------------------------------------
BACKUPS=""
fixture() { # $1 = age in minutes of the newest dump, or "empty" for none
  rm -rf "${WORK}/vol"
  BACKUPS="${WORK}/vol/instances/default/data/backups"
  mkdir -p "${BACKUPS}"
  if [ "$1" != "empty" ]; then
    local stamp f
    stamp="$(date -d "-$1 min" '+%Y%m%d-%H%M%S' 2>/dev/null || date '+%Y%m%d-%H%M%S')"
    f="${BACKUPS}/paperclip-${stamp}.sql.gz"
    head -c 3000000 /dev/zero | tr '\0' 'y' >"${f}"
    touch -d "-$1 min" "${f}"
  fi
}
# Sets RC and OUTPUT (globals — a command substitution would lose OUTPUT).
# Per-test knobs are passed as a prefix assignment on the call, which bash puts
# in the environment of the command the function runs.
RC=0; OUTPUT=""
run() {
  OUTPUT="$(PAPERCLIP_DATA_DIR="${WORK}/vol" LOCK_FILE="${WORK}/lock" \
            bash "${TARGET}" 2>&1)"
  RC=$?
}
count_dumps() { find "${BACKUPS}" -name 'paperclip-*.sql.gz' | wc -l | tr -d ' '; }
count_tmp()   { find "${BACKUPS}" -name '*.tmp' | wc -l | tr -d ' '; }

echo "== 1. fresh dump (30m old, 240m interval) → no-op =="
fixture 30
run; check "exit code" "${RC}" "0"
check "dump count unchanged" "$(count_dumps)" "1"
want "fresh —" "logged 'fresh'"

echo "== 2. dump 300m old (> 240+35) → catch-up dump written =="
fixture 300
run; check "exit code" "${RC}" "0"
check "dump count" "$(count_dumps)" "2"
check "no leftover .tmp" "$(count_tmp)" "0"
newest="$(find "${BACKUPS}" -name 'paperclip-*.sql.gz' -newermt '-2 min' -printf '%f\n' | head -1)"
if [[ "${newest}" =~ ^paperclip-[0-9]{8}-[0-9]{6}\.sql\.gz$ ]]; then
  ok "filename matches the shipper's DUMP_RE (${newest})"
else
  bad "filename does not match DUMP_RE: '${newest}'"
fi
want "STALE by 25m" "reported staleness overshoot"

echo "== 3. immediately re-run → idempotent no-op (the dump it just took is fresh) =="
run; check "exit code" "${RC}" "0"
check "dump count still 2" "$(count_dumps)" "2"

echo "== 4. boundary: 274m old with interval 240 + slack 35 → still fresh =="
fixture 274
run; check "exit code" "${RC}" "0"
check "no new dump" "$(count_dumps)" "1"

echo "== 5. interval unreadable (container down) → 240m fallback, still dumps when stale =="
fixture 300
STUB_INTERVAL=none run; check "exit code" "${RC}" "0"
check "dump written" "$(count_dumps)" "2"
want "container down or env unset" "used the documented fallback"

echo "== 6. shorter interval is honoured (60m) → 100m-old dump is stale =="
fixture 100
STUB_INTERVAL=60 run; check "exit code" "${RC}" "0"
check "dump written" "$(count_dumps)" "2"

echo "== 7. pg_dump fails → nothing published, non-zero exit, no .tmp left =="
fixture 300
STUB_DUMP_MODE=fail run; check "exit code" "${RC}" "1"
check "dump count unchanged" "$(count_dumps)" "1"
check "no leftover .tmp" "$(count_tmp)" "0"

echo "== 8. truncated dump (no COMMIT;) → discarded =="
fixture 300
STUB_DUMP_MODE=truncated run; check "exit code" "${RC}" "1"
check "dump count unchanged" "$(count_dumps)" "1"
check "no leftover .tmp" "$(count_tmp)" "0"
want "completion marker" "rejected on the completeness gate"

echo "== 9. suspiciously small dump → discarded =="
fixture 300
STUB_DUMP_MODE=tiny run; check "exit code" "${RC}" "1"
check "dump count unchanged" "$(count_dumps)" "1"

echo "== 10. usage ceiling → refuses to add a dump =="
fixture 300
MAX_USE_PCT=0 run; check "exit code" "${RC}" "1"
check "dump count unchanged" "$(count_dumps)" "1"
want "refusing to add a dump" "refused on the headroom ceiling"

echo "== 11. free-space gate (needs 10^9 x newest dump) → refuses =="
fixture 300
HEADROOM_FACTOR=1000000000 run; check "exit code" "${RC}" "1"
check "dump count unchanged" "$(count_dumps)" "1"

echo "== 12. no backups directory at all → skip, exit 0 =="
rm -rf "${WORK}/vol"; mkdir -p "${WORK}/vol"
run; check "exit code" "${RC}" "0"
want "nothing to do" "skipped cleanly"

echo "== 13. empty backups dir (never dumped) → takes the first dump =="
fixture empty
run; check "exit code" "${RC}" "0"
check "dump written" "$(count_dumps)" "1"

echo "== 14. DRY_RUN=1 on a stale dir → decides to dump but writes nothing =="
fixture 300
DRY_RUN=1 run; check "exit code" "${RC}" "0"
check "dump count unchanged" "$(count_dumps)" "1"
want "DRY_RUN would dump" "dry-run logged the decision"

echo
echo "passed ${PASS}, failed ${FAIL}"
[ "${FAIL}" -eq 0 ]
