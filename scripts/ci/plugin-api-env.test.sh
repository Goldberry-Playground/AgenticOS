#!/usr/bin/env bash
#
# plugin-api-env.test.sh — GOL-2686
#
# Offline harness for the readiness wait in scripts/plugin-api-env.sh. No droplet,
# no 1Password, no Docker daemon: a stubbed `docker` stands in for the pinned `op`
# container that reads the board key, and a throwaway localhost HTTP server stands
# in for paperclip-server:3100 — first refusing or 5xx-ing like a container that
# has been created but has not bound its port yet, then serving.
#
# What must hold:
#   1. an API that serves immediately         -> sourcing succeeds, one probe, no wait
#   2. an API that 5xxs and then serves       -> sourcing succeeds after retrying
#   3. an API that never answers              -> FATAL, nonzero, message names the URL
#   4. API_READY_TIMEOUT=0                    -> wait skipped entirely (escape hatch)
#   5. BOARD_KEY/PAPERCLIP_BASE are exported for the caller in the success cases
#
# Case 3 is the one that matters: the wait must delay a boot, never excuse an
# outage. Run 36662917269 died three seconds after a force-recreate with the whole
# diagnosis `fetch failed`; waiting is the fix, waiting forever would not be.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../plugin-api-env.sh"
[ -f "$SCRIPT" ] || { echo "FATAL: $SCRIPT missing" >&2; exit 1; }

WORK="$(mktemp -d)"
# The PID lives in a FILE, not a variable: every start_server call is made inside
# a `$(...)` command substitution to capture the port, and a subshell cannot set a
# variable in its parent. A PID variable here would silently stay empty, stop_server
# would kill nothing, and the "dead API" cases would race a live server.
trap 'p=$(cat "$WORK/pid" 2>/dev/null || true); [ -n "$p" ] && kill "$p" 2>/dev/null; rm -rf "$WORK"' EXIT

failures=0
check() { # check <name> <cond-exit> [detail]
  if [ "$2" = 0 ]; then echo "  ok   $1"; else
    failures=$(( failures + 1 )); echo "  FAIL $1${3:+ — $3}" >&2
  fi
}

# --- stubbed docker: only `docker run ... op read <ref>` is ever reached here,
# because every case presets PAPERCLIP_BASE and so skips `docker compose port`.
cat >"$WORK/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  run) echo "fake-board-key-abc123" ;;
  *) echo "fake docker: unexpected '$*'" >&2; exit 99 ;;
esac
DOCKER
chmod +x "$WORK/docker"
export PATH="$WORK:$PATH"

# --- fake credential-broker env (the board-key source the script requires) ----
mkdir -p "$WORK/secrets"
echo 'OP_SERVICE_ACCOUNT_TOKEN="ops_faketoken"' > "$WORK/secrets/credential-broker.env"
export BROKER_ENV="$WORK/secrets/credential-broker.env"

# --- a server that serves the first $1 requests as 503, then 200 --------------
cat >"$WORK/server.mjs" <<'SRV'
import { createServer } from "node:http";
const fail = Number(process.argv[2] || 0);
let n = 0;
createServer((req, res) => {
  n += 1;
  res.writeHead(n <= fail ? 503 : 200, { "content-type": "text/plain" });
  res.end(n <= fail ? "booting" : "ok");
}).listen(0, "127.0.0.1", function () {
  console.log(this.address().port);
});
SRV

start_server() { # start_server <n-failures> -> echoes the listening port
  : >"$WORK/port"
  node "$WORK/server.mjs" "$1" >"$WORK/port" &
  echo $! >"$WORK/pid"
  for _ in $(seq 1 50); do
    [ -s "$WORK/port" ] && break
    sleep 0.1
  done
  [ -s "$WORK/port" ] || { echo "FATAL: stub server never reported a port" >&2; exit 1; }
  cat "$WORK/port"
}
stop_server() {
  local p; p="$(cat "$WORK/pid" 2>/dev/null || true)"
  [ -n "$p" ] && kill "$p" 2>/dev/null || true
  : >"$WORK/pid"; : >"$WORK/port"
}

dead_port() { # a port nothing listens on: bind, read, release, then CONFIRM closed
  local p; p="$(start_server 0)"; stop_server
  # `kill` only asks. Poll until the socket is actually refusing, or the "dead
  # API" cases would race a still-listening server and pass for the wrong reason.
  for _ in $(seq 1 50); do
    curl -s -o /dev/null -m 2 "http://127.0.0.1:${p}/" || { echo "$p"; return 0; }
    sleep 0.1
  done
  echo "FATAL: could not free port ${p} for the dead-API cases" >&2
  exit 1
}

# Source the script in a child bash so a FATAL `exit 1` cannot kill this harness,
# and echo what it exported so the caller's contract is checked too.
probe() { # probe <base> [extra env assignments...]
  env "$@" bash -c '
    source "'"$SCRIPT"'" || exit $?
    echo "EXPORTED base=${PAPERCLIP_BASE} key=${BOARD_KEY}"
  ' 2>&1
}

echo "plugin-api-env.test.sh"

# 1 — serves immediately.
port="$(start_server 0)"
out="$(probe PAPERCLIP_BASE="http://127.0.0.1:${port}" BROKER_ENV="$BROKER_ENV" PATH="$PATH")" && rc=0 || rc=$?
check "serving API: sourcing succeeds" "$rc" "$out"
grep -q "EXPORTED base=http://127.0.0.1:${port} key=fake-board-key-abc123" <<<"$out" && rc=0 || rc=1
check "serving API: exports PAPERCLIP_BASE and BOARD_KEY" "$rc" "$out"
grep -q "waiting for" <<<"$out" && rc=1 || rc=0
check "serving API: no wait announced on a healthy box" "$rc" "$out"
stop_server

# 2 — 5xx twice, then serves (a container that is up but still binding).
port="$(start_server 2)"
out="$(probe PAPERCLIP_BASE="http://127.0.0.1:${port}" BROKER_ENV="$BROKER_ENV" PATH="$PATH" \
             API_READY_TIMEOUT=20 API_READY_POLL=1)" && rc=0 || rc=$?
check "booting API: sourcing succeeds after retrying (GOL-2686)" "$rc" "$out"
grep -q "ready after" <<<"$out" && rc=0 || rc=1
check "booting API: reports how many probes it took" "$rc" "$out"
stop_server

# 3 — never answers: must be FATAL, with an actionable message.
dp="$(dead_port)"
out="$(probe PAPERCLIP_BASE="http://127.0.0.1:${dp}" BROKER_ENV="$BROKER_ENV" PATH="$PATH" \
             API_READY_TIMEOUT=2 API_READY_POLL=1)" && rc=0 || rc=$?
[ "$rc" != 0 ] && rc2=0 || rc2=1
check "dead API: sourcing fails nonzero" "$rc2" "rc=$rc out=$out"
grep -q "FATAL" <<<"$out" && grep -q "127.0.0.1:${dp}" <<<"$out" && rc=0 || rc=1
check "dead API: FATAL message names the unreachable URL" "$rc" "$out"
grep -q "EXPORTED" <<<"$out" && rc=1 || rc=0
check "dead API: never hands a dead base URL to the caller" "$rc" "$out"

# 4 — the escape hatch: API_READY_TIMEOUT=0 skips the wait even when down.
out="$(probe PAPERCLIP_BASE="http://127.0.0.1:${dp}" BROKER_ENV="$BROKER_ENV" PATH="$PATH" \
             API_READY_TIMEOUT=0)" && rc=0 || rc=$?
check "API_READY_TIMEOUT=0 skips the wait" "$rc" "$out"
grep -q "EXPORTED base=http://127.0.0.1:${dp}" <<<"$out" && rc=0 || rc=1
check "API_READY_TIMEOUT=0 still exports the base URL" "$rc" "$out"

if [ "$failures" != 0 ]; then
  echo "" >&2; echo "${failures} assertion(s) failed" >&2; exit 1
fi
echo ""; echo "all assertions passed"
