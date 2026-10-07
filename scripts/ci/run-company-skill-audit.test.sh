#!/usr/bin/env bash
#
# run-company-skill-audit.test.sh — GOL-2994
#
# Offline harness for scripts/ops/run-company-skill-audit.sh, the scheduled
# on-droplet runner for the degraded-skill audit. No droplet, no 1Password, no
# Docker daemon, no Paperclip: a stubbed `docker` stands in for the pinned `op`
# container that reads the board key (mirroring plugin-api-env.test.sh), and a
# throwaway localhost HTTP server stands in for paperclip-server:3100 serving a
# two-company library — one clean, one holding the exact degraded install that
# cost GOL-2963 a cycle.
#
# What must hold:
#   1. no args           -> enumerates /api/companies and audits every library
#   2. explicit ids      -> audits only those, no enumeration call
#   3. PAPERCLIP_COMPANY_IDS -> same, from the environment
#   4. a clean library   -> exit 0
#   5. a degraded one    -> exit 1, and the dropped path is named in the report
#   6. worst-outcome-wins: clean + degraded together still exits 1
#   7. /api/companies 403 (an agent key, not a board key) -> exit 2, NOT 1
#   8. the board key never appears in the process table (env, never argv)
#
# Cases 6 and 7 are the ones that matter. 6 because the runner audits every
# company in one pass and a clean library must not mask a finding. 7 because a
# red scheduled run is routed to a human by ci-failure-router, and "we found a
# degraded skill" must never be indistinguishable from "we could not look".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../ops/run-company-skill-audit.sh"
AUDIT="$HERE/../ops/audit-company-skills.mjs"
[ -f "$RUNNER" ] || { echo "FATAL: $RUNNER missing" >&2; exit 1; }
[ -f "$AUDIT" ] || { echo "FATAL: $AUDIT missing" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'p=$(cat "$WORK/pid" 2>/dev/null || true); [ -n "$p" ] && kill "$p" 2>/dev/null; rm -rf "$WORK"' EXIT

failures=0
check() { # check <name> <cond-exit> [detail]
  if [ "$2" = 0 ]; then echo "  ok   $1"; else
    failures=$(( failures + 1 )); echo "  FAIL $1${3:+ — $3}" >&2
  fi
}

CLEAN_CID="11111111-1111-1111-1111-111111111111"
BAD_CID="22222222-2222-2222-2222-222222222222"
BOARD_KEY_VALUE="fake-board-key-abc123"

# --- stubbed docker: the runner presets PAPERCLIP_BASE, so `docker compose
# port` is never reached and only the `op read` container matters here.
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

# --- fake credential-broker env (the board-key source plugin-api-env.sh wants)
mkdir -p "$WORK/secrets"
echo 'OP_SERVICE_ACCOUNT_TOKEN="ops_faketoken"' > "$WORK/secrets/credential-broker.env"
export BROKER_ENV="$WORK/secrets/credential-broker.env"

# --- fake paperclip-server ----------------------------------------------------
# COMPANIES_STATUS lets a case make /api/companies 403 the way a non-board key
# really does ({"error":"Board access required"}).
cat >"$WORK/server.mjs" <<'SRV'
import { createServer } from "node:http";

const CLEAN = "11111111-1111-1111-1111-111111111111";
const BAD = "22222222-2222-2222-2222-222222222222";
const companiesStatus = Number(process.env.COMPANIES_STATUS || "200");

// A healthy local_path skill: every documented file is in the inventory.
const healthy = {
  id: "skill-healthy",
  key: "company/x/odoo-logistics",
  slug: "odoo-logistics",
  sourceType: "local_path",
  trustLevel: "scripts_executables",
  attachedAgentCount: 1,
  fileInventory: [{ path: "SKILL.md" }, { path: "scripts/odoo_rpc.py" }],
  markdown: "# Odoo logistics\n\nRun `scripts/odoo_rpc.py` to talk to Odoo.\n",
};

// The GOL-2963 install, reconstructed: a github source whose scripts/ was
// dropped by the trust gate, leaving SKILL.md pointing at a file on no disk.
const degraded = {
  id: "skill-degraded",
  key: "goldberry-playground/odoocker-goldberrygrove/odoo-logistics",
  slug: "odoo-logistics-gh",
  sourceType: "github",
  trustLevel: "markdown_only",
  attachedAgentCount: 0,
  fileInventory: [{ path: "SKILL.md" }],
  markdown: "# Odoo logistics\n\nRun `scripts/odoo_rpc.py` to talk to Odoo.\n",
};

const libraries = { [CLEAN]: [healthy], [BAD]: [degraded] };

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health") return send(res, 200, { ok: true });
  if (url.pathname === "/api/companies") {
    if (companiesStatus !== 200) return send(res, companiesStatus, { error: "Board access required" });
    return send(res, 200, { companies: [{ id: CLEAN }, { id: BAD }] });
  }
  const list = url.pathname.match(/^\/api\/companies\/([^/]+)\/skills$/);
  if (list) return send(res, 200, { skills: (libraries[list[1]] ?? []).map((s) => ({ id: s.id })) });
  const one = url.pathname.match(/^\/api\/companies\/([^/]+)\/skills\/([^/]+)$/);
  if (one) {
    const found = (libraries[one[1]] ?? []).find((s) => s.id === one[2]);
    return found ? send(res, 200, found) : send(res, 404, { error: "not found" });
  }
  return send(res, 404, { error: `unhandled ${url.pathname}` });
});

server.listen(0, "127.0.0.1", () => console.log(server.address().port));
SRV

start_server() { # start_server [companies-status] -> echoes port
  COMPANIES_STATUS="${1:-200}" node "$WORK/server.mjs" >"$WORK/port" 2>"$WORK/srv.err" &
  echo $! >"$WORK/pid"
  for _ in $(seq 1 100); do
    port="$(head -n1 "$WORK/port" 2>/dev/null || true)"
    [ -n "$port" ] && { echo "$port"; return 0; }
    sleep 0.1
  done
  echo "FATAL: fake server never printed a port: $(cat "$WORK/srv.err" 2>/dev/null)" >&2
  return 1
}
stop_server() {
  p="$(cat "$WORK/pid" 2>/dev/null || true)"
  [ -n "$p" ] && kill "$p" 2>/dev/null || true
  : >"$WORK/port"
}

run_runner() { # run_runner <port> [args…] -> writes $WORK/out, echoes exit code
  set +e
  env -u PAPERCLIP_COMPANY_IDS \
    PAPERCLIP_BASE="http://127.0.0.1:$1" \
    BROKER_ENV="$BROKER_ENV" \
    "${EXTRA_ENV[@]}" \
    bash "$RUNNER" "${@:2}" >"$WORK/out" 2>&1
  code=$?
  set -e
  echo "$code"
}

EXTRA_ENV=()

echo "run-company-skill-audit.sh"

# 1 + 6: no args -> enumerate both libraries; the clean one must not mask the
# degraded one.
port="$(start_server)"
code="$(run_runner "$port")"
check "enumerates /api/companies with no args" \
  "$( [ "$code" = 1 ] && echo 0 || echo 1 )" "exit=$code, want 1 (one library degraded)"
check "audits the clean library" \
  "$(grep -q "company ${CLEAN_CID}" "$WORK/out" && echo 0 || echo 1)" "$(head -c 300 "$WORK/out")"
check "audits the degraded library" \
  "$(grep -q "company ${BAD_CID}" "$WORK/out" && echo 0 || echo 1)" "$(head -c 300 "$WORK/out")"
check "worst outcome wins (clean + degraded -> 1)" \
  "$(grep -q "degraded install(s) found" "$WORK/out" && echo 0 || echo 1)" "$(head -c 300 "$WORK/out")"

# 5: the report names the dropped path, so the reader is not left guessing.
check "names the dropped script path" \
  "$(grep -q "scripts/odoo_rpc.py" "$WORK/out" && echo 0 || echo 1)" "$(head -c 400 "$WORK/out")"
check "flags scripts_executables_blocked on the github install" \
  "$(grep -q "scripts_executables_blocked" "$WORK/out" && echo 0 || echo 1)" "$(head -c 400 "$WORK/out")"

# 4: a clean library on its own is a clean exit.
code="$(run_runner "$port" "$CLEAN_CID")"
check "explicit clean company id -> exit 0" \
  "$( [ "$code" = 0 ] && echo 0 || echo 1 )" "exit=$code, want 0"
check "explicit ids skip enumeration" \
  "$(grep -q "all 1 skill librar" "$WORK/out" && echo 0 || echo 1)" "$(head -c 300 "$WORK/out")"

# 2: explicit degraded id only.
code="$(run_runner "$port" "$BAD_CID")"
check "explicit degraded company id -> exit 1" \
  "$( [ "$code" = 1 ] && echo 0 || echo 1 )" "exit=$code, want 1"

# 3: same, from the environment.
EXTRA_ENV=("PAPERCLIP_COMPANY_IDS=$BAD_CID")
code="$(run_runner "$port")"
EXTRA_ENV=()
check "PAPERCLIP_COMPANY_IDS is honoured" \
  "$( [ "$code" = 1 ] && echo 0 || echo 1 )" "exit=$code, want 1"

# 8: the board key must reach node through the environment, never argv.
check "board key never on a command line" \
  "$(grep -q -- "$BOARD_KEY_VALUE" "$WORK/out" && echo 1 || echo 0)" \
  "the fake board key was echoed into the runner output"
check "runner does not shell out to curl with the key" \
  "$(grep -qE 'curl[^|]*Bearer' "$RUNNER" && echo 1 || echo 0)" \
  "found a curl invocation carrying the bearer token on argv"

stop_server

# 7: an agent key (not a board key) 403s the enumeration -> 2, never 1.
port="$(start_server 403)"
code="$(run_runner "$port")"
check "403 on /api/companies -> exit 2 (could not look), not 1" \
  "$( [ "$code" = 2 ] && echo 0 || echo 1 )" "exit=$code, want 2"
check "403 message names the board-only route" \
  "$(grep -q "board-only route" "$WORK/out" && echo 0 || echo 1)" "$(head -c 400 "$WORK/out")"
stop_server

# A missing audit module is a 2, not a silent pass.
port="$(start_server)"
code="$(REPO_DIR="$WORK/nope" run_runner "$port" "$CLEAN_CID")"
check "missing audit module -> exit 2" \
  "$( [ "$code" = 2 ] && echo 0 || echo 1 )" "exit=$code, want 2"
stop_server

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "all checks passed"
