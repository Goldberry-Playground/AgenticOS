#!/usr/bin/env bash
# Offline self-test for the headroom check of infra/scripts/paperclip-volume-guard.sh
# (GOL-3255): posts on level TRANSITIONS only, lists the top consumers inside
# the volume, and does not remember a level the webhook failed to deliver.
# df / docker / curl are PATH shims; nothing leaves the box.
set -euo pipefail
GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../infra/scripts" && pwd)/paperclip-volume-guard.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail=0
pass() { echo "  PASS  $1"; }
bad() { echo "  FAIL  $1"; fail=1; }

mkdir -p "$TMP/bin" "$TMP/state" "$TMP/stamps"
DATA="$TMP/data"
mkdir -p "$DATA/work/gol1-wt" "$DATA/instances/default/data/run-logs" "$DATA/small"
head -c 3000000 /dev/zero >"$DATA/instances/default/data/run-logs/a.ndjson"
head -c 2000000 /dev/zero >"$DATA/work/gol1-wt/blob"
head -c 10000 /dev/zero >"$DATA/small/x"

# df shim: percent comes from $TMP/pct, avail is a constant.
cat >"$TMP/bin/df" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *pcent*) printf 'Use%%\n %s%%\n' "\$(cat "$TMP/pct")" ;;
  *avail*) printf 'Avail\n 9G\n' ;;
  *) exec /bin/df "\$@" ;;
esac
EOF
printf '#!/usr/bin/env bash\nexit 1\n' >"$TMP/bin/docker"
# curl shim: records each payload; fails when $TMP/curl-fail exists.
cat >"$TMP/bin/curl" <<EOF
#!/usr/bin/env bash
[ -f "$TMP/curl-fail" ] && exit 22
# one line per post (jq pretty-prints the payload over several lines)
while [ \$# -gt 0 ]; do [ "\$1" = -d ] && { printf '%s' "\$2" | tr -d '\n'; echo; } >>"$TMP/posts"; shift; done
EOF
chmod +x "$TMP/bin/"*
printf 'DISCORD_OPS_WEBHOOK_URL=https://example.invalid/hook\n' >"$TMP/env"

run() { # $1 = pct
  echo "$1" >"$TMP/pct"; : >"$TMP/posts"
  PATH="$TMP/bin:$PATH" PAPERCLIP_DATA_DIR="$DATA" ENV_FILE="$TMP/env" \
    STATE_DIR="$TMP/state" STAMP_DIR="$TMP/stamps" RECLAIM=0 \
    bash "$GUARD" >"$TMP/out" 2>&1 || { cat "$TMP/out"; bad "guard exited non-zero at $1%"; }
}
posts() { wc -l <"$TMP/posts" | tr -d ' '; }

run 70
[ "$(posts)" = 0 ] && pass "ok, first run: silent" || bad "ok first run posted"
run 86
[ "$(posts)" = 1 ] && pass "ok->warn posts once" || bad "ok->warn posts=$(posts)"
grep -q 'run-logs' "$TMP/posts" && pass "message names run-logs" || bad "run-logs missing from message"
grep -q 'gol1-wt' "$TMP/posts" && pass "message names the worktree" || bad "worktree missing from message"
grep -q '`/instances`' "$TMP/posts" && bad "explained parent /instances listed" || pass "explained parents are dropped"
run 88
[ "$(posts)" = 0 ] && pass "sustained warn: silent" || bad "sustained warn posted"
run 95
[ "$(posts)" = 1 ] && grep -q 'rotating_light' "$TMP/posts" && pass "warn->crit posts" || bad "warn->crit"
touch "$TMP/curl-fail"; run 60; rm -f "$TMP/curl-fail"
[ "$(cat "$TMP/state/level")" = crit ] && pass "failed post keeps old level" || bad "level advanced without delivery"
run 60
[ "$(posts)" = 1 ] && grep -q 'back under' "$TMP/posts" && pass "crit->ok recovery posts after retry" || bad "recovery"
grep -q 'Biggest' "$TMP/posts" && bad "recovery lists consumers" || pass "recovery message is short"
run 60
[ "$(posts)" = 0 ] && pass "sustained ok: silent" || bad "sustained ok posted"

[ "$fail" = 0 ] && echo "paperclip-volume-guard levels: all checks passed" || exit 1
