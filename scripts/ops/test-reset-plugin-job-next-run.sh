#!/usr/bin/env bash
#
# test-reset-plugin-job-next-run.sh — GOL-2844
#
# Unit-test reset-plugin-job-next-run.sh with no droplet and no Postgres, by
# putting a fake `docker` on PATH that answers each psql -c query from a tiny
# state file. That state file is the point: case 7 flips `far` -> `soon` the way
# a real write would, which is the only way to prove the second run is a no-op.
#
# The SQL itself is verified separately against the live schema (see the runbook);
# this covers argument handling, the soon/far branch, --dry-run, and idempotency.
#
#   bash scripts/ops/test-reset-plugin-job-next-run.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/reset-plugin-job-next-run.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/compose"

# The fake `docker`: everything after the last `-c` is the SQL. DUE_SQL is the
# only query with a CASE, READ_SQL the only one selecting next_run_at, and the
# UPDATE announces itself — so three greps cover the contract.
cat > "$TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
sql=""; for a in "$@"; do sql="$a"; done
state_file="$DOCKER_STUB_STATE"
state="$(cat "$state_file" 2>/dev/null || echo far)"
case "$sql" in
  *"UPDATE plugin_jobs"*)
    echo "UPDATE" >> "$DOCKER_STUB_CALLS"
    if [ "$state" = far ]; then echo soon > "$state_file"; echo "2026-09-30 23:00:00+00"; fi
    ;;
  *CASE*)
    echo "DUE" >> "$DOCKER_STUB_CALLS"; echo "$state" ;;
  *next_run_at*)
    echo "READ" >> "$DOCKER_STUB_CALLS"
    if [ "$DOCKER_STUB_MISSING" = 1 ]; then exit 0; fi
    echo "2026-10-01 07:00:00+00|*/15 * * * *|active" ;;
esac
exit 0
STUB
chmod +x "$TMP/bin/docker"

fails=0
run() { # run <state> <missing> [args...] -> sets OUT / RC
  local state="$1" missing="$2"; shift 2
  echo "$state" > "$TMP/state"; : > "$TMP/calls"
  OUT="$(PATH="$TMP/bin:$PATH" COMPOSE_DIR="$TMP/compose" \
        DOCKER_STUB_STATE="$TMP/state" DOCKER_STUB_CALLS="$TMP/calls" \
        DOCKER_STUB_MISSING="$missing" bash "$SUT" "$@" 2>&1)"; RC=$?
}
check() { # check <label> <expected-rc> <substring>
  if [ "$RC" = "$2" ] && case "$OUT" in (*"$3"*) true;; (*) false;; esac; then
    echo "  ok   $1"
  else
    echo "  FAIL $1 (rc=$RC want $2; out=<$OUT> want substring <$3>)"; fails=$((fails+1))
  fi
}

echo "reset-plugin-job-next-run.sh"

run far 0
check "no args is a usage error" 1 "error usage:"

run far 0 onlyplugin
check "one arg is a usage error" 1 "error usage:"

run far 0 "agenticos.x" "it's-a-job"
check "a quote in an argument is refused" 1 "error quote-in-argument"

run far 0 "agenticos.x" job --max-wait abc
check "a non-integer --max-wait is refused" 1 "error max-wait-not-an-integer:abc"

run far 0 "agenticos.x" job --bogus
check "an unknown flag is refused" 1 "error unknown-flag:--bogus"

run far 1 "agenticos.x" job
check "an unknown job is its own answer" 1 "error no-such-job:agenticos.x/job"

run soon 0 "agenticos.x" job
check "a job already due is left alone" 0 "ok agenticos.x job next=2026-10-01 07:00:00+00"
grep -q UPDATE "$TMP/calls" && { echo "  FAIL a due job must not be written"; fails=$((fails+1)); } \
  || echo "  ok   a due job issues no UPDATE"

run far 0 "agenticos.x" job
check "a far-future job is reset" 0 "reset agenticos.x job was=2026-10-01 07:00:00+00 now=2026-09-30 23:00:00+00"

run far 0 "agenticos.x" job --dry-run
check "--dry-run reports the intent" 0 "now=<dry-run>"
grep -q UPDATE "$TMP/calls" && { echo "  FAIL --dry-run must not write"; fails=$((fails+1)); } \
  || echo "  ok   --dry-run issues no UPDATE"

# Idempotency: two runs back-to-back against the SAME state file. The first write
# flips the stub to `soon`, so the second must take the no-op branch.
echo far > "$TMP/state"; : > "$TMP/calls"
first="$(PATH="$TMP/bin:$PATH" COMPOSE_DIR="$TMP/compose" DOCKER_STUB_STATE="$TMP/state" \
        DOCKER_STUB_CALLS="$TMP/calls" DOCKER_STUB_MISSING=0 bash "$SUT" agenticos.x job 2>&1)"
OUT="$(PATH="$TMP/bin:$PATH" COMPOSE_DIR="$TMP/compose" DOCKER_STUB_STATE="$TMP/state" \
      DOCKER_STUB_CALLS="$TMP/calls" DOCKER_STUB_MISSING=0 bash "$SUT" agenticos.x job 2>&1)"; RC=$?
case "$first" in (reset*) :;; (*) echo "  FAIL first run should reset (got <$first>)"; fails=$((fails+1));; esac
check "a second run is a no-op" 0 "ok agenticos.x job"
[ "$(grep -c UPDATE "$TMP/calls")" = 1 ] && echo "  ok   exactly one UPDATE across two runs" \
  || { echo "  FAIL expected 1 UPDATE, got $(grep -c UPDATE "$TMP/calls")"; fails=$((fails+1)); }

# A missing compose dir must fail loudly, not silently target the wrong host.
OUT="$(PATH="$TMP/bin:$PATH" COMPOSE_DIR="$TMP/nope" DOCKER_STUB_STATE="$TMP/state" \
      DOCKER_STUB_CALLS="$TMP/calls" DOCKER_STUB_MISSING=0 bash "$SUT" agenticos.x job 2>&1)"; RC=$?
check "a missing compose dir is fatal" 1 "error compose-dir-absent:"

echo
if [ "$fails" -eq 0 ]; then echo "PASS"; else echo "FAIL ($fails)"; fi
exit "$fails"
