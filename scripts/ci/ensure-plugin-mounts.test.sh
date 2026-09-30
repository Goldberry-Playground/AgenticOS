#!/usr/bin/env bash
#
# ensure-plugin-mounts.test.sh — offline harness for scripts/ensure-plugin-mounts.sh
# (GOL-2585). No droplet, no Docker daemon: a stubbed `docker` decides per-plugin
# whether `/paperclip/plugins/<p>/package.json` is readable, and flips the answer
# once `compose up --force-recreate` is called. That lets us prove the three
# behaviours the deploy depends on:
#   1. healthy box  → NO recreate at all (the guard must be a cheap no-op, since it
#      runs on every plugins deploy),
#   2. orphaned mount that a recreate repairs → exactly ONE recreate, exit 0,
#   3. orphaned mount a recreate does NOT repair → exit 1 with a `::error::`
#      annotation (the deploy must go RED, not green-with-a-warning),
# plus the arg validation (an unknown plugin must never reach `compose exec`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../ensure-plugin-mounts.sh"
[ -x "$SCRIPT" ] || { echo "FATAL: $SCRIPT missing or not executable" >&2; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/compose"

# --- stubbed docker ---------------------------------------------------------
# State files drive it:
#   $FAKE_BROKEN        space-separated plugins whose package.json is "missing"
#   $FAKE_HEAL_ON_UP    "1" → a `compose up` empties FAKE_BROKEN (recreate fixes it)
#   $FAKE_CALLS         append-only log of the compose subcommands invoked
cat >"$WORK/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = compose ] || { echo "fake docker supports only 'compose': $*" >&2; exit 99; }
shift
sub="${1:-}"
echo "$sub" >>"$FAKE_CALLS"
case "$sub" in
  exec)
    # docker compose exec -T <service> <cmd...>
    shift; while [ "${1:-}" = -T ]; do shift; done; shift   # drop -T and service
    if [ "${1:-}" = test ] && [ "${2:-}" = -s ]; then
      path="$3"; p="${path#/paperclip/plugins/}"; p="${p%/package.json}"
      for b in $(cat "$FAKE_BROKEN"); do [ "$b" = "$p" ] && exit 1; done
      exit 0
    fi
    if [ "${1:-}" = grep ]; then
      echo "783 635 253:1 /opt/agenticos/packages/github-sync-plugin//deleted /paperclip/plugins/github-sync-plugin ro,relatime"
      exit 0
    fi
    exit 0 ;;
  up)
    [ "$(cat "$FAKE_HEAL_ON_UP")" = 1 ] && : >"$FAKE_BROKEN"
    echo "Recreating paperclip-server" ;;
  ps) echo "paperclip-server  running" ;;
  *) ;;
esac
exit 0
DOCKER
chmod +x "$WORK/docker"
export PATH="$WORK:$PATH"
export FAKE_BROKEN="$WORK/broken" FAKE_HEAL_ON_UP="$WORK/heal" FAKE_CALLS="$WORK/calls"
export COMPOSE_DIR="$WORK/compose" MOUNT_RETRIES=2 MOUNT_SLEEP=0

fail() { echo "FAIL: $*" >&2; exit 1; }
reset() { : >"$FAKE_BROKEN"; : >"$FAKE_CALLS"; echo 1 >"$FAKE_HEAL_ON_UP"; }

# 1. healthy box → no recreate, exit 0
reset
out="$("$SCRIPT" 2>&1)" || fail "healthy box should exit 0, got: $out"
grep -q '^ok: all plugin mounts live' <<<"$out" || fail "healthy box missing ok line: $out"
grep -qx up "$FAKE_CALLS" && fail "healthy box must NOT recreate the container"
echo "  ok  healthy box is a no-op (no force-recreate)"

# 2. orphaned mount, recreate repairs it → exactly one recreate, exit 0
reset; echo "github-sync-plugin discord-plugin" >"$FAKE_BROKEN"
out="$("$SCRIPT" 2>&1)" || fail "repairable orphan should exit 0, got: $out"
grep -q '::warning::orphaned plugin bind mount' <<<"$out" || fail "missing warning: $out"
grep -q 'all plugin mounts re-resolved' <<<"$out" || fail "missing heal line: $out"
grep -q '//deleted' <<<"$out" || fail "missing mountinfo evidence: $out"
ups="$(grep -cx up "$FAKE_CALLS" || true)"
[ "$ups" = 1 ] || fail "expected exactly 1 force-recreate, got $ups"
echo "  ok  orphaned mount → one force-recreate, heals, exit 0"

# 3. orphaned mount a recreate does NOT repair → exit 1 + ::error::
reset; echo "github-sync-plugin" >"$FAKE_BROKEN"; echo 0 >"$FAKE_HEAL_ON_UP"
if out="$("$SCRIPT" 2>&1)"; then fail "unrepairable orphan must exit non-zero: $out"; fi
grep -q '::error::plugin mount(s) still unreadable' <<<"$out" || fail "missing error annotation: $out"
echo "  ok  unrepairable orphan fails the deploy RED"

# 4. unknown plugin rejected before touching the container
reset
if out="$("$SCRIPT" not-a-plugin 2>&1)"; then fail "unknown plugin must be rejected: $out"; fi
grep -q "unknown plugin 'not-a-plugin'" <<<"$out" || fail "missing validation message: $out"
[ -s "$FAKE_CALLS" ] && fail "validation must run before any docker call"
echo "  ok  unknown plugin rejected before any docker call"

# 5. the probed set == PLUGIN_DIRS == the bind mounts in docker-compose.yml.
# This is the assertion that keeps the guard honest as plugins are added: a
# plugin that is bind-mounted but not probed can be orphaned with nobody
# watching (#709 added grove-content-drafter-plugin and this caught the gap).
reset
probed="$("$SCRIPT" 2>&1 | sed -n 's/^ok: all plugin mounts live inside [^:]*: //p')"
# shellcheck source=scripts/plugin-registry.sh
source "$HERE/../plugin-registry.sh"
declared="$(tr ' ' '\n' <<<"$PLUGIN_DIRS" | sort -u | tr '\n' ' ')"
got="$(tr ' ' '\n' <<<"$probed" | sed '/^$/d' | sort -u | tr '\n' ' ')"
[ "$got" = "$declared" ] || fail "probed plugins != PLUGIN_DIRS:
  probed:   $got
  declared: $declared"
mounted="$(sed -n 's#^ *- \./packages/\([^:]*\):/paperclip/plugins/.*#\1#p' \
  "$HERE/../../docker-compose.yml" | sort -u | tr '\n' ' ')"
[ "$got" = "$mounted" ] || fail "probed plugins != docker-compose.yml bind mounts:
  probed:  $got
  mounted: $mounted"
echo "  ok  probed set == PLUGIN_DIRS == docker-compose.yml plugin bind mounts"

echo "ensure-plugin-mounts.test.sh: all assertions passed"
