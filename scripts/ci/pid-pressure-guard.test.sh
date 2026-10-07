#!/usr/bin/env bash
# Tests for infra/scripts/pid-pressure-guard.sh (GOL-3002).
#
# The guard is the only thing standing between another silent 4.8-day pid leak
# and another 60-run failure storm, so every branch gets pinned here. A guard
# that only speaks on failure is indistinguishable from a dead guard, so these
# assert BOTH directions: the healthy case must stay SILENT, and each unhealthy
# case must produce an alert naming the specific reason.
#
# Driven entirely through env seams — no docker daemon, no real cgroup, no real
# zombies:
#   DOCKER_BIN    — a stub shell script that answers `inspect -f <fmt>`
#   CGROUP_ROOT   — fixture dir holding pids.current / pids.max / pids.events
#   PROC_ROOT     — fixture dir of synthetic /proc/<pid>/stat files
#   ALERT_SINK    — file the alert body is appended to instead of Discord
#   ENV_FILE      — /dev/null, so there is never a webhook URL in play
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="${REPO_ROOT}/infra/scripts/pid-pressure-guard.sh"
FAILED=0
CID="abc123def456"
HOST_PID1=4242

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; FAILED=1; }

[ -x "${GUARD}" ] || { echo "::error::${GUARD} is missing or not executable" >&2; exit 1; }

# --- fixtures --------------------------------------------------------------

new_case() { # $1 = label ; echoes fixture root
  local root; root="$(mktemp -d)"
  mkdir -p "${root}/cgroup/system.slice/docker-${CID}.scope" "${root}/proc" "${root}/log"
  echo "${root}"
}

make_docker_stub() { # $1 = root, $2 = running, $3 = init
  local root="$1" running="$2" init="$3"
  cat > "${root}/docker" <<STUB
#!/usr/bin/env bash
# minimal \`docker inspect -f <fmt> <name>\` stub
if [ "\$1" = "inspect" ]; then
  case "\$3" in
    '{{.Id}}')                 echo "${CID}" ;;
    '{{.State.Pid}}')          echo "${HOST_PID1}" ;;
    '{{.State.Running}}')      echo "${running}" ;;
    '{{.HostConfig.Init}}')    echo "${init}" ;;
    '{{.State.StartedAt}}')    echo "2026-09-30T22:23:00Z" ;;
    *)                         echo "" ;;
  esac
  exit 0
fi
exit 1
STUB
  chmod +x "${root}/docker"
}

set_cgroup() { # $1 = root, $2 = current, $3 = max, $4 = events-max
  local d="$1/cgroup/system.slice/docker-${CID}.scope"
  echo "$2" > "${d}/pids.current"
  echo "$3" > "${d}/pids.max"
  printf 'max %s\n' "$4" > "${d}/pids.events"
}

# Write N synthetic zombie stat files parented to HOST_PID1, plus some noise the
# guard must NOT count: a running process, a zombie owned by another container,
# and a comm containing spaces and parens (the field-splitting trap).
seed_proc() { # $1 = root, $2 = zombie count
  local root="$1" n="$2" i pid
  for (( i=0; i<n; i++ )); do
    pid=$(( 10000 + i ))
    mkdir -p "${root}/proc/${pid}"
    printf '%s (bash) Z %s 0 0 0 -1 0 0\n' "${pid}" "${HOST_PID1}" > "${root}/proc/${pid}/stat"
  done
  # noise: live (S) child of our PID 1 — must not count
  mkdir -p "${root}/proc/9001"; printf '9001 (node) S %s 0 0\n' "${HOST_PID1}" > "${root}/proc/9001/stat"
  # noise: zombie parented to a DIFFERENT pid (co-tenant container) — must not count
  mkdir -p "${root}/proc/9002"; printf '9002 (git) Z 777 0 0\n' > "${root}/proc/9002/stat"
  # noise: comm with spaces AND a close-paren, zombie but NOT ours — must not count
  mkdir -p "${root}/proc/9003"; printf '9003 (chrome (renderer)) Z 777 0 0\n' > "${root}/proc/9003/stat"
  # noise: comm with spaces and parens, zombie AND ours — MUST count
  mkdir -p "${root}/proc/9004"; printf '9004 (chrome (renderer)) Z %s 0 0\n' "${HOST_PID1}" > "${root}/proc/9004/stat"
}

run_guard() { # $1 = root ; remaining args = extra env assignments
  local root="$1"; shift
  env -u DISCORD_OPS_WEBHOOK_URL \
    PATH="${root}:${PATH}" \
    DOCKER_BIN="${root}/docker" \
    CGROUP_ROOT="${root}/cgroup" \
    PROC_ROOT="${root}/proc" \
    ENV_FILE=/dev/null \
    ALERT_SINK="${root}/alerts.txt" \
    STAMP_FILE="${root}/log/guard.stamp" \
    "$@" \
    "${GUARD}" > "${root}/out.log" 2>&1
  echo $? > "${root}/rc"
}

alerts() { [ -f "$1/alerts.txt" ] && cat "$1/alerts.txt" || true; }
alert_count() { [ -f "$1/alerts.txt" ] && grep -c 'pid pressure on' "$1/alerts.txt" || echo 0; }

expect_rc0() { # $1 = root, $2 = label
  local rc; rc="$(cat "$1/rc")"
  if [ "${rc}" = "0" ]; then pass "$2: exit 0"
  else fail "$2: expected exit 0, got ${rc}"; sed 's/^/      | /' "$1/out.log" >&2; fi
}
expect_silent() { # $1 = root, $2 = label
  if [ "$(alert_count "$1")" = "0" ]; then pass "$2: no alert (silent)"
  else fail "$2: expected NO alert, got:"; sed 's/^/      | /' "$1/alerts.txt" >&2; fi
}
expect_alert_matching() { # $1 = root, $2 = label, $3 = grep -E pattern
  if alerts "$1" | grep -Eq "$3"; then pass "$2: alert matches /$3/"
  else fail "$2: alert did not match /$3/; body was:"; alerts "$1" | sed 's/^/      | /' >&2; fi
}

echo "== healthy: well under every threshold ⇒ SILENT =="
R="$(new_case)"; make_docker_stub "${R}" true true
set_cgroup "${R}" 95 2048 0; seed_proc "${R}" 0
run_guard "${R}"
expect_rc0 "${R}" "healthy"
expect_silent "${R}" "healthy"
# The guard must still leave a trail even when silent, else a dead timer and a
# healthy box look identical in the log.
if grep -q 'pids=95/2048' "${R}/out.log"; then pass "healthy: logged the observation line"
else fail "healthy: expected an observation line in the log"; sed 's/^/      | /' "${R}/out.log" >&2; fi

echo "== pids.events max > 0 ⇒ CRITICAL (the cap was already hit) =="
R="$(new_case)"; make_docker_stub "${R}" true true
# Exactly the 2026-10-05 reading.
set_cgroup "${R}" 2043 2048 542; seed_proc "${R}" 0
run_guard "${R}"
expect_rc0 "${R}" "events"
expect_alert_matching "${R}" "events" 'rotating_light'
expect_alert_matching "${R}" "events" 'pid cap has ALREADY been hit \*\*542'
expect_alert_matching "${R}" "events" 'GOL-3002'

echo "== pid budget >= 50% ⇒ WARNING =="
R="$(new_case)"; make_docker_stub "${R}" true true
set_cgroup "${R}" 1024 2048 0; seed_proc "${R}" 0
run_guard "${R}"
expect_rc0 "${R}" "pct"
expect_alert_matching "${R}" "pct" 'pid budget at \*\*50%\*\*'
expect_alert_matching "${R}" "pct" 'warning|:warning:'

echo "== pid budget just under the threshold ⇒ SILENT (no off-by-one) =="
R="$(new_case)"; make_docker_stub "${R}" true true
set_cgroup "${R}" 1023 2048 0; seed_proc "${R}" 0
run_guard "${R}"
expect_silent "${R}" "49%"

echo "== standing zombies ⇒ WARNING, and only OURS are counted =="
R="$(new_case)"; make_docker_stub "${R}" true false
# 120 ours + the 1 parenthesised comm that is ours = 121; the 3 noise entries
# (live child, other-parent zombie, other-parent parenthesised zombie) must not count.
set_cgroup "${R}" 300 2048 0; seed_proc "${R}" 120
run_guard "${R}"
expect_rc0 "${R}" "zombies"
expect_alert_matching "${R}" "zombies" '\*\*121\*\* zombie processes'
expect_alert_matching "${R}" "zombies" 'HostConfig.Init=false'

echo "== zombies just under the threshold ⇒ SILENT =="
R="$(new_case)"; make_docker_stub "${R}" true true
set_cgroup "${R}" 300 2048 0; seed_proc "${R}" 98   # 98 + 1 parenthesised = 99
run_guard "${R}"
expect_silent "${R}" "99 zombies"

echo "== container not running ⇒ SILENT (restart policy / health check own that) =="
R="$(new_case)"; make_docker_stub "${R}" false true
set_cgroup "${R}" 2043 2048 542; seed_proc "${R}" 200
run_guard "${R}"
expect_rc0 "${R}" "stopped"
expect_silent "${R}" "stopped"

echo "== pids.max = \"max\" (no cap) ⇒ no percentage alarm =="
R="$(new_case)"; make_docker_stub "${R}" true true
set_cgroup "${R}" 99999 max 0; seed_proc "${R}" 0
run_guard "${R}"
expect_rc0 "${R}" "uncapped"
expect_silent "${R}" "uncapped"

echo "== cooldown: same level is suppressed, an ESCALATION is not =="
R="$(new_case)"; make_docker_stub "${R}" true true
set_cgroup "${R}" 1024 2048 0; seed_proc "${R}" 0
run_guard "${R}"
if [ "$(alert_count "${R}")" = "1" ]; then pass "cooldown: first warning posted"
else fail "cooldown: expected 1 alert, got $(alert_count "${R}")"; fi
run_guard "${R}"   # same level, within cooldown
if [ "$(alert_count "${R}")" = "1" ]; then pass "cooldown: repeat warning suppressed"
else fail "cooldown: expected the repeat to be suppressed, total=$(alert_count "${R}")"; fi
set_cgroup "${R}" 2043 2048 542   # escalate warning -> critical
run_guard "${R}"
if [ "$(alert_count "${R}")" = "2" ]; then pass "cooldown: escalation to critical NOT suppressed"
else fail "cooldown: escalation should post, total=$(alert_count "${R}")"; fi
expect_alert_matching "${R}" "cooldown" 'rotating_light'

echo "== no docker CLI ⇒ quiet exit 0, never a false all-clear alert =="
R="$(new_case)"
run_guard "${R}" DOCKER_BIN="${R}/definitely-not-docker"
expect_rc0 "${R}" "no-docker"
expect_silent "${R}" "no-docker"

echo "== the compose service it guards actually has init: true =="
# Pins the fix itself: if someone drops `init: true` from paperclip-server, the
# guard's whole premise (steady-state zombies ~0) is void. Cheap structural check.
# PyYAML is not guaranteed on every runner image, so parse the block in awk:
# walk from the `paperclip-server:` service key to the next top-level service
# key, and require an `init: true` line at service-key indentation inside it.
if awk '
  /^  [a-zA-Z0-9_.-]+:[[:space:]]*$/ { in_svc = ($1 == "paperclip-server:"); next }
  in_svc && /^    init:[[:space:]]*true[[:space:]]*$/ { found = 1 }
  END { exit(found ? 0 : 1) }
' "${REPO_ROOT}/docker-compose.yml"; then
  pass "docker-compose.yml: paperclip-server has init: true"
else
  fail "docker-compose.yml: paperclip-server lost init: true — the pid leak (GOL-3002) is back"
fi

# Negative control for the check above: the same matcher must NOT find init:true
# in a copy with the line removed, otherwise the assertion is vacuous.
NEG="$(mktemp)"; grep -v '^    init: true$' "${REPO_ROOT}/docker-compose.yml" > "${NEG}"
if awk '
  /^  [a-zA-Z0-9_.-]+:[[:space:]]*$/ { in_svc = ($1 == "paperclip-server:"); next }
  in_svc && /^    init:[[:space:]]*true[[:space:]]*$/ { found = 1 }
  END { exit(found ? 0 : 1) }
' "${NEG}"; then
  fail "init:true matcher is vacuous — it still passed with the line removed"
else
  pass "init:true matcher has a working negative control"
fi
rm -f "${NEG}"

echo
if [ "${FAILED}" -ne 0 ]; then
  echo "pid-pressure-guard.test.sh: FAILED" >&2
  exit 1
fi
echo "pid-pressure-guard.test.sh: all checks passed"
