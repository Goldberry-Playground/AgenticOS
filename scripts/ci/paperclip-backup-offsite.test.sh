#!/usr/bin/env bash
# Offline harness for infra/scripts/paperclip-backup-offsite.py (GOL-2769).
#
# The off-box backup shipper is the only thing standing between a droplet loss
# and losing every Paperclip restore point, and it runs unattended every 30
# minutes against a bucket nobody looks at. So it needs a test that does not
# require DigitalOcean, credentials, docker, or a network — this one.
#
# It proves three separable things:
#
#   1. THE SIGNATURE IS RIGHT. Four official AWS SigV4 test-suite vectors for
#      S3 (GET Object with a Range header, GET ?lifecycle, GET with query
#      params, PUT Object with extra signed headers). If the signer drifts, the
#      real bucket starts 403-ing and backups stop silently — catch it here.
#
#   2. THE INTEGRITY GATE IS RIGHT. A corrupt dump, a dump that never reached
#      pg_dump's final COMMIT;, and a bare *.sql partial must all be refused.
#      Shipping a truncated dump off-box is worse than shipping nothing: it
#      looks like a restore point and is not one.
#
#   3. THE TIERING AND IDEMPOTENCY ARE RIGHT. Tier membership comes from the
#      FILENAME stamp (not mtime — see GOL-1632), each week/month is populated
#      once, a second run uploads nothing, and the shipper never issues DELETE.
#
# A minimal in-process fake Spaces endpoint (stdlib http.server) stands in for
# the bucket: it speaks PUT / HEAD / GET / ListObjectsV2 and records every
# method it is asked for, which is how the "never deletes" assertion is made.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHIPPER="${REPO_ROOT}/infra/scripts/paperclip-backup-offsite.py"
WORK="$(mktemp -d)"
PASS=0
FAIL=0

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "${SERVER_PID}" 2>/dev/null
  rm -rf "${WORK}"
}
trap cleanup EXIT

ok()   { PASS=$((PASS + 1)); echo "  ok   — $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL — $1"; }
check() { # $1 = description; $2 = actual; $3 = expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi
}
contains() { # $1 = desc; $2 = haystack; $3 = needle
  case "$2" in *"$3"*) ok "$1" ;; *) bad "$1 (missing '$3')" ;; esac
}
not_contains() { # $1 = desc; $2 = haystack; $3 = needle
  case "$2" in *"$3"*) bad "$1 (unexpectedly found '$3')" ;; *) ok "$1" ;; esac
}

echo "== paperclip-backup-offsite: SigV4 conformance =="

python3 - "$SHIPPER" <<'PY'
import datetime as dt, hashlib, importlib.util, sys
spec = importlib.util.spec_from_file_location("shipper", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

AK = "AKIAIOSFODNN7EXAMPLE"
SK = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
WHEN = dt.datetime(2013, 5, 24, tzinfo=dt.timezone.utc)
EMPTY = hashlib.sha256(b"").hexdigest()

# The four published AWS "Signature Version 4 test suite" cases for S3.
cases = [
    ("GET Object (Range header)", "GET",
     "https://examplebucket.s3.amazonaws.com/test.txt", EMPTY,
     {"range": "bytes=0-9"},
     "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"),
    ("GET ?lifecycle", "GET",
     "https://examplebucket.s3.amazonaws.com/?lifecycle", EMPTY, None,
     "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543"),
    ("GET ?max-keys&prefix", "GET",
     "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", EMPTY, None,
     "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"),
    ("PUT Object", "PUT",
     "https://examplebucket.s3.amazonaws.com/test%24file.text",
     hashlib.sha256(b"Welcome to Amazon S3.").hexdigest(),
     {"date": "Fri, 24 May 2013 00:00:00 GMT",
      "x-amz-storage-class": "REDUCED_REDUNDANCY"},
     "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"),
]
rc = 0
for name, method, url, sha, extra, expected in cases:
    h = m.sigv4_headers(method, url, "us-east-1", AK, SK, sha, extra, now=WHEN)
    got = h["Authorization"].split("Signature=")[1]
    if got == expected:
        print(f"  ok   — AWS SigV4 vector: {name}")
    else:
        print(f"  FAIL — AWS SigV4 vector: {name} (got {got})")
        rc = 1

# Tier keys must come from the FILENAME stamp, never mtime (GOL-1632: the
# filename is local time, mtime reads back as UTC, and bucketing on mtime folds
# an evening dump into the next day / wrong week).
keys = m.tier_keys("paperclip-20260930-073020.sql.gz")
expect = {
    "daily":   "paperclip/daily/paperclip-20260930-073020.sql.gz",
    "weekly":  "paperclip/weekly/2026W40/paperclip-20260930-073020.sql.gz",
    "monthly": "paperclip/monthly/2026-09/paperclip-20260930-073020.sql.gz",
}
for tier, want in expect.items():
    if keys[tier] == want:
        print(f"  ok   — tier key ({tier}) derived from filename stamp")
    else:
        print(f"  FAIL — tier key ({tier}): got {keys[tier]}, want {want}")
        rc = 1

# A Sunday belongs to the ISO week that STARTED the previous Monday. Getting
# this wrong would silently create two "weekly" objects for one week.
sunday = m.tier_keys("paperclip-20260104-010000.sql.gz")["weekly"]
if "/2026W01/" in sunday:
    print("  ok   — ISO week boundary (Sunday 2026-01-04 -> 2026W01)")
else:
    print(f"  FAIL — ISO week boundary: {sunday}")
    rc = 1
# The dump-completion gate. A finished dump's last STATEMENT is COMMIT;, which
# is not necessarily the last LINE (Paperclip appends a breakpoint comment after
# every statement). Both real shapes must pass and every truncation must fail.
BP = b"-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900\n"
tails = [
    ("real Paperclip tail (COMMIT; then breakpoint comment)",
     b"SELECT setval(1);\n" + BP + b"\nCOMMIT;\n" + BP, True),
    ("plain pg_dump tail (COMMIT; is the last line)",
     b"SELECT setval(1);\n\nCOMMIT;\n", True),
    ("truncated mid-COPY", b"COPY x FROM stdin;\n1\tfoo\n2\tbar\n", False),
    ("truncated mid-COPY with a trailing breakpoint",
     b"COPY x FROM stdin;\n1\tfoo\n" + BP, False),
    ("nothing but whitespace", b"\n\n", False),
    ("nothing but comments", BP, False),
]
for name, tail, want_ok in tails:
    got_ok, why = m._check_tail(tail)
    if got_ok == want_ok:
        print(f"  ok   — completion gate: {name}")
    else:
        print(f"  FAIL — completion gate: {name} -> {got_ok} ({why})")
        rc = 1

sys.exit(rc)
PY
if [ $? -eq 0 ]; then PASS=$((PASS + 14)); else FAIL=$((FAIL + 1)); fi

echo "== fixtures =="

BACKUPS="${WORK}/vol/instances/default/data/backups"
mkdir -p "${BACKUPS}"

# Fixtures reproduce the REAL Paperclip dump shape, not an idealised one: the
# Paperclip dumper emits a `-- paperclip statement breakpoint <uuid>` separator
# after EVERY statement, so a finished dump's last LINE is a comment and its
# last STATEMENT is COMMIT;. An earlier version of the shipper matched the last
# line literally and therefore rejected 100% of real dumps — silently shipping
# nothing. That is the regression these fixtures exist to hold down.
BP="-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900"

make_dump() { # $1 = filename; $2 = "good"|"nocommit"
  local body="${WORK}/body.sql"
  {
    echo "--"
    echo "-- PostgreSQL database dump"
    echo "--"
    echo "BEGIN;"; echo "${BP}"
    echo "CREATE TABLE issues (id uuid PRIMARY KEY, title text);"; echo "${BP}"
    echo "COPY issues (id, title) FROM stdin;"
    echo "1	first"
    echo "\\."
    echo "${BP}"
    echo "CREATE INDEX issues_title_idx ON issues (title);"; echo "${BP}"
    echo "ALTER TABLE issues ADD CONSTRAINT x CHECK (true);"; echo "${BP}"
    if [ "$2" = "good" ]; then
      echo
      echo "COMMIT;"
      echo "${BP}"
    fi
  } >"${body}"
  gzip -c "${body}" >"${BACKUPS}/$1"
  rm -f "${body}"
}

# Two dumps in the same ISO week + month (2026-09-28 is Mon of 2026W40,
# 2026-09-30 is Wed of the same week), one in a different week AND month.
make_dump "paperclip-20260928-203249.sql.gz" good
make_dump "paperclip-20260930-073020.sql.gz" good
make_dump "paperclip-20260815-040000.sql.gz" good
# A dump whose gzip stream is intact but which died before pg_dump's COMMIT;.
make_dump "paperclip-20260929-163249.sql.gz" nocommit
# A dump whose gzip stream is corrupt (truncated mid-stream).
make_dump "paperclip-20260927-203249.sql.gz" good
truncate -s 120 "${BACKUPS}/paperclip-20260927-203249.sql.gz"
# A bare .sql partial — a dump that never reached the gzip step. Must never be
# considered at all (these are the 1.4 GB orphans from GOL-1632).
printf 'BEGIN;\nCOPY issues (id) FROM stdin;\n1\n' >"${BACKUPS}/paperclip-20260930-110000.sql"

# Backdate every mtime to a date in a DIFFERENT month and ISO week than any
# filename stamp. If tiering ever regresses to mtime, the weekly/monthly keys
# below will carry 2025-01 / 2025W01 and the assertions fail loudly.
find "${BACKUPS}" -type f -exec touch -d '2025-01-02 12:00:00' {} +
ok "fixtures built (3 good, 1 no-COMMIT, 1 corrupt, 1 bare .sql partial)"

echo "== fake Spaces endpoint =="

cat >"${WORK}/fake_spaces.py" <<'PY'
"""Minimal S3/Spaces stand-in: PUT, HEAD, GET, ListObjectsV2.

Deliberately does NOT verify signatures (the SigV4 vectors above do that) but
DOES require an Authorization header, so an unsigned request is still caught.
Every request method+path is appended to a journal file, which is how the test
asserts the shipper never issues a DELETE.
"""
import os, sys, xml.sax.saxutils as sx
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs, unquote

ROOT = sys.argv[1]
JOURNAL = sys.argv[2]
OBJECTS = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _journal(self):
        with open(JOURNAL, "a") as fh:
            fh.write(f"{self.command} {self.path}\n")

    def _authed(self):
        if not self.headers.get("Authorization", "").startswith("AWS4-HMAC-SHA256 "):
            self.send_response(403)
            self.end_headers()
            return False
        if not self.headers.get("x-amz-content-sha256"):
            self.send_response(400)
            self.end_headers()
            return False
        return True

    def do_PUT(self):
        self._journal()
        if not self._authed():
            return
        key = unquote(urlsplit(self.path).path.lstrip("/"))
        n = int(self.headers.get("Content-Length", "0"))
        body = b""
        remaining = n
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 1 << 20))
            if not chunk:
                break
            body += chunk
            remaining -= len(chunk)
        OBJECTS[key] = body
        dest = os.path.join(ROOT, key.replace("/", "__"))
        with open(dest, "wb") as fh:
            fh.write(body)
        self.send_response(200)
        self.send_header("ETag", '"x"')
        self.end_headers()

    def do_HEAD(self):
        self._journal()
        if not self._authed():
            return
        key = unquote(urlsplit(self.path).path.lstrip("/"))
        if key not in OBJECTS:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(OBJECTS[key])))
        self.end_headers()

    def do_GET(self):
        self._journal()
        if not self._authed():
            return
        parts = urlsplit(self.path)
        qs = parse_qs(parts.query)
        if qs.get("list-type") == ["2"]:
            prefix = qs.get("prefix", [""])[0]
            hits = sorted(k for k in OBJECTS if k.startswith(prefix))
            body = (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                "<IsTruncated>false</IsTruncated>"
                + "".join(
                    f"<Contents><Key>{sx.escape(k)}</Key>"
                    f"<Size>{len(OBJECTS[k])}</Size></Contents>"
                    for k in hits
                )
                + "</ListBucketResult>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/xml")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        key = unquote(parts.path.lstrip("/"))
        if key not in OBJECTS:
            self.send_response(404)
            self.end_headers()
            return
        body = OBJECTS[key]
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        self._journal()
        self.send_response(204)
        self.end_headers()


srv = HTTPServer(("127.0.0.1", 0), Handler)
print(srv.server_port, flush=True)
srv.serve_forever()
PY

mkdir -p "${WORK}/bucket"
JOURNAL="${WORK}/journal.txt"
: >"${JOURNAL}"
python3 "${WORK}/fake_spaces.py" "${WORK}/bucket" "${JOURNAL}" >"${WORK}/port.txt" &
SERVER_PID=$!
for _ in $(seq 1 50); do
  PORT="$(cat "${WORK}/port.txt" 2>/dev/null)"
  [ -n "${PORT}" ] && break
  sleep 0.1
done
if [ -z "${PORT:-}" ]; then
  echo "  FAIL — fake Spaces endpoint never reported a port"
  exit 1
fi
ok "fake Spaces endpoint listening on 127.0.0.1:${PORT}"

export SPACES_BACKUP_ENDPOINT="http://127.0.0.1:${PORT}"
export SPACES_BACKUP_BUCKET="agenticos-backups-test"
export SPACES_BACKUP_ACCESS_KEY_ID="TESTACCESSKEY"
export SPACES_BACKUP_SECRET_KEY="testsecretkey"
export PAPERCLIP_DATA_DIR="${WORK}/vol"
export ENV_FILE="/dev/null"
export STAMP_DIR="${WORK}/stamps"
export MAX_UPLOADS="10"

run_shipper() { python3 "${SHIPPER}" "$@" 2>&1; }

echo "== dry-run uploads nothing =="
OUT="$(run_shipper --dry-run)"
check "dry-run exits 0" "$?" "0"
contains "dry-run says it would upload" "${OUT}" "DRY-RUN would upload"
check "dry-run wrote no objects" "$(ls -1 "${WORK}/bucket" | wc -l | tr -d ' ')" "0"
not_contains "dry-run issued no PUT" "$(cat "${JOURNAL}")" "PUT "

echo "== first real run =="
OUT="$(run_shipper)"
RC=$?
check "first run exits 0" "${RC}" "0"

objects() { ls -1 "${WORK}/bucket" | sed 's/__/\//g' | sort; }
OBJS="$(objects)"
echo "${OBJS}" | sed 's/^/     /'

contains "good dump -> daily"   "${OBJS}" "paperclip/daily/paperclip-20260930-073020.sql.gz"
contains "good dump -> weekly"  "${OBJS}" "paperclip/weekly/2026W40/"
contains "good dump -> monthly" "${OBJS}" "paperclip/monthly/2026-09/"
contains "older month -> its own monthly" "${OBJS}" "paperclip/monthly/2026-08/"
contains "older week -> its own weekly"   "${OBJS}" "paperclip/weekly/2026W33/"

# mtime on every fixture is 2025-01-02. If tiering regressed to mtime these
# would exist; the filename stamp is the only correct source (GOL-1632).
not_contains "tiering ignores mtime (no 2025-01 monthly)" "${OBJS}" "monthly/2025-01/"
not_contains "tiering ignores mtime (no 2025W01 weekly)"  "${OBJS}" "weekly/2025W01/"

not_contains "corrupt dump never uploaded"    "${OBJS}" "paperclip-20260927-203249"
not_contains "no-COMMIT dump never uploaded"  "${OBJS}" "paperclip-20260929-163249"
not_contains "bare .sql partial never uploaded" "${OBJS}" "paperclip-20260930-110000"
contains "corrupt dump rejected loudly"   "${OUT}" "paperclip-20260927-203249.sql.gz: REJECTED"
contains "no-COMMIT dump rejected loudly" "${OUT}" "does not end in COMMIT;"

# Exactly one weekly object per ISO week: 09-28 and 09-30 are both 2026W40.
check "one weekly object for 2026W40" \
  "$(echo "${OBJS}" | grep -c 'weekly/2026W40/')" "1"
check "one monthly object for 2026-09" \
  "$(echo "${OBJS}" | grep -c 'monthly/2026-09/')" "1"
check "every good dump reached daily" \
  "$(echo "${OBJS}" | grep -c 'paperclip/daily/')" "3"

not_contains "shipper never issued a DELETE" "$(cat "${JOURNAL}")" "DELETE "

echo "== second run is a no-op (idempotent) =="
BEFORE="$(objects)"
: >"${JOURNAL}"
OUT="$(run_shipper)"
check "second run exits 0" "$?" "0"
check "second run changed nothing" "$(objects)" "${BEFORE}"
contains "second run reports skips" "${OUT}" "already off-box in every tier"
not_contains "second run issued no PUT" "$(cat "${JOURNAL}")" "PUT "
contains "second run shipped 0" "${OUT}" "0 dump(s) shipped"

echo "== restore proof =="
OUT="$(run_shipper --verify-restore --scratch-dir "${WORK}/scratch")"
check "--verify-restore exits 0" "$?" "0"
contains "restore proof passes" "${OUT}" "RESTORE PROOF OK"
contains "restore proof parses statements" "${OUT}" "CREATE TABLE=1"
check "restore scratch file cleaned up" "$(ls -1 "${WORK}/scratch" | wc -l | tr -d ' ')" "0"

echo "== missing credentials fail loudly, not silently =="
OUT="$(env -u SPACES_BACKUP_ACCESS_KEY_ID -u SPACES_BACKUP_SECRET_KEY \
  python3 "${SHIPPER}" 2>&1)"
check "no-credentials run exits 2" "$?" "2"
contains "no-credentials run says why" "${OUT}" "credentials not found"

# An `op://` reference in .env is PROVISIONED-LOOKING but worthless: nothing
# runs `op inject` over /opt/agenticos/.env, so the shipper would sign with the
# reference text and get a 403 that reads like a revoked key. It must name the
# real problem instead.
echo "== an unresolved 1Password reference is not a credential =="
OUT="$(SPACES_BACKUP_ACCESS_KEY_ID='op://Goldberry Grove - Admin/AgenticOS Infra/backups_spaces_access_key_id' \
       SPACES_BACKUP_SECRET_KEY='op://Goldberry Grove - Admin/AgenticOS Infra/backups_spaces_secret_key' \
       python3 "${SHIPPER}" 2>&1)"
check "op:// reference run exits 2" "$?" "2"
contains "op:// reference run says it is a reference" "${OUT}" "op:// reference, not a secret"
not_contains "op:// reference run did not try to upload" "${OUT}" "uploaded"

echo "== cloud-init provisions SPACES_BACKUP_* into .env =="
# The Terraform vars are threaded into templatefile(); prove the TEMPLATE
# actually writes them, and honours the "empty = leave untouched" contract
# documented in infra/terraform/variables.tf. Extracted from the real template
# and executed, so it cannot drift from what boots the droplet.
TPL="${REPO_ROOT}/infra/cloud-init/droplet-bootstrap.yaml.tpl"
ENVF="${WORK}/agenticos.env"
render_env_block() { # $1 = access key id, $2 = secret key
  sed -n '/^ *# Off-box Paperclip backup shipper credentials/,/^ *fi$/p' "${TPL}" \
    | sed -e "s|\${backups_spaces_access_key_id}|$1|g" \
          -e "s|\${backups_spaces_secret_key}|$2|g" \
          -e "s|/opt/agenticos/.env|${ENVF}|g"
}
check "the env block was found in the template" \
  "$(render_env_block a b | grep -c 'SPACES_BACKUP_ACCESS_KEY_ID=')" "2"

# Fresh droplet: both values present -> both lines written, literally.
printf 'AGENTICOS_DB_PASSWORD=pw\n' >"${ENVF}"
# A base64 secret can contain '/' and '+'; the writer must not mangle it.
bash -c "$(render_env_block 'DO00EXAMPLEKEYID' 'b/a+se64==secret')" >/dev/null 2>&1
check "access key id written verbatim" \
  "$(grep -c '^SPACES_BACKUP_ACCESS_KEY_ID=DO00EXAMPLEKEYID$' "${ENVF}")" "1"
check "base64 secret written verbatim (slashes and plusses survive)" \
  "$(grep -c '^SPACES_BACKUP_SECRET_KEY=b/a+se64==secret$' "${ENVF}")" "1"
check "unrelated .env lines untouched" \
  "$(grep -c '^AGENTICOS_DB_PASSWORD=pw$' "${ENVF}")" "1"

# Re-provision with a rotated key: correct in place, never duplicate.
bash -c "$(render_env_block 'DO00ROTATED' 'rotated-secret')" >/dev/null 2>&1
check "re-provision leaves exactly one access-key line" \
  "$(grep -c '^SPACES_BACKUP_ACCESS_KEY_ID=' "${ENVF}")" "1"
check "re-provision corrects the value" \
  "$(grep -c '^SPACES_BACKUP_ACCESS_KEY_ID=DO00ROTATED$' "${ENVF}")" "1"
check "re-provision leaves exactly one secret line" \
  "$(grep -c '^SPACES_BACKUP_SECRET_KEY=' "${ENVF}")" "1"

# Operator has not exported TF_VAR_backups_spaces_* -> an unrelated apply must
# NOT de-provision a working shipper. This is the whole reason the block is
# conditional instead of an unconditional upsert like the DB password.
BEFORE_ENV="$(cat "${ENVF}")"
bash -c "$(render_env_block '' '')" >/dev/null 2>&1
check "empty vars leave a provisioned .env untouched" "$(cat "${ENVF}")" "${BEFORE_ENV}"

# And an empty apply against a never-provisioned box writes nothing (rather
# than writing empty values, which would defeat the shipper's own guard).
printf 'AGENTICOS_DB_PASSWORD=pw\n' >"${ENVF}"
bash -c "$(render_env_block '' '')" >/dev/null 2>&1
check "empty vars write no empty SPACES_BACKUP_ lines" \
  "$(grep -c '^SPACES_BACKUP_' "${ENVF}" || true)" "0"

# The whole point of Josh's 2026-09-30 catch: the template must never hand the
# shipper reference text. Belt-and-braces against a future edit.
not_contains "the template writes literals, never op:// references" \
  "$(render_env_block 'DO00K' 'sEcret')" "SPACES_BACKUP_ACCESS_KEY_ID=op://"

echo "== MAX_UPLOADS caps a run =="
rm -rf "${WORK}/bucket"; mkdir -p "${WORK}/bucket"
kill "${SERVER_PID}" 2>/dev/null; wait "${SERVER_PID}" 2>/dev/null
: >"${WORK}/port.txt"; : >"${JOURNAL}"
python3 "${WORK}/fake_spaces.py" "${WORK}/bucket" "${JOURNAL}" >"${WORK}/port.txt" &
SERVER_PID=$!
for _ in $(seq 1 50); do
  PORT="$(cat "${WORK}/port.txt" 2>/dev/null)"
  [ -n "${PORT}" ] && break
  sleep 0.1
done
export SPACES_BACKUP_ENDPOINT="http://127.0.0.1:${PORT}"
OUT="$(MAX_UPLOADS=1 run_shipper)"
check "capped run exits 0" "$?" "0"
contains "capped run says it stopped early" "${OUT}" "MAX_UPLOADS=1 reached"
check "capped run shipped exactly one dump" \
  "$(objects | grep -c 'paperclip/daily/')" "1"
# Newest-first ordering: the cap must never strand the most recent restore point.
contains "capped run shipped the NEWEST dump" "$(objects)" "daily/paperclip-20260930-073020.sql.gz"

echo
echo "-------------------------------------------"
echo "paperclip-backup-offsite: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ] || exit 1
