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
#   7. the installer's unit bodies == cloud-init's inline unit bodies,
#   11. the installer installs WITHOUT root, via `systemctl link` under the
#       deploy user's passwordless-systemctl sudoers rule — never writing
#       /etc/systemd/system itself — and deploy-host-scripts.yml runs it, so no
#       human has to paste anything to install the timer.
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

echo "== 9. the installer refuses a stale clone instead of failing every 5 minutes"
# The unit ExecStarts out of ${REPO}. Installed against a clone that predates the
# GOL-3125 merge, it would install cleanly and then fail on a missing file on
# every single tick, forever, with nothing but a growing log to say so. The
# pre-flight has to refuse BEFORE it writes anything to /etc/systemd/system —
# which is also what makes this case safe to run for real here.
cat >"$BIN/id" <<'STUB'
#!/usr/bin/env bash
# Pretend to be root so the installer reaches the pre-flight under test. It must
# still refuse before any /etc write, which is why this is safe.
[ "${1:-}" = "-u" ] && { echo 0; exit 0; }
exec /usr/bin/id "$@"
STUB
chmod +x "$BIN/id"
mkdir -p "$WORK/staleclone"
set +e
PATH="$BIN:$PATH" env REPO="$WORK/staleclone" LOG_DIR="$WORK/log" \
  BROKER_KEY="$WORK/secrets/gh-broker-client.key" \
  bash "$INSTALLER" >"$WORK/inst.txt" 2>&1
RC=$?
set -e
check "refuses a clone missing the payload (exit 1)" "$RC" "1"
grep -q 'merge-queue-arm-sweep.sh does not exist' "$WORK/inst.txt" \
  && ok "names the missing file" || bad "does not name the missing file"
grep -q 'Deploy Host Scripts' "$WORK/inst.txt" \
  && ok "points at the safe refresh (deploy-host-scripts.yml)" || bad "no safe-refresh remedy"
grep -q "Do NOT 'git reset --hard'" "$WORK/inst.txt" \
  && ok "warns off the hand-reset (GOL-2591 dist revert)" || bad "no GOL-2591 warning"
grep -q 'wrote /etc/systemd/system' "$WORK/inst.txt" \
  && bad "wrote a unit before the pre-flight refused!" || ok "wrote nothing to /etc/systemd/system"
rm -f "$BIN/id"

# The remedy must stay a remedy, not become something the installer does itself:
# this clone bind-mounts the live plugin dists, so a bare reset here reverts them
# with no signal (GOL-2591). deploy-host-scripts.yml is the only refresh that
# pairs the reset with a rebuild + registry convergence.
# Anchored at start-of-line so the refusal message's own prose ("Do NOT 'git
# reset --hard' …") is not mistaken for a command.
if grep -qE '^[[:space:]]*(sudo(( -[^ ]+)* -u [^ ]+)? )?git +(-C [^ ]+ +)?(reset|pull|fetch|checkout)' "$INSTALLER"; then
  bad "installer mutates the host clone — that reverts bind-mounted plugin dists (GOL-2591)"
else
  ok "installer never git-resets/pulls the host clone"
fi

# A missing broker KEY never fixes itself; a broker container that is down right
# now does. Neither may block the install — an unguarded queue is worse than a
# warning, and the sweep already alerts on a dead broker at tick time.
grep -q 'WARNING: broker client key' "$INSTALLER" \
  && ok "warns (not errors) on a missing broker key" || bad "no broker-key pre-flight"
grep -q 'WARNING: the gh-token-broker container is not running' "$INSTALLER" \
  && ok "warns (not errors) on a down broker" || bad "no broker-container pre-flight"

echo "== 10. the install self-verifies instead of handing back a checklist"
grep -q 'merge-queue-arm-sweep.sh" --dry-run || DRY_RC=\$?' "$INSTALLER" \
  && ok "runs one --dry-run tick and captures its exit code" \
  || bad "installer does not self-verify with a dry-run"
# ...and a failed dry-run must NOT unwind the timer: the timer being live is the
# whole point of GOL-3125, and a transient broker blip must not leave the
# sequential queue unguarded behind a dead merge group.
awk '/Self-verifying with one --dry-run/,0' "$INSTALLER" | grep -qE '^\s*(exit [1-9]|systemctl (disable|stop))' \
  && bad "a failed self-verify unwinds or fails the install" \
  || ok "a failed self-verify leaves the timer enabled"
# The enable must happen BEFORE the self-verify, or a dry-run failure would mean
# the timer was never armed at all.
ENABLE_LINE=$(grep -nE '(systemctl|\$\{SC\[@\]\}") enable --now agenticos-merge-queue-arm\.timer' "$INSTALLER" | head -n1 | cut -d: -f1)
VERIFY_LINE=$(grep -n 'Self-verifying with one --dry-run' "$INSTALLER" | head -n1 | cut -d: -f1)
if [ -n "$ENABLE_LINE" ] && [ -n "$VERIFY_LINE" ] && [ "$ENABLE_LINE" -lt "$VERIFY_LINE" ]; then
  ok "timer is enabled before the self-verify runs"
else
  bad "self-verify runs before the timer is enabled (enable=$ENABLE_LINE verify=$VERIFY_LINE)"
fi

echo "== 11. the install needs no root: systemctl link under passwordless sudo"
# This is the whole reason GOL-3125 sat blocked: the first installer wrote
# /etc/systemd/system directly, so it needed root, and NO agent has root SSH to
# this droplet (probed, not assumed). cloud-init grants deploy
# `ALL=(ALL) NOPASSWD: /bin/systemctl` with no argument restriction, and
# `systemctl link <abs-path>` makes systemd do the /etc write. Prove the
# installer takes that path, and prove it touches ${SYSTEMD_DIR} with nothing
# but systemctl.
SUDO_LOG="$WORK/sudo.log"
cat >"$BIN/sudo" <<'STUB'
#!/usr/bin/env bash
# Stands in for the deploy user's NOPASSWD systemctl rule. Logs every systemctl
# invocation and succeeds; anything that is NOT `-n systemctl` is a bug in the
# installer (the rule covers systemctl and ufw only), so fail loudly on it.
args=("$@")
[ "${args[0]:-}" = "-n" ] || { echo "sudo called without -n: $*" >&2; exit 97; }
[ "${args[1]:-}" = "systemctl" ] || { echo "sudo called for non-systemctl: $*" >&2; exit 98; }
printf '%s
' "${args[*]:2}" >>"$SUDO_LOG"
[ "${args[2]:-}" = "--version" ] && { echo "systemd 249 (249.11-0ubuntu3)"; exit 0; }
exit 0
STUB
chmod +x "$BIN/sudo"

# A complete fake clone so the pre-flight passes and the self-verify has a sweep.
CLONE="$WORK/clone"
mkdir -p "$CLONE/infra/scripts/vendored"
printf '#!/usr/bin/env bash
echo "fake sweep $*"
exit 0
' >"$CLONE/infra/scripts/merge-queue-arm-sweep.sh"
printf '#!/usr/bin/env bash
exit 0
' >"$CLONE/infra/scripts/vendored/merge-queue-arm-automerge.sh"
chmod +x "$CLONE/infra/scripts/merge-queue-arm-sweep.sh" "$CLONE/infra/scripts/vendored/merge-queue-arm-automerge.sh"
FAKE_ETC="$WORK/etc-systemd"; FAKE_UNITS="$WORK/units"
mkdir -p "$FAKE_ETC" "$WORK/secrets"
: >"$WORK/secrets/gh-broker-client.key"

run_installer() { # extra env as KEY=VAL args; output -> $WORK/inst.txt, rc -> $RC
  : >"$SUDO_LOG"
  set +e
  # env -u: the ambient agent environment exports broker vars, and a test that
  # passes because of them is a test that proves nothing (GOL-3125, twice).
  PATH="$BIN:$PATH" SUDO_LOG="$SUDO_LOG" \
    env -u ARM_PROTECTED -u GH_TOKEN_BROKER_URL -u GH_BROKER_API_KEY_FILE \
      REPO="$CLONE" LOG_DIR="$WORK/log" SYSTEMD_DIR="$FAKE_ETC" UNIT_DIR="$FAKE_UNITS" \
      BROKER_KEY="$WORK/secrets/gh-broker-client.key" "$@" \
      bash "$INSTALLER" >"$WORK/inst.txt" 2>&1
  RC=$?
  set -e
}

run_installer
check "non-root install succeeds (exit 0)" "$RC" "0"
grep -q 'Privilege: sudo-systemctl' "$WORK/inst.txt" \
  && ok "resolves to passwordless systemctl, not root" || bad "did not take the sudo-systemctl path"
# The load-bearing assertion: systemd did the /etc write, we did not.
if [ -z "$(ls -A "$FAKE_ETC")" ]; then
  ok "installer wrote NOTHING into \$SYSTEMD_DIR itself"
else
  bad "installer wrote into \$SYSTEMD_DIR directly: $(ls -A "$FAKE_ETC" | tr '\n' ' ')"
fi
for u in agenticos-merge-queue-arm.service agenticos-merge-queue-arm.timer; do
  [ -s "$FAKE_UNITS/$u" ] && ok "staged $u in \$UNIT_DIR" || bad "did not stage $u"
  grep -q "^link --force $FAKE_UNITS/$u\$" "$SUDO_LOG" \
    && ok "systemctl link'd $u" || bad "no 'systemctl link' for $u"
done
grep -qx 'daemon-reload' "$SUDO_LOG" && ok "daemon-reload via sudo systemctl" || bad "no daemon-reload"
grep -qx 'enable --now agenticos-merge-queue-arm.timer' "$SUDO_LOG" \
  && ok "enable --now via sudo systemctl" || bad "no enable --now"
# ${UNIT_DIR} must not live inside the clone: a linked unit's target has to
# survive `git reset --hard origin/main`, or systemd loses the unit on the next
# host-script deploy.
grep -qE '^UNIT_DIR="\$\{UNIT_DIR:-/opt/agenticos/units\}"' "$INSTALLER" \
  && ok "UNIT_DIR defaults outside the git clone" || bad "UNIT_DIR default drifted into the clone"

echo "== 11b. a fresh droplet (cloud-init already wrote real unit files) is a no-op"
# cloud-init's write_files puts REAL files there, which `systemctl link` will not
# and should not clobber. Identical body => nothing to do.
# `|| true`-free but non-fatal: if test 11 failed there is nothing staged to
# copy, and crashing the harness under `set -e` here would hide every remaining
# assertion (including test 12) behind one upstream failure.
if [ -s "$FAKE_UNITS/agenticos-merge-queue-arm.service" ] && [ -s "$FAKE_UNITS/agenticos-merge-queue-arm.timer" ]; then
  cp "$FAKE_UNITS/agenticos-merge-queue-arm.service" "$FAKE_ETC/"
  cp "$FAKE_UNITS/agenticos-merge-queue-arm.timer"   "$FAKE_ETC/"
  rm -rf "$FAKE_UNITS"
  run_installer
else
  bad "test 11 staged no units, so 11b cannot run"
  RC=1; : >"$SUDO_LOG"; : >"$WORK/inst.txt"
fi
check "still exits 0 against cloud-init's own files" "$RC" "0"
check "no link call at all" "$(grep -c '^link ' "$SUDO_LOG" || true)" "0"
check "both units reported identical" "$(grep -c 'already present and identical' "$WORK/inst.txt" || true)" "2"
grep -qx 'enable --now agenticos-merge-queue-arm.timer' "$SUDO_LOG" \
  && ok "still converges the enable (idempotent)" || bad "skipped the enable"

echo "== 11c. a DIFFERING regular unit file refuses instead of guessing"
printf '[Unit]\nDescription=hand-edited by someone\n' >"$FAKE_ETC/agenticos-merge-queue-arm.service"
run_installer
check "refuses (exit 1)" "$RC" "1"
grep -q 'exists as a regular file and DIFFERS' "$WORK/inst.txt" \
  && ok "says what is wrong" || bad "unclear refusal"
grep -q 'Re-run as root' "$WORK/inst.txt" \
  && ok "names root as the escalation" || bad "no escalation named"
check "enabled nothing on refusal" "$(grep -c 'enable --now' "$SUDO_LOG" || true)" "0"
rm -f "$BIN/sudo"; rm -rf "$FAKE_ETC" "$FAKE_UNITS"

echo "== 12. deploy-host-scripts.yml actually runs the installer"
# Without this the timer is still only installed when a human remembers — which
# is the identical shape of the bug this whole ticket deletes, moved one level up.
DEPLOY_WF="$ROOT/.github/workflows/deploy-host-scripts.yml"
grep -q 'bash infra/scripts/install-merge-queue-arm-sweep.sh' "$DEPLOY_WF" \
  && ok "deploy workflow invokes the installer" || bad "deploy workflow does not install the timer"
# It has to be reachable: the push path filter must cover the installer itself.
grep -q "infra/scripts/\*\*" "$DEPLOY_WF" \
  && ok "push path filter covers infra/scripts/**" || bad "installer changes would not trigger the deploy"
# Last step, so it can never block the clone refresh / dist rebuild above it.
# `|| true` on both: with pipefail a missing match aborts the harness before the
# summary, so the one failure that matters would take every later line with it.
INST_LINE=$( { grep -n 'install-merge-queue-arm-sweep.sh' "$DEPLOY_WF" || true; } | tail -n1 | cut -d: -f1)
LAST_STEP=$( { grep -n '^      - name:' "$DEPLOY_WF" || true; } | tail -n1 | cut -d: -f1)
if [ -n "$INST_LINE" ] && [ -n "$LAST_STEP" ] && [ "$INST_LINE" -gt "$LAST_STEP" ]; then
  ok "timer convergence is the final step"
else
  bad "timer convergence is not the last step (install=$INST_LINE last-step=$LAST_STEP)"
fi
python3 -c "
import sys
try: import yaml
except ImportError: sys.exit(0)
yaml.safe_load(open('$DEPLOY_WF'))
" && ok "deploy workflow still parses as YAML" || bad "deploy workflow YAML is broken"


echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
