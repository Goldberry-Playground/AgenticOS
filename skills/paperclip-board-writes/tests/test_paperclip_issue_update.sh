#!/usr/bin/env bash
# Regression tests for skills/paperclip-board-writes/scripts/paperclip-issue-update.sh
#
# Zero-install: bash + curl + jq + python3 (stdlib http.server as a fake
# control plane). No network, no Paperclip credentials — everything runs
# against 127.0.0.1.
#
# Guards, in order of how badly each one bit us:
#
#   1. GOL-3058 — `resp="$(pc_curl …)"` ran the transport helper in a SUBSHELL,
#      so the PC_CODE it assigned never reached the parent and `set -u` aborted
#      with `PC_CODE: unbound variable` before any write happened. --dry-run
#      never calls pc_curl, so the bug shipped past a clean dry-run. Test 2
#      exercises the real write path and would have caught it.
#   2. The whole point of the helper: a multiline markdown body must arrive at
#      the API byte-identical — literal newlines, backticks, `$VARS`, quotes
#      and emoji all intact. Test 2 asserts the server-side bytes.
#   3. The no-blind-retry contract (§3 of SKILL.md): an unknown write result
#      must exit 75, not retry; and --marker must refuse to double-post.
#
# Run: bash skills/paperclip-board-writes/tests/test_paperclip_issue_update.sh

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/../scripts/paperclip-issue-update.sh"
[[ -r "$script" ]] || { echo "cannot find $script" >&2; exit 1; }

for c in curl jq python3; do
  command -v "$c" >/dev/null 2>&1 || { echo "SKIP: missing $c" >&2; exit 0; }
done

work="$(mktemp -d /tmp/pc-helper-test.XXXXXX)"
trap 'kill "${server_pid:-}" 2>/dev/null; rm -rf "$work"' EXIT

pass=0 fail=0
ok()   { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf 'FAIL %s\n' "$1"; [[ $# -gt 1 ]] && printf '     %s\n' "$2"; }

# ---- fake control plane ------------------------------------------------------
# POST  /api/issues/<id>/comments -> records the body, replies with $POST_CODE
# GET   /api/issues/<id>/comments -> replies with the contents of comments.json
cat > "$work/server.py" <<'PY'
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

WORK = os.environ["PC_TEST_WORK"]

class H(BaseHTTPRequestHandler):
    def _code(self):
        try:
            return int(open(os.path.join(WORK, "post_code")).read().strip())
        except Exception:
            return 201

    def do_GET(self):
        try:
            payload = open(os.path.join(WORK, "comments.json")).read()
        except Exception:
            payload = "[]"
        body = payload.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        with open(os.path.join(WORK, "last_request.json"), "wb") as fh:
            fh.write(raw)
        with open(os.path.join(WORK, "request_count"), "a") as fh:
            fh.write("1\n")
        with open(os.path.join(WORK, "last_headers.txt"), "w") as fh:
            for k, v in self.headers.items():
                fh.write("%s: %s\n" % (k, v))
        code = self._code()
        body = json.dumps({"id": "fake-comment-id", "status": "done"}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_POST = _write
    do_PATCH = _write

    def log_message(self, *a):
        pass

srv = HTTPServer(("127.0.0.1", 0), H)
print(srv.server_address[1], flush=True)
srv.serve_forever()
PY

export PC_TEST_WORK="$work"
python3 "$work/server.py" > "$work/port" 2>"$work/server.err" &
server_pid=$!
for _ in $(seq 1 50); do
  port="$(cat "$work/port" 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$port" ]] && break
  sleep 0.1
done
[[ -n "${port:-}" ]] || { echo "fake server never reported a port: $(cat "$work/server.err")" >&2; exit 1; }
base="http://127.0.0.1:$port"

export PAPERCLIP_API_KEY="test-key-not-a-secret"
export PAPERCLIP_RUN_ID="test-run"
unset PAPERCLIP_TASK_ID 2>/dev/null || true

# The body every test posts: newlines, backticks, a literal $VAR, quotes, emoji.
cat > "$work/body.md" <<'MD'
## Heading

- backticked token: `scripts/paperclip-issue-update.sh`
- literal var: $PAPERCLIP_API_KEY
- "quotes" and emoji ✅

Second paragraph after a real blank line.
MD

# -j, not -r: jq -r appends a newline, which would fake a byte-level mismatch
# against a body file that already ends in one.
sent_body() { jq -j 'if has("comment") then .comment else .body end' "$work/last_request.json"; }
req_count() { if [[ -r "$work/request_count" ]]; then wc -l < "$work/request_count" | tr -d ' '; else echo 0; fi; }
reset_server_state() { rm -f "$work/last_request.json" "$work/request_count" "$work/comments.json"; echo 201 > "$work/post_code"; }

# ---- 1. --dry-run sends nothing and shows the body as it will be stored ------
reset_server_state
out="$(bash "$script" --issue-id GOL-TEST --api-url "$base" --dry-run --body-file "$work/body.md" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | grep -qF 'POST http://127.0.0.1' \
   && printf '%s' "$out" | grep -qF '`scripts/paperclip-issue-update.sh`' \
   && [[ "$(req_count)" == "0" ]]; then
  ok "--dry-run prints the resolved request and posts nothing"
else
  bad "--dry-run prints the resolved request and posts nothing" "rc=$rc requests=$(req_count)"
fi

# ---- 2. real write path: no subshell PC_CODE loss, body byte-identical ------
# GOL-3058 regression: this aborted with `PC_CODE: unbound variable` under set -u.
reset_server_state
out="$(bash "$script" --issue-id GOL-TEST --api-url "$base" --body-file "$work/body.md" 2>&1)"; rc=$?
if [[ $rc -ne 0 ]]; then
  bad "real write path exits 0" "rc=$rc out=$out"
elif printf '%s' "$out" | grep -qF 'unbound variable'; then
  bad "real write path exits 0" "PC_CODE subshell regression is back: $out"
else
  ok "real write path exits 0 and reports the status line"
fi
if [[ -r "$work/last_request.json" ]] && diff -q <(sent_body) "$work/body.md" >/dev/null; then
  ok "stored body is byte-identical to the heredoc file (newlines/backticks/\$VARS/emoji intact)"
else
  bad "stored body is byte-identical to the heredoc file" "$(sent_body 2>/dev/null | head -3)"
fi
if grep -qi '^x-paperclip-run-id: test-run' "$work/last_headers.txt"; then
  ok "sends X-Paperclip-Run-Id"
else
  bad "sends X-Paperclip-Run-Id" "$(cat "$work/last_headers.txt")"
fi

# ---- 3. field updates switch route+key: PATCH /issues with `comment` ---------
reset_server_state
bash "$script" --issue-id GOL-TEST --api-url "$base" --status done --body-file "$work/body.md" >/dev/null 2>&1
if jq -e 'has("comment") and .status == "done" and (has("body") | not)' "$work/last_request.json" >/dev/null 2>&1; then
  ok "--status routes to PATCH and uses the \`comment\` key, not \`body\`"
else
  bad "--status routes to PATCH and uses the \`comment\` key" "$(cat "$work/last_request.json")"
fi

# ---- 4. --marker duplicate guard: present marker => post nothing, exit 0 -----
reset_server_state
printf '[{"body":"earlier comment\\n<!-- marker:dup-guard-probe -->"}]' > "$work/comments.json"
out="$(bash "$script" --issue-id GOL-TEST --api-url "$base" --marker dup-guard-probe --body-file "$work/body.md" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]] && [[ "$(req_count)" == "0" ]]; then
  ok "--marker refuses to double-post when the marker is already on the issue"
else
  bad "--marker refuses to double-post" "rc=$rc requests=$(req_count) out=$out"
fi

# ---- 5. --marker appends the marker when it is absent ------------------------
reset_server_state
bash "$script" --issue-id GOL-TEST --api-url "$base" --marker fresh-marker --body-file "$work/body.md" >/dev/null 2>&1
if sent_body 2>/dev/null | grep -qF '<!-- marker:fresh-marker -->'; then
  ok "--marker appends the idempotency marker to the body"
else
  bad "--marker appends the idempotency marker" "$(sent_body 2>/dev/null | tail -3)"
fi

# ---- 6. unknown write result exits 75 and never retries ---------------------
reset_server_state
echo 500 > "$work/post_code"
out="$(bash "$script" --issue-id GOL-TEST --api-url "$base" --body-file "$work/body.md" 2>&1)"; rc=$?
if [[ $rc -eq 75 ]] && [[ "$(req_count)" == "1" ]] && printf '%s' "$out" | grep -qF 'DO NOT RETRY BLINDLY'; then
  ok "unknown write result exits 75 after exactly one attempt"
else
  bad "unknown write result exits 75 after exactly one attempt" "rc=$rc requests=$(req_count)"
fi

# ---- 7. --resume adds structured resume:true -------------------------------
reset_server_state
bash "$script" --issue-id GOL-TEST --api-url "$base" --resume --body-file "$work/body.md" >/dev/null 2>&1
if jq -e '.resume == true' "$work/last_request.json" >/dev/null 2>&1; then
  ok "--resume sends structured resume:true"
else
  bad "--resume sends structured resume:true" "$(cat "$work/last_request.json")"
fi

# ---- 8. refuses to run with no issue id ------------------------------------
reset_server_state
out="$(PAPERCLIP_TASK_ID='' bash "$script" --api-url "$base" --body-file "$work/body.md" 2>&1)"; rc=$?
if [[ $rc -ne 0 ]] && printf '%s' "$out" | grep -qF 'no issue id'; then
  ok "refuses to run without an issue id"
else
  bad "refuses to run without an issue id" "rc=$rc out=$out"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
