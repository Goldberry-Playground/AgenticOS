#!/usr/bin/env bash
# Self-test for verify-drafter-scope-fix.py (GOL-2929, GOL-3352).
#
# The point of the verifier is that three different log situations LOOK like a
# clean pass but are not. So this test is written to prove each guard is
# load-bearing: for every guard there is a fixture that differs from the PASS
# fixture in exactly that one respect, and it must come back INCONCLUSIVE (2)
# rather than PASS (0). A verifier whose guards were stubbed out would still
# pass a happy-path-only test, so happy-path-only is not enough.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify-drafter-scope-fix.py"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail=0

DRAFTER='f071f43f-b860-4629-88ad-70823426de2f'

# --- fixture builders -------------------------------------------------------
# Emit one sweep tick at HH:MM. $3=outcome (ok|failed), $4=errors field mode
# (num|absent). Mirrors the real host line shapes, including the fact that the
# `[HH:MM:SS]` prefix carries no date.
tick() { # file HH:MM outcome(ok|failed|skipped) errorsmode [errvalue]
  local f=$1 t=$2 oc=$3 em=$4 ev=${5:-0}
  echo "[$t:18] INFO: dispatching scheduled job {\"service\":\"plugin-job-scheduler\",\"pluginId\":\"$DRAFTER\",\"jobKey\":\"content-draft-sweep\",\"runId\":\"r-$t\"}" >> "$f"
  if [ "$oc" = skipped ]; then
    # GOL-3352: the scheduled sweep's scope retry is exhausted, it logs the
    # skip and returns normally -- the host records a successful job run.
    echo "[$t:18] WARN: [plugin] content-drafter: invocation-scope retry budget exhausted {\"service\":\"plugin-worker\",\"pluginId\":\"$DRAFTER\",\"label\":\"issues.list/own-requests\",\"attempts\":2}" >> "$f"
    echo "[$t:18] WARN: [plugin] content-draft-sweep skipped: invocation scope held by a concurrent event; the event sweep covers this window {\"service\":\"plugin-worker\",\"pluginId\":\"$DRAFTER\"}" >> "$f"
    echo "[$t:18] INFO: job completed successfully {\"service\":\"plugin-job-scheduler\",\"pluginId\":\"$DRAFTER\",\"jobKey\":\"content-draft-sweep\",\"runId\":\"r-$t\",\"durationMs\":412}" >> "$f"
  elif [ "$oc" = failed ]; then
    echo "[$t:18] ERROR: host handler error {\"service\":\"plugin-worker\",\"pluginId\":\"$DRAFTER\",\"method\":\"issues.list\"}" >> "$f"
    echo "[$t:18] ERROR: job execution failed {\"service\":\"plugin-job-scheduler\",\"pluginId\":\"$DRAFTER\",\"jobKey\":\"content-draft-sweep\",\"runId\":\"r-$t\",\"durationMs\":84}" >> "$f"
  else
    if [ "$em" = absent ]; then
      echo "[$t:18] INFO: [plugin] content-draft-sweep complete {\"service\":\"plugin-worker\",\"pluginId\":\"$DRAFTER\",\"scanned\":0,\"drafted\":0}" >> "$f"
    else
      echo "[$t:18] INFO: [plugin] content-draft-sweep complete {\"service\":\"plugin-worker\",\"pluginId\":\"$DRAFTER\",\"scanned\":0,\"drafted\":0,\"errors\":$ev}" >> "$f"
    fi
    echo "[$t:18] INFO: job completed successfully {\"service\":\"plugin-job-scheduler\",\"pluginId\":\"$DRAFTER\",\"jobKey\":\"content-draft-sweep\",\"runId\":\"r-$t\",\"durationMs\":98}" >> "$f"
  fi
}
comments() { # file HH:MM n   -- n accepted comment writes inside that bucket
  local f=$1 t=$2 n=$3 i=0
  while [ $i -lt "$n" ]; do
    echo "[$t:0$((i%10))] INFO: POST /issues/abc-$i/comments 201 {\"req\":{\"id\":$i}}" >> "$f"
    i=$((i+1))
  done
}

# Build a fixture dir. $1=dest, $2=errorsmode, $3=busy(yes|no),
# $4=cover(yes|no: emit the event-sweep line, the GOL-3352 covering path),
# $5=failures(count), $6=errvalue, $7=skipped(count, after the failures)
build() {
  local d=$1 em=$2 busy=$3 rec=$4 nfail=$5 ev=${6:-0} nskip=${7:-0}
  mkdir -p "$d"; local f="$d/server.log"; : > "$f"
  local h m slot=0
  for h in 01 02 03 04 05 06 07 08; do
    for m in 00 20 40; do
      if [ "$busy" = yes ]; then comments "$f" "$h:$m" 12; else comments "$f" "$h:$m" 0; fi
      if [ "$slot" -lt "$nfail" ]; then tick "$f" "$h:$m" failed "$em" "$ev"
      elif [ "$slot" -lt $((nfail + nskip)) ]; then tick "$f" "$h:$m" skipped "$em" "$ev"
      else tick "$f" "$h:$m" ok "$em" "$ev"; fi
      slot=$((slot+1))
    done
  done
  if [ "$rec" = yes ]; then
    echo "[01:19:00] INFO: [plugin] content-drafter: event sweep complete {\"service\":\"plugin-worker\",\"pluginId\":\"$DRAFTER\",\"issueId\":\"abc-1\",\"scanned\":1,\"drafted\":0,\"errors\":0,\"scopeDenied\":0}" >> "$f"
  fi
}

OUTFILE="$TMP/.out"
run() { # dir -> sets RC, writes output to $OUTFILE
  set +e; python3 "$SCRIPT" --logdir "$1" >"$OUTFILE" 2>&1; RC=$?; set -e
}
expect() { # desc dir want_exit want_substr
  local desc=$1 dir=$2 want=$3 sub=$4
  run "$dir"; local rc=$RC; local LAST_OUT; LAST_OUT=$(cat "$OUTFILE")
  if [ "$rc" != "$want" ]; then
    echo "  FAIL  $desc (exit $rc, wanted $want)"; echo "$LAST_OUT" | sed 's/^/        /'; fail=1; return
  fi
  if ! printf '%s' "$LAST_OUT" | grep -qF -- "$sub"; then
    echo "  FAIL  $desc (exit ok but missing: $sub)"; echo "$LAST_OUT" | sed 's/^/        /'; fail=1; return
  fi
  echo "  PASS  $desc"
}

echo "== the one situation that is a real pass =="
build "$TMP/pass" num yes yes 0 0
expect "post-fix build, busy window, 0 failures, event sweep proven -> PASS" "$TMP/pass" 0 "RESULT: PASS"

# GOL-3352: a scheduled tick whose scope retry is exhausted logs "skipped" and
# completes normally. That is the designed outcome in a busy window, not a
# failure -- but it must be counted and reported as skipped, not hidden in ok.
build "$TMP/skipped" num yes yes 0 0 4
expect "skipped-as-covered ticks in a busy window -> still PASS" "$TMP/skipped" 0 "RESULT: PASS"
expect "skipped ticks are reported, not folded into ok" "$TMP/skipped" 0 "skipped=4"

echo "== each guard, held out one at a time, must block that same PASS =="
# Trap 1: identical except the window is quiet.
build "$TMP/quiet" num no yes 0 0
expect "quiet window alone -> INCONCLUSIVE, not PASS" "$TMP/quiet" 2 "quiet buckets fail just 3.6%"

# Trap 2: identical except the build is pre-fix (no `errors` field at all).
build "$TMP/oldbuild" absent yes yes 0 0
expect "pre-fix build (errors field absent) -> INCONCLUSIVE, not PASS" "$TMP/oldbuild" 2 "that is the PRE-fix build"

# Trap 4: identical except the covering path (event sweep) never spoke.
build "$TMP/nocover" num yes no 0 0
expect "no event-sweep line -> INCONCLUSIVE, not PASS" "$TMP/nocover" 2 "indistinguishable from a dead cover"

echo "== real regressions must FAIL, and must outrank INCONCLUSIVE =="
build "$TMP/failing" num yes yes 3 0
expect "job failures in a busy window -> FAIL" "$TMP/failing" 1 "RESULT: FAIL"

build "$TMP/errs" num yes yes 0 2
expect "non-zero per-issue errors -> FAIL" "$TMP/errs" 1 "non-zero per-issue"

# A FAIL must not be downgraded to INCONCLUSIVE just because a guard also trips.
build "$TMP/failquiet" num no no 3 0
expect "failures outrank inconclusive guards" "$TMP/failquiet" 1 "RESULT: FAIL"

echo "== the busyness measure must actually read comment traffic =="
# Same tick count and outcomes; only the comment volume differs. If the
# verifier ignored comments, these two would be indistinguishable.
run "$TMP/pass";  rc_busy=$RC;  out_busy=$(cat "$OUTFILE")
run "$TMP/quiet"; rc_quiet=$RC; out_quiet=$(cat "$OUTFILE")
if [ "$rc_busy" = "$rc_quiet" ]; then
  echo "  FAIL  busyness is not load-bearing (busy and quiet fixtures agree: $rc_busy)"; fail=1
else
  echo "  PASS  busyness changes the verdict ($rc_busy vs $rc_quiet)"
fi
if printf '%s' "$out_busy" | grep -q 'comment POSTs observed : 0'; then
  echo "  FAIL  busy fixture reported zero comment traffic"; fail=1
else
  echo "  PASS  busy fixture reports real comment traffic"
fi

echo "== marker counting must not depend on the [HH:MM:SS] prefix =="
# This log format emits prefix-less continuation lines. If event-sweep counting
# were anchored on the prefix, a live covering path would read as a dead one.
build "$TMP/noprefix" num yes no 0 0
printf '    content-drafter: event sweep complete\n' >> "$TMP/noprefix/server.log"
expect "prefix-less event-sweep line is still counted -> PASS" "$TMP/noprefix" 0 "RESULT: PASS"

echo "== the 15-minute hold cross-tab must read the clock, not the bucket =="
# A comment 10 minutes BEFORE a tick sits in the previous 20m bucket (so the
# bucket measure calls the tick quiet) but inside the 15-minute hold window.
mkdir -p "$TMP/hold"; : > "$TMP/hold/server.log"
comments "$TMP/hold/server.log" "02:10" 1          # bucket (02, 0): 02:00-02:19
tick "$TMP/hold/server.log" "02:20" failed num 0   # bucket (02, 1): 02:20-02:39
run "$TMP/hold"
if grep -qE '^yes +0 +0 +1' "$OUTFILE"; then echo "  PASS  tick 10 min after a comment is 'held' even across a bucket edge"
else echo "  FAIL  hold cross-tab did not attribute the failure to the prior-15-min comment"; sed 's/^/        /' "$OUTFILE"; fail=1; fi

echo "== empty/absent logdir must never read as a pass =="
mkdir -p "$TMP/empty"
run "$TMP/empty" || true; rc=$RC
if [ "$rc" = "0" ]; then echo "  FAIL  empty logdir reported PASS"; fail=1; else echo "  PASS  empty logdir is not a PASS (exit $rc)"; fi

# A missing directory must not be silently treated as "nothing wrong".
set +e; python3 "$SCRIPT" --logdir "$TMP/does-not-exist" >/dev/null 2>&1; rc=$?; set -e
if [ "$rc" = "0" ]; then echo "  FAIL  missing logdir reported PASS"; fail=1; else echo "  PASS  missing logdir is not a PASS (exit $rc)"; fi

echo
if [ "$fail" = 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit $fail
