#!/usr/bin/env bash
#
# merge-queue-arm-sweep.test.sh — offline harness for the GOL-3125 host wrapper
# (infra/scripts/merge-queue-arm-sweep.sh) and for the thing that pattern is
# structurally bad at: keeping the systemd unit bodies in the root installer in
# sync with the inline copies in cloud-init. A rebuilt droplet that silently
# loses the timer is the failure the ticket called out by name, and only a test
# catches it.
#
# No network, no docker, no broker: stubbed `docker` + `curl` on PATH and a fake
# sweep that records its argv and environment. Proves:
#   1. ARM_PROTECTED=1 is refused (exit 2) and NO repo is swept — the board-gated
#      override can never be reached from the timer,
#   2. the happy path sweeps every target repo with ARM_UNAPPROVED=1,
#      ARM_PROTECTED=0, REPO=<that repo> and --apply,
#   3. --dry-run drops --apply (and nothing else),
#   4. an unreachable broker fails loudly (exit 1) + alerts, and sweeps nothing,
#   5. vendor drift WARNs + alerts but still runs the sweep (a drift check that
#      could stop the timer would reintroduce the bug this ticket deletes),
#   6. one failing repo does not stop the others, and the run exits 1,
#   7. the installer's unit bodies == cloud-init's inline unit bodies.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WRAPPER="$ROOT/infra/scripts/merge-queue-arm-sweep.sh"
INSTALLER="$ROOT/infra/scripts/install-merge-queue-arm-sweep.sh"
CLOUDINIT="$ROOT/infra/cloud-init/droplet-bootstrap.yaml.tpl"
VENDORED="$ROOT/infra/scripts/vendored/merge-queue-arm-automerge.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; mkdir -p "$BIN"
PASS=0; FAIL=0
ok()   { echo "  ok   — $*"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL — $*"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# --- stubs ------------------------------------------------------------------
cat >"$BIN/docker" <<'STUB'
#!/usr/bin/env bash
# `docker inspect gh-token-broker` -> one-network container JSON, or empty when
# FAKE_DOCKER_DEAD=1 (container gone / not running).
[ "${FAKE_DOCKER_DEAD:-0}" = "1" ] && exit 1
[ "${1:-}" = inspect ] || exit 9
cat <<'J'
[{"NetworkSettings":{"Networks":{"agenticos_default":{"IPAddress":"172.18.0.9"}}}}]
J
STUB

cat >"$BIN/curl" <<'STUB'
#!/usr/bin/env bash
# Routes by URL substring. Records every call. -o <file> honoured so the drift
# check's raw-contents fetch lands somewhere real.
set -uo pipefail
out=""; url=""; data=""
args=("$@")
for ((i=0;i<${#args[@]};i++)); do
  case "${args[i]}" in
    -o) out="${args[i+1]}" ;;
    -d) data="${args[i+1]}" ;;
    http*) url="${args[i]}" ;;
  esac
done
echo "$url" >>"$FAKE_CURL_LOG"
case "$url" in
  */health)  exit 0 ;;
  */token\?*) echo '{"token":"ghs_faketoken"}'; exit 0 ;;
  *contents*)
    # The canonical copy. FAKE_REMOTE_FILE decides sync vs drift.
    [ -n "$out" ] && cp "${FAKE_REMOTE_FILE}" "$out" || cat "${FAKE_REMOTE_FILE}"
    exit 0 ;;
  *discord*)
    # One line per CALL: `jq -n` pretty-prints, so the raw body spans lines and
    # counting lines would read one alert as three.
    printf '%s\n' "$(printf '%s' "$data" | tr '\n' ' ')" >>"$FAKE_DISCORD_LOG"; exit 0 ;;
esac
exit 0
STUB

# Fake sweep: records argv + the env the wrapper handed it, one line per call.
cat >"$WORK/fake-sweep.sh" <<'STUB'
#!/usr/bin/env bash
printf 'REPO=%s ARM_UNAPPROVED=%s ARM_PROTECTED=%s BROKER=%s KEY=%s ARGV=%s\n' \
  "${REPO:-}" "${ARM_UNAPPROVED:-}" "${ARM_PROTECTED:-}" \
  "${GH_TOKEN_BROKER_URL:-}" "${GH_BROKER_API_KEY_FILE:-}" "$*" >>"$FAKE_SWEEP_LOG"
echo "12:00:00Z repo=${REPO} apply"
if [ "${FAKE_SWEEP_FAIL_REPO:-}" = "${REPO}" ]; then
  echo "12:00:00Z WARN could not arm #1"; exit 1
fi
echo "12:00:01Z armed #101 (head abcdef123) as agenticos-developer"
exit 0
STUB
chmod +x "$BIN/docker" "$BIN/curl" "$WORK/fake-sweep.sh"

mkdir -p "$WORK/secrets"
echo "brokerkey" >"$WORK/secrets/gh-broker-client.key"
printf 'DISCORD_OPS_WEBHOOK_URL=https://discord.example/api/webhooks/1/x\n' >"$WORK/.env"
# The drift check hashes whatever $SWEEP points at, which under test is the fake
# sweep — so the "canonical" fixtures are built from the fake, not the vendored
# file. (Test 8 separately pins the installer's ExecStart to the real wrapper,
# and the real wrapper's SWEEP default to the real vendored copy.)
cp "$WORK/fake-sweep.sh" "$WORK/remote-in-sync.sh"
{ cat "$WORK/fake-sweep.sh"; echo "# drifted"; } >"$WORK/remote-drifted.sh"

VENDOR_SHA="$(sha256sum "$WORK/fake-sweep.sh" | cut -d' ' -f1)"

run_wrapper() { # extra env as KEY=VAL..., then flags after `--`
  local -a envs=() flags=()
  while [ $# -gt 0 ]; do
    [ "$1" = "--" ] && { shift; flags=("$@"); break; }
    envs+=("$1"); shift
  done
  : >"$WORK/sweep.log"; : >"$WORK/curl.log"; : >"$WORK/discord.log"
  set +e
  # The sandbox/agent environment already exports GH_TOKEN_BROKER_URL and
  # GH_BROKER_API_KEY_FILE; leaving them set would make the wrapper skip the
  # docker-inspect resolution under test and quietly pass test 4.
  PATH="$BIN:$PATH" env -u GH_TOKEN_BROKER_URL -u GH_BROKER_API_KEY_FILE \
    -u ARM_PROTECTED -u ARM_UNAPPROVED -u TARGET_REPOS -u SKIP_DRIFT_CHECK \
    REPO_DIR="$WORK" \
    ENV_FILE="$WORK/.env" \
    BROKER_KEY_FILE="$WORK/secrets/gh-broker-client.key" \
    SWEEP="$WORK/fake-sweep.sh" \
    CANONICAL_SHA256="$VENDOR_SHA" \
    FAKE_SWEEP_LOG="$WORK/sweep.log" \
    FAKE_CURL_LOG="$WORK/curl.log" \
    FAKE_DISCORD_LOG="$WORK/discord.log" \
    FAKE_REMOTE_FILE="$WORK/remote-in-sync.sh" \
    "${envs[@]}" \
    bash "$WRAPPER" "${flags[@]+"${flags[@]}"}" >"$WORK/out.txt" 2>&1
  RC=$?
  set -e
}

echo "== 1. ARM_PROTECTED=1 is refused, and nothing is swept"
run_wrapper ARM_PROTECTED=1 TARGET_REPOS="o/a"
check "exits 2" "$RC" "2"
check "no repo swept" "$(wc -l <"$WORK/sweep.log" | tr -d ' ')" "0"
grep -q 'board decision' "$WORK/out.txt" && ok "names the board decision" || bad "no board-decision reason"
# Any non-zero value, not just 1 — ARM_PROTECTED=true must not slip through.
run_wrapper ARM_PROTECTED=true TARGET_REPOS="o/a"
check "ARM_PROTECTED=true also refused" "$RC" "2"

echo "== 2. happy path: every repo swept, with the right env and --apply"
run_wrapper TARGET_REPOS="o/a o/b o/c"
check "exits 0" "$RC" "0"
check "swept 3 repos" "$(wc -l <"$WORK/sweep.log" | tr -d ' ')" "3"
check "repo order/identity" "$(cut -d' ' -f1 <"$WORK/sweep.log" | tr '\n' ',')" "REPO=o/a,REPO=o/b,REPO=o/c,"
check "ARM_UNAPPROVED=1 on every call" "$(grep -c 'ARM_UNAPPROVED=1 ' "$WORK/sweep.log")" "3"
check "ARM_PROTECTED=0 on every call"  "$(grep -c 'ARM_PROTECTED=0 ' "$WORK/sweep.log")" "3"
check "--apply on every call"          "$(grep -c 'ARGV=--apply' "$WORK/sweep.log")" "3"
check "broker URL from docker inspect" "$(grep -c 'BROKER=http://172.18.0.9:9099' "$WORK/sweep.log")" "3"
check "broker key path passed through" "$(grep -c "KEY=$WORK/secrets/gh-broker-client.key" "$WORK/sweep.log")" "3"
grep -q 'armed=3' "$WORK/out.txt" && ok "counts 3 armed PRs" || bad "armed count wrong: $(grep done "$WORK/out.txt")"
check "no Discord alert on a clean run" "$(wc -l <"$WORK/discord.log" | tr -d ' ')" "0"

echo "== 3. --dry-run drops --apply and nothing else"
run_wrapper TARGET_REPOS="o/a" -- --dry-run
check "exits 0" "$RC" "0"
check "swept 1 repo" "$(wc -l <"$WORK/sweep.log" | tr -d ' ')" "1"
grep -q 'ARGV=$' "$WORK/sweep.log" && ok "no --apply passed" || bad "argv was: $(cat "$WORK/sweep.log")"
check "still ARM_UNAPPROVED=1" "$(grep -c 'ARM_UNAPPROVED=1 ' "$WORK/sweep.log")" "1"

echo "== 4. unreachable broker fails loudly and sweeps nothing"
run_wrapper FAKE_DOCKER_DEAD=1 TARGET_REPOS="o/a"
check "exits 1" "$RC" "1"
check "no repo swept" "$(wc -l <"$WORK/sweep.log" | tr -d ' ')" "0"
check "alerted once" "$(wc -l <"$WORK/discord.log" | tr -d ' ')" "1"
grep -q 'NOT being armed' "$WORK/discord.log" && ok "alert says PRs are not being armed" || bad "alert text unhelpful"

echo "== 5. vendor drift warns but still sweeps"
run_wrapper TARGET_REPOS="o/a" FAKE_REMOTE_FILE="$WORK/remote-drifted.sh"
check "exits 0 anyway" "$RC" "0"
check "repo still swept" "$(wc -l <"$WORK/sweep.log" | tr -d ' ')" "1"
grep -q 'vendor drift' "$WORK/out.txt" && ok "logs the drift" || bad "drift not logged"
grep -q 'vendor drift' "$WORK/discord.log" && ok "alerts the drift" || bad "drift not alerted"

echo "== 5b. an edited-in-place vendored copy is caught without a network read"
run_wrapper TARGET_REPOS="o/a" CANONICAL_SHA256=0000000000000000000000000000000000000000000000000000000000000000
check "exits 0 anyway" "$RC" "0"
grep -q 'edited in place' "$WORK/out.txt" && ok "names the in-place edit" || bad "in-place edit not reported"
check "no contents fetch attempted" "$(grep -c contents "$WORK/curl.log" || true)" "0"

echo "== 6. one failing repo does not stop the rest"
run_wrapper TARGET_REPOS="o/a o/b o/c" FAKE_SWEEP_FAIL_REPO=o/b
check "exits 1" "$RC" "1"
check "all 3 still swept" "$(wc -l <"$WORK/sweep.log" | tr -d ' ')" "3"
grep -q 'failed_repos=1' "$WORK/out.txt" && ok "reports 1 failed repo" || bad "failed_repos wrong"
grep -q 'o/b' "$WORK/discord.log" && ok "alert names the failing repo" || bad "alert does not name o/b"

echo "== 7. installer unit bodies == cloud-init inline unit bodies"
python3 - "$INSTALLER" "$CLOUDINIT" <<'PY'
import re, sys
installer, cloudinit = open(sys.argv[1]).read(), open(sys.argv[2]).read()
UNITS = ["agenticos-merge-queue-arm.service", "agenticos-merge-queue-arm.timer"]

def norm(body):
    body = body.replace("${REPO}", "/opt/agenticos/repo").replace("${LOG_DIR}", "/var/log/agenticos")
    return [l.strip() for l in body.splitlines() if l.strip()]

def from_installer(unit):
    m = re.search(r"install_unit %s <<UNIT\n(.*?)\nUNIT\n" % re.escape(unit), installer, re.S)
    assert m, "installer has no heredoc for " + unit
    return norm(m.group(1))

def from_cloudinit(unit):
    m = re.search(r"- path: /etc/systemd/system/%s\n\s+permissions: \"0644\"\n\s+content: \|\n(.*?)(?=\n  [-#]|\n\n  [-#])"
                  % re.escape(unit), cloudinit, re.S)
    assert m, "cloud-init has no write_files entry for " + unit
    return norm(m.group(1))

rc = 0
for u in UNITS:
    a, b = from_installer(u), from_cloudinit(u)
    if a == b:
        print("  ok   — %s identical in installer and cloud-init (%d lines)" % (u, len(a)))
    else:
        rc = 1
        print("  FAIL — %s DIFFERS between installer and cloud-init" % u)
        for l in sorted(set(a) ^ set(b)):
            print("           %s %s" % ("installer-only:" if l in a else "cloud-init-only:", l))
# The thing both copies exist to guarantee: a fresh droplet enables the timer.
if re.search(r"systemctl enable --now agenticos-merge-queue-arm\.timer", cloudinit):
    print("  ok   — cloud-init enables agenticos-merge-queue-arm.timer on a fresh box")
else:
    rc = 1; print("  FAIL — cloud-init never enables agenticos-merge-queue-arm.timer")
sys.exit(rc)
PY
if [ $? -eq 0 ]; then PASS=$((PASS+3)); else FAIL=$((FAIL+1)); fi

echo "== 8. the units point at scripts that exist and parse"
for f in "$WRAPPER" "$INSTALLER" "$VENDORED"; do
  if [ -x "$f" ] && bash -n "$f" 2>/dev/null; then ok "$(basename "$f") executable + parses"
  else bad "$(basename "$f") missing, not executable, or has a syntax error"; fi
done
# The ExecStart path in the installer must be the wrapper we just tested.
grep -q "ExecStart=/bin/bash -lc '\${REPO}/infra/scripts/merge-queue-arm-sweep.sh'" "$INSTALLER" \
  && ok "installer ExecStart points at the wrapper" || bad "installer ExecStart path drifted"
# Every other test overrides SWEEP, so pin the production default explicitly.
grep -q 'SWEEP="\${SWEEP:-\${REPO_DIR}/infra/scripts/vendored/merge-queue-arm-automerge.sh}"' "$WRAPPER" \
  && ok "wrapper defaults SWEEP to the vendored copy" || bad "wrapper SWEEP default drifted"
# And the committed pin must match the committed vendored file, or the very first
# real tick would alert "edited in place" forever.
WANT="$(sha256sum "$VENDORED" | cut -d' ' -f1)"
grep -q "CANONICAL_SHA256:-$WANT" "$WRAPPER" \
  && ok "CANONICAL_SHA256 pin matches the vendored file" \
  || bad "CANONICAL_SHA256 pin != sha256($VENDORED) = $WANT"
grep -q "$WANT" "$ROOT/infra/scripts/vendored/README.md" \
  && ok "vendor README records the same sha256" || bad "vendor README sha256 is stale"
# The unit ExecStarts out of /opt/agenticos/repo, which deploy-host-scripts.yml
# builds by `git reset --hard origin/main`. An UNTRACKED vendored sweep would
# therefore not exist on the box and the timer would fail every tick with a
# missing file. Caught for real on GOL-3125: .gitignore has a repo-wide
# `vendor/` rule, which silently swallowed the first `infra/scripts/vendor/`.
for f in "$VENDORED" "$WRAPPER" "$INSTALLER"; do
  rel="${f#"$ROOT"/}"
  if git -C "$ROOT" ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
    ok "$rel is tracked by git (so it reaches /opt/agenticos/repo)"
  else
    bad "$rel is NOT tracked by git — it will never land on the droplet (gitignored?)"
  fi
done

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
