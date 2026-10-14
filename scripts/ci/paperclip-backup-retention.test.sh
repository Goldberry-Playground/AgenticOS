#!/usr/bin/env bash
# Offline harness for infra/scripts/paperclip-backup-retention.py (GOL-3321).
#
# The on-box cap deletes restore points. The only thing that makes that safe
# is the off-box check it runs first, so this proves the check fails CLOSED:
#
#   1. off-box verified -> prunes everything past the newest N, and ONLY
#      dumps whose size-matching object it listed this run. A dump past the
#      daily lifecycle with no copy is kept (single-copy), never deleted.
#   2. off-box stale (beacon old / failed / missing / bucket unreachable / a
#      dump the shipper should have shipped is absent) -> prunes NOTHING,
#      exits 1, posts to Discord once, and not again while the state holds;
#      recovery posts one all-clear.
#   3. the newest N are never touched, and nothing younger than MIN_AGE_HOURS.
#   4. the bucket is never written: every method is journaled by the fake.
#   5. the nightly wrapper runs this janitor even when the container is down,
#      dry-run then --apply, and honours DRY_RUN=1.
#
# No DigitalOcean, docker, credentials or network: a stdlib fake Spaces (same
# single-on-disk-store shape as paperclip-backup-offsite.test.sh) also plays
# the Discord webhook so the alert-on-change contract is observable.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${REPO_ROOT}/infra/scripts/paperclip-backup-retention.py"
WRAPPER="${REPO_ROOT}/infra/scripts/worktree-reaper.sh"
WORK="$(mktemp -d)"
PASS=0; FAIL=0

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "${SERVER_PID}" 2>/dev/null; rm -rf "${WORK:?}"; }
trap cleanup EXIT

ok()  { PASS=$((PASS + 1)); echo "  ok   — $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL — $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }
contains() { case "$2" in *"$3"*) ok "$1" ;; *) bad "$1 (missing '$3')" ;; esac; }
not_contains() { case "$2" in *"$3"*) bad "$1 (unexpectedly found '$3')" ;; *) ok "$1" ;; esac; }
exists() { if [ -e "$2" ]; then ok "$1"; else bad "$1 (missing $2)"; fi; }
gone()   { if [ -e "$2" ]; then bad "$1 ($2 still exists)"; else ok "$1"; fi; }

# --- fake Spaces + Discord ------------------------------------------------------
cat >"${WORK}/fake_spaces.py" <<'PY'
import os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs, unquote
import xml.sax.saxutils as sx

ROOT, JOURNAL, DISCORD = sys.argv[1], sys.argv[2], sys.argv[3]
def _path(key): return os.path.join(ROOT, key.replace("/", "__"))
def _keys(): return sorted(n.replace("__", "/") for n in os.listdir(ROOT))
def _read(key):
    try:
        with open(_path(key), "rb") as fh: return fh.read()
    except FileNotFoundError: return None

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _j(self):
        with open(JOURNAL, "a") as fh: fh.write(f"{self.command} {self.path}\n")
    def _body(self):
        n = int(self.headers.get("Content-Length", "0")); return self.rfile.read(n) if n else b""
    def do_POST(self):  # the Discord webhook stand-in
        self._j(); body = self._body()
        with open(DISCORD, "ab") as fh: fh.write(body + b"\n")
        self.send_response(204); self.end_headers()
    def do_PUT(self):
        self._j(); self._body(); self.send_response(200); self.end_headers()
    def do_DELETE(self):
        self._j(); self.send_response(204); self.end_headers()
    def do_HEAD(self):
        self._j(); b = _read(unquote(urlsplit(self.path).path.lstrip("/")))
        self.send_response(404 if b is None else 200)
        if b is not None: self.send_header("Content-Length", str(len(b)))
        self.end_headers()
    def do_GET(self):
        self._j(); parts = urlsplit(self.path); qs = parse_qs(parts.query)
        if qs.get("list-type") == ["2"]:
            prefix = qs.get("prefix", [""])[0]
            body = ('<?xml version="1.0" encoding="UTF-8"?>'
                    '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                    '<IsTruncated>false</IsTruncated>'
                    + "".join(f"<Contents><Key>{sx.escape(k)}</Key><Size>{len(_read(k) or b'')}</Size></Contents>"
                              for k in _keys() if k.startswith(prefix))
                    + "</ListBucketResult>").encode()
        else:
            body = _read(unquote(parts.path.lstrip("/")))
            if body is None:
                self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)

srv = HTTPServer(("127.0.0.1", 0), H)
print(srv.server_port, flush=True)
srv.serve_forever()
PY

BUCKET="${WORK}/bucket"; JOURNAL="${WORK}/journal.txt"; DISCORD="${WORK}/discord.txt"
mkdir -p "${BUCKET}"; : >"${JOURNAL}"; : >"${DISCORD}"
python3 "${WORK}/fake_spaces.py" "${BUCKET}" "${JOURNAL}" "${DISCORD}" >"${WORK}/port.txt" &
SERVER_PID=$!
for _ in $(seq 1 50); do PORT="$(cat "${WORK}/port.txt" 2>/dev/null)"; [ -n "${PORT}" ] && break; sleep 0.1; done
[ -n "${PORT}" ] || { echo "fake Spaces did not start"; exit 1; }

# --- fixture ----------------------------------------------------------------------
VOL="${WORK}/vol"; DIR="${VOL}/instances/default/data/backups"
export PAPERCLIP_DATA_DIR="${VOL}" ENV_FILE=/dev/null STAMP_DIR="${WORK}/stamps"
export SPACES_BACKUP_ENDPOINT="http://127.0.0.1:${PORT}" SPACES_BACKUP_BUCKET=test-bucket
export SPACES_BACKUP_ACCESS_KEY_ID=AKIDEXAMPLE SPACES_BACKUP_SECRET_KEY=wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY
export DISCORD_OPS_WEBHOOK_URL="http://127.0.0.1:${PORT}/discord"
export STATE_FILE="${WORK}/state/state" KEEP_NEWEST=3 MIN_AGE_HOURS=2 DAILY_EXPIRE_DAYS=7

obj() { cp "$1" "${BUCKET}/$(printf '%s' "$2" | sed 's#/#__#g')"; }  # $1 local file -> $2 key
beacon() { # $1 = minutes ago; $2 = state
  python3 - "$1" "$2" "${BUCKET}/paperclip___status__last-run.json" <<'B'
import datetime as dt, json, sys
t = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) - dt.timedelta(minutes=int(sys.argv[1]))
open(sys.argv[3], "w").write(json.dumps({"run_completed_at": t.isoformat(), "state": sys.argv[2], "uploaded": 0}))
B
}
# name age_hours -> a dump with random content (sizes differ per file)
mkdump() { head -c $((2048 + RANDOM % 2048)) /dev/urandom >"${DIR}/$1"; touch -d "$2 hours ago" "${DIR}/$1"; }
# The filename stamp is the clock the script orders by; ages are the mtimes.
N1=paperclip-20261013-200000.sql.gz;  N2=paperclip-20261013-160000.sql.gz; N3=paperclip-20261013-120000.sql.gz
O1=paperclip-20261012-120000.sql.gz;  O2=paperclip-20261011-120000.sql.gz
W1=paperclip-20261003-120000.sql.gz;  S1=paperclip-20261001-120000.sql.gz
reset_fixture() {
  rm -rf "${VOL:?}" "${BUCKET:?}"/* "${WORK:?}/state"; mkdir -p "${DIR}"; : >"${JOURNAL}"; : >"${DISCORD}"
  mkdump "$N1" 0;  mkdump "$N2" 1;  mkdump "$N3" 5      # newest 3 (N3 is past MIN_AGE but inside N)
  mkdump "$O1" 30; mkdump "$O2" 50                       # inside the daily window: must be off-box
  mkdump "$W1" 240                                       # 10d: only a weekly representative
  mkdump "$S1" 288                                       # 12d: NO off-box copy (single-copy)
  printf 'partial' >"${DIR}/paperclip-20261013-210000.sql"; printf 'x' >"${DIR}/notes.txt"
  obj "${DIR}/$N1" "paperclip/daily/$N1"; obj "${DIR}/$N2" "paperclip/daily/$N2"; obj "${DIR}/$N3" "paperclip/daily/$N3"
  obj "${DIR}/$O1" "paperclip/daily/$O1"; obj "${DIR}/$O2" "paperclip/daily/$O2"
  obj "${DIR}/$W1" "paperclip/weekly/2026W40/$W1"
  obj "${DIR}/$O1" "paperclip/monthly/2026-10/$O1"
  beacon 10 ok
}
run() { OUT="$(python3 "${SCRIPT}" "$@" 2>&1)"; RC=$?; }
posts() { grep -c '^POST ' "${JOURNAL}"; }
writes() { grep -cE '^(PUT|DELETE) ' "${JOURNAL}"; }

echo "== 1. off-box verified: dry-run decides, deletes nothing =="
reset_fixture
run --dry-run
check "dry-run exits 0" "${RC}" 0
contains "beacon read ok" "${OUT}" "beacon ok, last run 10m ago"
contains "O1 would go (daily copy)"   "${OUT}" "WOULD DELETE $O1"
contains "O2 would go (daily copy)"   "${OUT}" "WOULD DELETE $O2"
contains "W1 would go (weekly copy)"  "${OUT}" "WOULD DELETE $W1"
contains "W1 verified via weekly key" "${OUT}" "paperclip/weekly/2026W40/$W1"
contains "S1 single-copy is kept"     "${OUT}" "KEEP   $S1"
contains "S1 reason says single-copy" "${OUT}" "single-copy"
contains "N3 kept as newest N despite age" "${OUT}" "KEEP   $N3"
contains "totals" "${OUT}" "would delete 3 dump(s)"
for f in "$N1" "$N2" "$N3" "$O1" "$O2" "$W1" "$S1"; do exists "dry-run kept $f" "${DIR}/$f"; done
[ -e "${STATE_FILE}" ] && bad "dry-run wrote state" || ok "dry-run wrote no state"
check "dry-run posted nothing" "$(posts)" 0
check "dry-run wrote nothing to the bucket" "$(writes)" 0

echo "== 2. off-box verified: --apply prunes past N, verified only =="
run --apply
check "apply exits 0" "${RC}" 0
contains "apply reports 3" "${OUT}" "delete 3 dump(s)"
for f in "$O1" "$O2" "$W1"; do gone "apply removed $f" "${DIR}/$f"; done
for f in "$N1" "$N2" "$N3" "$S1"; do exists "apply kept $f" "${DIR}/$f"; done
exists "apply ignores the .sql partial" "${DIR}/paperclip-20261013-210000.sql"
exists "apply ignores non-dump files"   "${DIR}/notes.txt"
check "state recorded ok" "$(cat "${STATE_FILE}")" ok
check "first healthy run posts nothing" "$(posts)" 0
check "bucket never written (no PUT/DELETE)" "$(writes)" 0
for k in "paperclip/daily/$O1" "paperclip/weekly/2026W40/$W1"; do
  [ -e "${BUCKET}/$(printf '%s' "$k" | sed 's#/#__#g')" ] && ok "off-box $k untouched" || bad "off-box $k vanished"
done
run --apply
check "second apply is a no-op" "${RC}" 0
contains "second apply deletes 0" "${OUT}" "delete 0 dump(s)"
contains "unchanged state not re-posted" "${OUT}" "state unchanged (ok)"

echo "== 3. newest N never touched even when they are the only candidates =="
reset_fixture; KEEP_NEWEST=50 run --apply
check "exit 0" "${RC}" 0
contains "deletes 0" "${OUT}" "delete 0 dump(s)"
for f in "$N1" "$N2" "$N3" "$O1" "$O2" "$W1" "$S1"; do exists "kept $f" "${DIR}/$f"; done
reset_fixture; KEEP_NEWEST=1 MIN_AGE_HOURS=24 run --apply
contains "N2 kept: younger than MIN_AGE_HOURS" "${OUT}" "KEEP   $N2"
contains "N3 kept: younger than MIN_AGE_HOURS" "${OUT}" "KEEP   $N3"
exists "N2 survives" "${DIR}/$N2"; exists "N3 survives" "${DIR}/$N3"
gone "O1 pruned under KEEP_NEWEST=1" "${DIR}/$O1"

echo "== 4. stale beacon: prunes nothing, alerts once, all-clear on recovery =="
reset_fixture; beacon 200 ok
run --apply
check "exit 1" "${RC}" 1
contains "names the reason" "${OUT}" "OFF-BOX CHECK FAILED (beacon-stale)"
contains "deletes nothing" "${OUT}" "delete 0 dump(s)"
for f in "$O1" "$O2" "$W1" "$S1"; do exists "stale: kept $f" "${DIR}/$f"; done
check "one Discord post" "$(posts)" 1
contains "post says what and why" "$(cat "${DISCORD}")" "beacon-stale"
contains "post names the ticket" "$(cat "${DISCORD}")" "GOL-3321"
check "state records the block" "$(cat "${STATE_FILE}")" "blocked:beacon-stale"
run --apply
check "still blocked" "${RC}" 1
check "no second post while the state holds" "$(posts)" 1
exists "still nothing deleted" "${DIR}/$O1"
beacon 5 ok; run --apply
check "recovery exits 0" "${RC}" 0
check "all-clear posted exactly once" "$(posts)" 2
contains "all-clear text" "$(cat "${DISCORD}")" "running again"
gone "recovery prunes O1" "${DIR}/$O1"
check "state back to ok" "$(cat "${STATE_FILE}")" ok
check "bucket never written" "$(writes)" 0

echo "== 5. other off-box failures fail closed =="
reset_fixture; beacon 5 error; run --apply
check "beacon state=error exits 1" "${RC}" 1; contains "reason" "${OUT}" "beacon-failed"; exists "kept O1" "${DIR}/$O1"
reset_fixture; rm -f "${BUCKET:?}/paperclip___status__last-run.json"; run --apply
check "beacon missing exits 1" "${RC}" 1; contains "reason" "${OUT}" "beacon-missing"; exists "kept O1" "${DIR}/$O1"
reset_fixture; rm -f "${BUCKET:?}/paperclip__daily__$O2"; run --apply
check "in-window dump absent off-box exits 1" "${RC}" 1
contains "reason names the dump" "${OUT}" "missing-offbox"; contains "…by name" "${OUT}" "$O2"
exists "verified O1 is NOT pruned on a blocked night" "${DIR}/$O1"
contains "Discord names the dump" "$(cat "${DISCORD}")" "$O2"
reset_fixture; printf 'short' >"${BUCKET}/paperclip__daily__$O2"; run --apply   # O2 lives in daily only; O1 also has an exact monthly copy
check "size mismatch counts as missing" "${RC}" 1; contains "reason" "${OUT}" "missing-offbox"; exists "kept O2" "${DIR}/$O2"; exists "kept O1" "${DIR}/$O1"
reset_fixture; SPACES_BACKUP_ENDPOINT="http://127.0.0.1:1" run --apply
check "unreachable bucket exits 1" "${RC}" 1; contains "reason" "${OUT}" "offbox-unreachable"; exists "kept O1" "${DIR}/$O1"
check "unreachable posts once" "$(posts)" 1
reset_fixture; SPACES_BACKUP_SECRET_KEY= run --apply
check "missing credentials exit 2" "${RC}" 2; exists "kept O1" "${DIR}/$O1"
reset_fixture; SPACES_BACKUP_SECRET_KEY='op://Vault/Item/field' run --apply
check "op:// reference exits 2" "${RC}" 2; exists "kept O1" "${DIR}/$O1"
reset_fixture; PAPERCLIP_DATA_DIR="${WORK}/nowhere" run --apply
check "missing volume is a no-op, exit 0" "${RC}" 0
reset_fixture; rm -f "${DIR:?}"/*.sql.gz; run --apply
check "no dumps is a no-op, exit 0" "${RC}" 0; contains "says so" "${OUT}" "no completed dumps"

echo "== 6. nightly wrapper runs the host janitor, container up or down =="
FAKE="${WORK}/fakerepo"; mkdir -p "${FAKE}/infra/scripts" "${WORK}/bin"
cat >"${FAKE}/infra/scripts/paperclip-backup-retention.py" <<'PY'
import os, sys; print("stub-retention", sys.argv[1:], "KEEP_NEWEST=" + os.environ.get("KEEP_NEWEST", "?"))
PY
printf '#!/usr/bin/env bash\necho false\n' >"${WORK}/bin/docker"; chmod +x "${WORK}/bin/docker"
WOUT="$(PATH="${WORK}/bin:${PATH}" REPO="${FAKE}" bash "${WRAPPER}" 2>&1)"; WRC=$?
check "wrapper exits 0 with the container down" "${WRC}" 0
contains "in-container janitors skipped" "${WOUT}" "skipping the in-container janitors"
contains "stale reaper skipped by name" "${WOUT}" "SKIP stale .wt-* worktrees"
contains "host janitor dry-run ran" "${WOUT}" "stub-retention ['--dry-run'] KEEP_NEWEST=6"
contains "host janitor apply ran"   "${WOUT}" "stub-retention ['--apply'] KEEP_NEWEST=6"
WOUT="$(PATH="${WORK}/bin:${PATH}" REPO="${FAKE}" DRY_RUN=1 BACKUP_KEEP_NEWEST=9 bash "${WRAPPER}" 2>&1)"
contains "DRY_RUN=1 runs the dry-run" "${WOUT}" "stub-retention ['--dry-run'] KEEP_NEWEST=9"
not_contains "DRY_RUN=1 skips the apply" "${WOUT}" "stub-retention ['--apply']"
printf 'import sys; print("boom"); sys.exit(1)\n' >"${FAKE}/infra/scripts/paperclip-backup-retention.py"
WOUT="$(PATH="${WORK}/bin:${PATH}" REPO="${FAKE}" bash "${WRAPPER}" 2>&1)"; WRC=$?
check "a failing janitor never reddens the wrapper" "${WRC}" 0
contains "failed dry-run skips its apply" "${WOUT}" "dry-run exited non-zero — skipping its apply pass"
contains "wrapper still finishes" "${WOUT}" "done."

echo
echo "passed=${PASS} failed=${FAIL}"
[ "${FAIL}" -eq 0 ]
