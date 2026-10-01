#!/usr/bin/env bash
#
# paperclip-restart-forensics.test.sh — offline harness for
# .github/workflows/paperclip-restart-forensics.yml (GOL-2864).
#
# No Droplet, no SSH, no Docker daemon. The remote script is lifted straight
# out of the workflow YAML and executed under a stub PATH, which is the only
# way to test it: everything it does happens on the far side of an `ssh`.
#
# The workflow's whole value is that it never reports an all-clear it did not
# earn. Five real bugs got past review-by-reading and were caught only by
# running it, every one of them the same mistake — a probe that could not run
# reporting as though it had:
#
#   1. `docker events --format "{{.Status}}"` is invalid (*events.Message has
#      .Action). The daemon's "Error parsing format" text is NON-EMPTY, so the
#      `[ -n "$EVENTS" ]` branch printed the error and called it CONCLUSIVE.
#   2. `sudo: a password is required` — the deploy user has no NOPASSWD entry,
#      and the draft turned that into "no OOM lines found".
#   3. `--until now` — rejected by this daemon ("failed to parse value as time
#      or duration"). It cannot simply be dropped: without --until,
#      `docker events --since` streams live and hangs to the job timeout.
#   4. Unfiltered events returned ~26k lines of healthcheck exec_* noise that
#      buried the lifecycle lines the probe exists to find.
#   5. With that filtered, an empty ring was reported as "zero lifecycle events
#      in 24h" for a container the daemon had created 1h42m earlier.
#
# So the assertions below are mostly negative: given a broken/absent tool, the
# probe must say INCONCLUSIVE and must NOT say CONCLUSIVE. Silence and false
# comfort are the failure modes; a missing OOM finding is worse than noise.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WF="$HERE/../../.github/workflows/paperclip-restart-forensics.yml"
[ -r "$WF" ] || { echo "FATAL: $WF missing" >&2; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; mkdir -p "$BIN"
REMOTE="$WORK/remote.sh"
fail=0

ok()   { echo "  ok   — $1"; }
bad()  { echo "  FAIL — $1" >&2; fail=1; }

# --- extract the remote script ---------------------------------------------
# Everything between the ssh invocation's opening single quote and the closing
# `' | tee forensics.log`. Deliberately not a YAML parse: pyyaml is not a
# guaranteed dependency of the CI scripts job, and the raw text is what the
# shell will actually see.
awk "
  /deploy_key \"\\\$\{USER\}@\\\$\{HOST\}\" '/ { grab=1; next }
  /^[[:space:]]*' \\| tee forensics\.log/      { grab=0 }
  grab { print }
" "$WF" > "$WORK/remote.raw"

[ -s "$WORK/remote.raw" ] || { echo "FATAL: could not isolate the remote script — did the ssh line change?" >&2; exit 1; }

echo "== static =="

# A single quote anywhere inside would terminate the single-quoted ssh argument
# early and ship a truncated script to the box. An apostrophe typed into a
# prose comment ("can't") did exactly this during development.
if grep -q "'" "$WORK/remote.raw"; then
  bad "remote script contains a single quote, which would terminate the ssh argument early:"
  grep -n "'" "$WORK/remote.raw" >&2
else
  ok "no single quote inside the single-quoted ssh argument"
fi

# An unrendered ${{ }} would reach the remote shell as literal text.
if grep -q '\${{' "$WORK/remote.raw"; then
  bad "remote script contains an unrendered \${{ }} expression"
else
  ok "no unrendered \${{ }} expressions in the remote script"
fi

# A stub `docker` cannot validate Go template semantics against a real daemon,
# so pin the known-bad field statically instead. `docker events` applies the
# template to *events.Message, which has .Action and no .Status; asking for
# .Status makes the daemon return "Error parsing format" rather than events.
# This is bug 1 above, and a behavioural stub cannot catch its reintroduction.
if grep -q '{{\.Status}}' "$WORK/remote.raw"; then
  bad "docker events template uses {{.Status}}; *events.Message has .Action, so the daemon will return an error instead of events"
else
  ok "docker events template avoids the invalid {{.Status}} field"
fi

# The remote shell sees \" as "
sed 's/\\"/"/g' "$WORK/remote.raw" > "$REMOTE"

if bash -n "$REMOTE" 2>"$WORK/syn"; then
  ok "remote script is syntactically valid bash"
else
  bad "remote script has a syntax error: $(cat "$WORK/syn")"
fi

# --- behaviour --------------------------------------------------------------
# Each scenario writes stubs into $BIN and runs the script with `env -i` so the
# ONLY tools reachable are the ones the scenario provides.
# A curated sandbox PATH, NOT /usr/bin. Scenario A asserts that an absent tool
# reads as INCONCLUSIVE, which only means anything if the tool is actually
# absent -- and a GitHub runner ships real docker, sudo and journalctl in
# /usr/bin, so the first CI run of this file found them and three scenario-A
# assertions failed. SYSBIN therefore holds symlinks to ONLY the utilities the
# remote script needs as plumbing; every tool a scenario is making claims about
# (docker, journalctl, sudo, dmesg, free, uptime, git, stat) is deliberately
# excluded, so it exists only when a stub provides it.
SYSBIN="$WORK/sysbin"; mkdir -p "$SYSBIN"
# bash/env/sh are plumbing: the stubs below use a `#!/usr/bin/env bash` shebang,
# so `env` must be able to find `bash` on this very PATH.
for u in bash sh env cat date grep head rm printf timeout sed sort; do
  src="$(command -v "$u" || true)"
  [ -n "$src" ] && ln -sf "$src" "$SYSBIN/$u"
done
run_scenario() { env -i PATH="$BIN:$SYSBIN" HOME="$WORK" "$(command -v bash)" "$REMOTE" 2>/dev/null; }

reset_stubs() { rm -f "$BIN"/*; }

assert_says() {
  local out="$1" needle="$2" desc="$3"
  if grep -qF -- "$needle" <<<"$out"; then ok "$desc"; else bad "$desc (expected to find: $needle)"; fi
}
assert_not() {
  local out="$1" needle="$2" desc="$3"
  if grep -qF -- "$needle" <<<"$out"; then bad "$desc (unexpectedly found: $needle)"; else ok "$desc"; fi
}

echo "== A: bare box, no tooling at all =="
reset_stubs
out="$(run_scenario)"
assert_says "$out" "INCONCLUSIVE: no readable kernel log" "no kernel-log reader at all is INCONCLUSIVE"
assert_says "$out" "INCONCLUSIVE: docker CLI unavailable"      "missing docker is INCONCLUSIVE"
assert_not  "$out" "CONCLUSIVE (via"                           "no conclusive kernel verdict without a kernel log"
assert_not  "$out" "zero lifecycle events"                     "no all-clear on events without a daemon"
[ "$(grep -c '^===== ' <<<"$out")" = 7 ] && ok "all 7 probes reported" || bad "expected 7 probe headers"

echo "== B: the two live failures — sudo wants a password, events template error =="
reset_stubs
printf '%s\n' '#!/usr/bin/env bash' 'echo "Permission denied" >&2; exit 1'            > "$BIN/journalctl"
printf '%s\n' '#!/usr/bin/env bash' 'echo "sudo: a password is required" >&2; exit 1' > "$BIN/sudo"
printf '%s\n' '#!/usr/bin/env bash' 'echo "Permission denied" >&2; exit 1'            > "$BIN/dmesg"
cat >"$BIN/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  inspect) [[ "$*" == *"{{.Id}}"* ]] && { echo deadbeef; exit 0; }; echo "oomkilled=false restarts=0"; exit 0;;
  stats)   echo "usage=1.4GiB / 3GiB"; exit 0;;
  events)  echo 'Error parsing format: template: cannot evaluate field Status'; exit 0;;
esac
STUB
chmod +x "$BIN"/*
out="$(run_scenario)"
assert_says "$out" "INCONCLUSIVE: no readable kernel log"        "unreadable kernel log is INCONCLUSIVE, not an all-clear"
assert_says "$out" "NOPASSWD"                                    "names the remedy for the sudo denial"
assert_says "$out" "INCONCLUSIVE: docker events returned an error" "a template error is INCONCLUSIVE, never data"
assert_not  "$out" "zero OOM-killer lines"                       "never claims zero OOM lines from an unread journal"

echo "== C: genuinely OOM-killed box =="
reset_stubs
printf '%s\n' '#!/usr/bin/env bash' 'echo "kernel: Memory cgroup out of memory: Killed process 1 (node) anon-rss:2.9GB"' > "$BIN/journalctl"
cat >"$BIN/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  inspect) [[ "$*" == *"{{.Id}}"* ]] && { echo deadbeef; exit 0; }
           [[ "$*" == *"{{.Created}}"* ]] && { date -u -d "-2 hours" +%Y-%m-%dT%H:%M:%SZ; exit 0; }
           echo "oomkilled=true exitcode=137 restarts=3"; exit 0;;
  stats)   echo "usage=2.95GiB / 3GiB"; exit 0;;
  events)  echo "1790780775 die exitCode=137"; echo "1790780791 start exitCode="; exit 0;;
esac
STUB
chmod +x "$BIN"/*
out="$(run_scenario)"
assert_says "$out" "oomkilled=true"                            "surfaces the OOMKilled flag"
assert_says "$out" "Killed process"                            "surfaces the kernel kill line"
assert_says "$out" "kernel OOM-killer DID fire"                "calls a real OOM CONCLUSIVE"
assert_says "$out" "die exitCode=137"                          "surfaces the die event"

echo "== D: healthy box, long-lived container, genuinely quiet =="
reset_stubs
printf '%s\n' '#!/usr/bin/env bash' 'echo "kernel: nothing interesting"' > "$BIN/journalctl"
cat >"$BIN/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  inspect) [[ "$*" == *"{{.Id}}"* ]] && { echo deadbeef; exit 0; }
           [[ "$*" == *"{{.Created}}"* ]] && { date -u -d "-10 days" +%Y-%m-%dT%H:%M:%SZ; exit 0; }
           echo "oomkilled=false exitcode=0 restarts=0"; exit 0;;
  stats)   echo "usage=1.4GiB / 3GiB"; exit 0;;
  events)  exit 0;;
esac
STUB
chmod +x "$BIN"/*
out="$(run_scenario)"
assert_says "$out" "zero OOM-killer lines in range"            "a read journal with no OOM is CONCLUSIVE"
assert_says "$out" "zero lifecycle events"                     "an empty ring older than the container is CONCLUSIVE"

echo "== E: empty event ring but the container is NEWER than the window =="
# The live false positive: the daemon reported a quiet 24h for a container it
# had created 1h42m earlier. The ring had rolled; the filter is applied at read
# time and cannot recover evicted events.
reset_stubs
printf '%s\n' '#!/usr/bin/env bash' 'echo "kernel: nothing interesting"' > "$BIN/journalctl"
cat >"$BIN/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  inspect) [[ "$*" == *"{{.Id}}"* ]] && { echo deadbeef; exit 0; }
           [[ "$*" == *"{{.Created}}"* ]] && { date -u -d "-2 hours" +%Y-%m-%dT%H:%M:%SZ; exit 0; }
           echo "oomkilled=false exitcode=0 restarts=0"; exit 0;;
  stats)   echo "usage=1.4GiB / 3GiB"; exit 0;;
  events)  exit 0;;
esac
STUB
chmod +x "$BIN"/*
out="$(run_scenario)"
assert_says "$out" "INCONCLUSIVE: no lifecycle events returned" "a rolled ring is INCONCLUSIVE, not a quiet container"
assert_not  "$out" "zero lifecycle events"                      "never claims a quiet 24h for a container younger than the window"

echo
if [ "$fail" = 0 ]; then echo "PASS — paperclip-restart-forensics"; else echo "FAIL — paperclip-restart-forensics" >&2; fi
exit "$fail"
