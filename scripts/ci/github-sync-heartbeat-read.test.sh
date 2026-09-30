#!/usr/bin/env bash
#
# Offline tests for scripts/github-sync-heartbeat-read.sh (GOL-2591 item 3).
# Run: bash scripts/ci/github-sync-heartbeat-read.test.sh
#
# The script's whole job is to turn the droplet's DB state into ONE line the
# runner-side probe can trust. It runs on a box CI never touches, so the only way
# to keep it honest is to stub `docker` and assert the line for each state. The
# contract matters more than it looks: a reading the probe cannot parse scores as
# `unparseable` and pages — so a formatting slip here is a false-alarm generator,
# and a reading that *looks* healthy when it isn't recreates GOL-2585.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${HERE}/../github-sync-heartbeat-read.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/compose"

fails=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  ok: $1"
  else
    echo "  FAIL: $1"; echo "    expected: $2"; echo "    actual:   $3"; fails=$((fails + 1))
  fi
}

# Stub `docker`. $DOCKER_MODE picks which DB state to simulate. The stub keys off
# the SQL text so the existence probe and the row read answer independently —
# exactly how the real two-query flow behaves.
cat > "$TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
sql="${!#}"   # last arg is the -c "<sql>" payload
case "$DOCKER_MODE" in
  healthy)
    case "$sql" in
      *to_regclass*) echo "plugin_github_sync_40eceaaa3a.github_sync_heartbeat" ;;
      *) echo "2026-09-29T20:55:21.088Z|2026-09-29T20:44:31.476Z|0.16.9" ;;
    esac ;;
  no_table)
    case "$sql" in *to_regclass*) echo "" ;; *) echo "" ;; esac ;;
  empty_row)
    case "$sql" in
      *to_regclass*) echo "plugin_github_sync_40eceaaa3a.github_sync_heartbeat" ;;
      *) echo "" ;;
    esac ;;
  null_version)
    case "$sql" in
      *to_regclass*) echo "plugin_github_sync_40eceaaa3a.github_sync_heartbeat" ;;
      *) echo "2026-09-29T20:55:21.088Z|2026-09-29T20:44:31.476Z|-" ;;
    esac ;;
  db_down)
    echo "psql: error: connection to server failed" >&2
    echo "FATAL: the database system is starting up" >&2
    exit 2 ;;
  garbage)
    case "$sql" in
      *to_regclass*) echo "plugin_github_sync_40eceaaa3a.github_sync_heartbeat" ;;
      *) echo "wat" ;;
    esac ;;
esac
exit 0
STUB
chmod +x "$TMP/bin/docker"

run() { DOCKER_MODE="$1" PATH="$TMP/bin:$PATH" COMPOSE_DIR="$TMP/compose" bash "$SCRIPT" 2>/dev/null; }

echo "github-sync-heartbeat-read.test.sh"

check "healthy row → one ok line the probe can parse" \
  "HEARTBEAT ok 2026-09-29T20:55:21.088Z 2026-09-29T20:44:31.476Z 0.16.9" \
  "$(run healthy)"

# to_regclass returns NULL (rendered as empty) when migration 007 never ran or the
# plugin DB namespace drifted. This MUST be distinguishable from a stale heartbeat:
# both are outages, but only one is fixed by restarting a worker.
check "missing table → no_table, not an unreadable error" "HEARTBEAT no_table" "$(run no_table)"

check "table present, no row → missing" "HEARTBEAT missing" "$(run empty_row)"

check "NULL worker_version → placeholder, still a valid 5-field line" \
  "HEARTBEAT ok 2026-09-29T20:55:21.088Z 2026-09-29T20:44:31.476Z -" \
  "$(run null_version)"

# A multi-line psql error must collapse to ONE line or it breaks the contract and
# the probe scores it unparseable instead of reporting the real cause.
out="$(run db_down)"
case "$out" in
  "HEARTBEAT unreadable psql-rc2:"*) echo "  ok: psql failure → single-line unreadable with the cause" ;;
  *) echo "  FAIL: psql failure"; echo "    actual: $out"; fails=$((fails + 1)) ;;
esac
check "psql failure stays on one line" "1" "$(run db_down | wc -l | tr -d ' ')"

case "$(run garbage)" in
  "HEARTBEAT unreadable row-incomplete:"*) echo "  ok: unexpected row shape → unreadable, never a fake ok" ;;
  *) echo "  FAIL: garbage row"; fails=$((fails + 1)) ;;
esac

# No docker at all (wrong host, broken PATH) must still report, not crash.
# Absolute /bin/bash because the empty PATH also hides the interpreter itself.
case "$(PATH="/nonexistent" COMPOSE_DIR="$TMP/compose" /bin/bash "$SCRIPT" 2>/dev/null)" in
  "HEARTBEAT unreadable docker-not-on-PATH") echo "  ok: no docker → unreadable" ;;
  *) echo "  FAIL: no docker"; fails=$((fails + 1)) ;;
esac

# Wrong compose dir must be reported, not silently read from $PWD.
case "$(DOCKER_MODE=healthy PATH="$TMP/bin:$PATH" COMPOSE_DIR="$TMP/nope" bash "$SCRIPT" 2>/dev/null)" in
  "HEARTBEAT unreadable compose-dir-absent:"*) echo "  ok: absent compose dir → unreadable" ;;
  *) echo "  FAIL: absent compose dir"; fails=$((fails + 1)) ;;
esac

# Every path exits 0: the RUNNER is the single decision point, and a nonzero here
# would fail the job before the probe can classify and page.
run db_down >/dev/null; check "always exits 0 (runner decides)" "0" "$?"

if [ "$fails" -ne 0 ]; then echo "FAILED: $fails"; exit 1; fi
echo "github-sync-heartbeat-read.test.sh: all checks passed"
