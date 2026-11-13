#!/usr/bin/env bash
# Tests for Check 2 (backup freshness) in infra/scripts/paperclip-volume-guard.sh
# — specifically the GOL-3854 hardening: freshness is measured from the newest
# *restorable* dump, so a fresher-but-empty .sql.gz (a 20-byte gzip header the
# server leaves when its in-process dump stalls mid-stream) can no longer read
# as "age 0, healthy" and silence the backup-stale page.
#
# The guard is driven through env overrides (no docker, no droplet):
#   PAPERCLIP_DATA_DIR — stand in for the volume mountpoint
#   ENV_FILE           — a temp .env with a dummy DISCORD_OPS_WEBHOOK_URL so
#                        post_discord proceeds to `curl`
#   RECLAIM=0          — reclaim off, so it never touches the fixtures
#   WARN_PCT=101       — never page on real CI disk headroom
#   STALE_MIN=120      — deterministic staleness threshold
# A stub `curl` on PATH captures every webhook attempt into ${SINK}; "the page
# fired" ⇔ ${SINK} contains the backup-stale message.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="${REPO_ROOT}/infra/scripts/paperclip-volume-guard.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
FAILED=0
pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; FAILED=1; }

# --- stub curl: append the whole invocation to the sink, succeed -------------
mkdir -p "${WORK}/bin"
cat >"${WORK}/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${SINK:-/dev/null}"
exit 0
STUB
chmod +x "${WORK}/bin/curl"

ENV_FILE="${WORK}/ops.env"
printf 'DISCORD_OPS_WEBHOOK_URL=https://example.invalid/hook\n' >"${ENV_FILE}"

# complete_dump PATH AGE_MIN — a real gzipped pg_dump ending in COMMIT;, mtimed AGE_MIN ago
complete_dump() {
  { printf -- '-- PostgreSQL database dump\n'
    head -c 500000 /dev/urandom | base64
    printf -- '\nCOMMIT;\n'; } | gzip >"$1"
  touch -d "-$2 min" "$1"
}
# empty_dump PATH AGE_MIN — a 20-byte header-only gzip (passes `gzip -t`, no rows)
empty_dump() { printf '' | gzip >"$1"; touch -d "-$2 min" "$1"; }

SINK=""
run() { # $1 = mount root
  SINK="$1/.sink"; : >"${SINK}"
  PATH="${WORK}/bin:${PATH}" \
  PAPERCLIP_DATA_DIR="$1" ENV_FILE="${ENV_FILE}" \
  STAMP_DIR="$1/.stamps" SINK="${SINK}" \
  RECLAIM=0 WARN_PCT=101 STALE_MIN=120 \
  "${GUARD}" >"$1/.out" 2>&1
}
new_root() { local r; r="$(mktemp -d "${WORK}/root.XXXXXX")"; mkdir -p "${r}/instances/default/data/backups"; echo "${r}"; }
paged()     { grep -q 'Paperclip DB backup is STALE' "$1/.sink"; }
outhas()    { grep -q "$2" "$1/.out"; }

echo "== 1. a single FRESH complete dump → no page =="
R="$(new_root)"; B="${R}/instances/default/data/backups"
complete_dump "${B}/paperclip-20260101-120000.sql.gz" 10
run "${R}"
paged "${R}" && fail "paged on a fresh complete dump" || pass "did not page on a fresh dump"
outhas "${R}" 'newest completed dump' && pass "logged the completed dump" || fail "no 'newest completed dump' log"

echo "== 2. FRESH empty dump masking an OLD complete dump → page fires (GOL-3854) =="
R="$(new_root)"; B="${R}/instances/default/data/backups"
complete_dump "${B}/paperclip-20260101-000000.sql.gz" 1500   # old, restorable, stale
empty_dump    "${B}/paperclip-20260102-000000.sql.gz" 1      # newest FILE, empty
run "${R}"
paged "${R}" && pass "paged: empty newest file did not mask staleness" || fail "FAILED TO PAGE — empty file masked the stale backup"
outhas "${R}" 'INCOMPLETE dump' && pass "flagged the empty newest file as incomplete" || fail "did not flag the incomplete newest file"
grep -qE 'is 15[0-9][0-9]m old' "${R}/.sink" && pass "measured age from the old COMPLETE dump" || fail "age not measured from the complete dump"

echo "== 3. ONLY empty dumps, no complete one → page fires =="
R="$(new_root)"; B="${R}/instances/default/data/backups"
empty_dump "${B}/paperclip-20260103-000000.sql.gz" 5
empty_dump "${B}/paperclip-20260103-010000.sql.gz" 1
run "${R}"
paged "${R}" && pass "paged when no complete dump exists" || fail "did not page with zero complete dumps"
outhas "${R}" 'no COMPLETE' && pass "logged that no complete dump was found" || fail "no 'no COMPLETE' log line"

echo "== 4. regression: a single OLD complete dump (> threshold) → page fires =="
R="$(new_root)"; B="${R}/instances/default/data/backups"
complete_dump "${B}/paperclip-20260104-000000.sql.gz" 1500
run "${R}"
paged "${R}" && pass "paged on a genuinely stale complete dump" || fail "did not page on a stale complete dump"

echo "== 5. empty box (no dumps at all) → no page =="
R="$(new_root)"
run "${R}"
paged "${R}" && fail "paged on a fresh box with no dumps" || pass "no page on a fresh box"
outhas "${R}" 'fresh box' && pass "logged the fresh-box skip" || fail "no fresh-box skip log"

if [ "${FAILED}" -ne 0 ]; then echo "FAIL: paperclip-volume-guard freshness tests" >&2; exit 1; fi
echo "PASS: paperclip-volume-guard freshness tests"
