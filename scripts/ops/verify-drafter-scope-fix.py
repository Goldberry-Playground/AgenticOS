#!/usr/bin/env python3
"""Verify the grove-content-drafter invocation-scope fix against live host logs.

GOL-2929 / GOL-2927. The `content-draft-sweep` plugin job loses a share of its
ticks to the GOL-323 host invocation-scope bug: the host denies the plugin's
`issues.list` call, the sweep throws, and the scheduler records
`job execution failed`. PR #792 wraps those host calls in a retry.

Verifying that fix from logs is deceptively easy to get WRONG in three ways,
and this script exists because each one reads as a clean pass:

  1. THE QUIET-WINDOW LIE. Failure rate is strongly dose-dependent on comment
     traffic in the sweep's own window (measured pre-fix over 397 ticks):

         comments in bucket   ticks   fail%
         0 (quiet)              305    3.6%
         1-2                     28   46.4%
         3-5                     19   42.1%
         6-10                    18   50.0%
         11+                     26   84.6%

     A quiet window therefore shows ~0 failures with or without the fix. Zero
     failures over quiet logs is not evidence; it is the null result.

  2. THE ABSENT-FIELD LIE. The pre-fix build never emits `"errors":` in its
     `content-draft-sweep complete` summary. `grep -o '"errors":[0-9]*'`
     returns EMPTY against the old build, which looks identical to "no
     errors". The field's PRESENCE is what identifies the new build, so we
     assert on it rather than on the absence of non-zero values.

  3. THE DEAD-RETRY LIE. A fix that silently stopped retrying looks exactly
     like a box that never collided. We require positive proof the retry path
     actually fired and rescued a call at least once.

Exit codes: 0 = PASS, 1 = FAIL, 2 = INCONCLUSIVE (never conflate 2 with 0).
"""

from __future__ import annotations

import argparse
import collections
import gzip
import io
import os
import re
import sys

DEFAULT_LOGDIR = "/paperclip/instances/default/logs"
SWEEP_JOB_KEY = "content-draft-sweep"
RECOVERY_MARKER = "recovered after invocation-scope retry"
COMPLETE_MARKER = f"{SWEEP_JOB_KEY} complete"

TS_RE = re.compile(r"^\[(\d\d):(\d\d):(\d\d)\]")
ERRORS_RE = re.compile(r'"errors":(\d+)')
BANDS = [(0, 0, "0 (quiet)"), (1, 2, "1-2"), (3, 5, "3-5"), (6, 10, "6-10"), (11, None, "11+")]


def band_of(n: int) -> str:
    for lo, hi, label in BANDS:
        if n >= lo and (hi is None or n <= hi):
            return label
    return "?"


def log_sort_key(name: str):
    """Oldest first: server.log.7.gz ... server.log.1, server.log."""
    if name == "server.log":
        return (1, 0)
    m = re.match(r"server\.log\.(\d+)", name)
    return (0, -int(m.group(1))) if m else (0, 0)


def open_log(path: str):
    if path.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), errors="replace")
    return open(path, errors="replace")


def scan(logdir: str, bucket_minutes: int):
    """Return (sweeps, counters, errors_values, recoveries).

    sweeps: list of dicts {bucket, failed}. A sweep is a `dispatching scheduled
    job` line for the sweep job, paired with the next terminal line for it.
    Buckets are (file, hour, minute // bucket_minutes) -- logs rotate daily, so
    file+time identifies a window without needing a date on the line prefix
    (the `[HH:MM:SS]` prefix carries no date).
    """
    names = sorted(
        (n for n in os.listdir(logdir) if n.startswith("server.log")), key=log_sort_key
    )
    if not names:
        raise SystemExit(f"INCONCLUSIVE: no server.log* files under {logdir}")

    comments: collections.Counter = collections.Counter()
    sweeps: list[dict] = []
    counters: collections.Counter = collections.Counter()
    errors_values: collections.Counter = collections.Counter()
    recoveries = 0

    for name in names:
        counters["log_files"] += 1
        pending = None
        with open_log(os.path.join(logdir, name)) as fh:
            for line in fh:
                # Marker-based counting must NOT depend on the `[HH:MM:SS]`
                # prefix: this log format emits prefix-less continuation lines
                # (e.g. the `err:` block of a stack trace), and anchoring on
                # the prefix would silently drop them -- which here would turn
                # a live retry into a false "dead retry" verdict.
                if RECOVERY_MARKER in line:
                    recoveries += 1

                if COMPLETE_MARKER in line:
                    counters["complete_lines"] += 1
                    em = ERRORS_RE.search(line)
                    errors_values[em.group(1) if em else "FIELD_ABSENT"] += 1

                m = TS_RE.match(line)
                if not m:
                    continue
                hour, minute = int(m.group(1)), int(m.group(2))
                bucket = (name, hour, minute // bucket_minutes)

                # Busyness proxy: accepted comment writes to the board API.
                if "POST" in line and "/comments 201" in line:
                    comments[bucket] += 1
                    counters["comments"] += 1

                if f'"jobKey":"{SWEEP_JOB_KEY}"' not in line:
                    continue
                if "dispatching scheduled job" in line:
                    pending = bucket
                    counters["dispatch"] += 1
                elif "job execution failed" in line:
                    counters["failed"] += 1
                    sweeps.append({"bucket": pending or bucket, "failed": True})
                    pending = None
                elif "job completed successfully" in line:
                    counters["ok"] += 1
                    sweeps.append({"bucket": pending or bucket, "failed": False})
                    pending = None

    for s in sweeps:
        s["comments"] = comments[s["bucket"]]
    return sweeps, counters, errors_values, recoveries


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--logdir", default=DEFAULT_LOGDIR)
    ap.add_argument("--bucket-minutes", type=int, default=20,
                    help="window width for the busyness measure (default: the sweep's own 20m cadence)")
    ap.add_argument("--busy-min-comments", type=int, default=6,
                    help="a sweep tick is 'busy' when its bucket saw at least this many comments")
    ap.add_argument("--busy-min-ticks", type=int, default=5,
                    help="require at least this many busy ticks or the run is INCONCLUSIVE")
    ap.add_argument("--require-recovery", dest="require_recovery", action="store_true", default=True)
    ap.add_argument("--no-require-recovery", dest="require_recovery", action="store_false",
                    help="skip the dead-retry check (use only when explaining a known-quiet window)")
    ap.add_argument("--baseline", action="store_true",
                    help="report the stratified table only; make no pass/fail claim")
    args = ap.parse_args()

    sweeps, counters, errors_values, recoveries = scan(args.logdir, args.bucket_minutes)

    total = len(sweeps)
    failed = sum(1 for s in sweeps if s["failed"])
    busy = [s for s in sweeps if s["comments"] >= args.busy_min_comments]
    busy_failed = sum(1 for s in busy if s["failed"])

    print(f"log files scanned      : {counters['log_files']}")
    print(f"sweep ticks            : {total}  (ok={counters['ok']} failed={counters['failed']})")
    print(f"comment POSTs observed : {counters['comments']}")
    print(f"recovery log lines     : {recoveries}")
    print()
    print(f"=== comment traffic in the sweep's own {args.bucket_minutes}m bucket x outcome ===")
    print(f"{'comments':<12}{'ok':>6}{'fail':>6}{'fail%':>8}")
    table = collections.Counter((band_of(s["comments"]), s["failed"]) for s in sweeps)
    for _, _, label in BANDS:
        ok, fa = table[(label, False)], table[(label, True)]
        if ok + fa:
            print(f"{label:<12}{ok:>6}{fa:>6}{100 * fa / (ok + fa):>7.1f}%")
    print()
    rate = (100 * failed / total) if total else 0.0
    print(f"OVERALL  ticks={total} failed={failed} ({rate:.1f}%)")
    print(f"BUSY (>={args.busy_min_comments} comments)  ticks={len(busy)} failed={busy_failed}")
    print()
    print("=== `errors` field in the sweep's complete summary ===")
    for k, v in sorted(errors_values.items()):
        print(f"  errors={k}: {v}")
    print()

    if args.baseline:
        print("BASELINE ONLY - no pass/fail claim made.")
        return 0

    verdict_fail: list[str] = []
    inconclusive: list[str] = []

    # Trap 2: positively identify the post-fix build before judging anything.
    if errors_values.get("FIELD_ABSENT"):
        inconclusive.append(
            f"{errors_values['FIELD_ABSENT']} `{COMPLETE_MARKER}` line(s) carry no "
            '`"errors":` field -- that is the PRE-fix build. An empty '
            "`grep '\"errors\":[0-9]*'` here means 'field absent', not 'zero errors'."
        )
    if not counters["complete_lines"]:
        inconclusive.append(f"no `{COMPLETE_MARKER}` lines at all -- the sweep never completed in this window.")

    # Trap 1: a quiet window cannot distinguish fixed from broken.
    if len(busy) < args.busy_min_ticks:
        inconclusive.append(
            f"only {len(busy)} sweep tick(s) landed in a busy bucket "
            f"(>={args.busy_min_comments} comments); need >={args.busy_min_ticks}. "
            "Pre-fix, quiet buckets fail just 3.6% of the time, so a quiet window "
            "is the null result, not a pass."
        )

    # Trap 3: a retry path that silently stopped firing mimics a quiet box.
    if args.require_recovery and recoveries == 0:
        inconclusive.append(
            f"zero `{RECOVERY_MARKER}` lines -- no positive proof the retry path "
            "ever fired, so 0 failures is indistinguishable from a dead retry."
        )

    # The actual acceptance criterion.
    if failed:
        verdict_fail.append(f"{failed} `job execution failed` for {SWEEP_JOB_KEY} (expected 0).")
    nonzero = {k: v for k, v in errors_values.items() if k.isdigit() and int(k) > 0}
    if nonzero:
        verdict_fail.append(f"non-zero per-issue `errors` in sweep summaries: {nonzero} -- each needs explaining.")

    if verdict_fail:
        print("RESULT: FAIL")
        for r in verdict_fail:
            print(f"  - {r}")
        for r in inconclusive:
            print(f"  (also unreliable: {r})")
        return 1
    if inconclusive:
        print("RESULT: INCONCLUSIVE  (NOT a pass)")
        for r in inconclusive:
            print(f"  - {r}")
        return 2
    print("RESULT: PASS")
    print(f"  - 0 `job execution failed` across {total} sweep ticks")
    print(f"  - {len(busy)} of them in a demonstrably busy bucket (>={args.busy_min_comments} comments)")
    print(f"  - {recoveries} recovery line(s): the retry path is live and load-bearing")
    print(f"  - every sweep summary reports errors=0 on the post-fix build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
