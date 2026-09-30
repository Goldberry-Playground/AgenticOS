#!/usr/bin/env bash
#
# rebuild-plugin-dists.test.sh — offline harness for scripts/rebuild-plugin-dists.sh
# (GOL-2694, latent bug found while fixing GOL-2685). No droplet, no pnpm, no
# network: a stubbed `pnpm` reproduces the two real-pnpm behaviours that can
# silently disarm this script on the box, and a throwaway REPO_DIR stands in for
# /opt/agenticos/repo.
#
# WHY THIS EXISTS — the rebuild that cannot run:
# deploy-host-scripts.yml invokes the script as
#   ssh <host> "bash -lc 'cd /opt/agenticos/repo && bash scripts/rebuild-plugin-dists.sh'"
# — a LOGIN shell (inherits the droplet profile) with NO tty (no `ssh -t`). Two
# consequences, both of which leave the box serving the stale bind-mounted dist
# the script exists to replace:
#   1. If the profile exports NODE_ENV=production, pnpm omits devDependencies.
#      `esbuild` is a devDependency of every plugin and each `build` script shells
#      out to it directly, so the install "succeeds" and the build dies 127.
#   2. When the resolved install differs from node_modules on disk — exactly the
#      case after `git reset --hard` moved the lockfile — pnpm prompts
#      "The modules directories will be removed and reinstalled. Proceed? (Y/n)".
#      With no tty nothing answers it and the deploy step HANGS to its timeout.
# The script pins NODE_ENV=development, --prod=false and
# --config.confirmModulesPurge=false to close both. The last case below is the
# negative control: strip those flags back out and this harness must go RED,
# which is what makes it a regression guard rather than a tautology.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../rebuild-plugin-dists.sh"
[ -f "$SCRIPT" ] || { echo "FATAL: $SCRIPT missing" >&2; exit 1; }
# shellcheck source=scripts/plugin-registry.sh
source "$HERE/../plugin-registry.sh"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# --- stubbed pnpm -----------------------------------------------------------
# Models the two real behaviours above, and logs every invocation so we can
# assert the flags rather than infer them:
#   $FAKE_LOG        append-only "<subcmd> NODE_ENV=<v> <argv...>"
#   $FAKE_PROD_ONLY  written by `install` when it resolved production-only
#   $FAKE_NO_WRITE   "1" → `build` produces an EMPTY dist (half-built trap)
cat >"$WORK/pnpm" <<'PNPM'
#!/usr/bin/env bash
set -euo pipefail
echo "${1:-} NODE_ENV=${NODE_ENV:-unset} $*" >>"$FAKE_LOG"

want_prod=0
[ "${NODE_ENV:-}" = production ] && want_prod=1
for a in "$@"; do
  case "$a" in
    --prod=false) want_prod=0 ;;
    --prod|--prod=true) want_prod=1 ;;
  esac
done

if [ "${1:-}" = install ]; then
  # Real pnpm's interactive purge confirmation. Non-interactive stdin + no
  # --config.confirmModulesPurge=false is the hang; surface it as a hard error
  # so the harness sees a failure instead of blocking for five minutes.
  purge_ok=0
  for a in "$@"; do
    [ "$a" = "--config.confirmModulesPurge=false" ] && purge_ok=1
  done
  if [ "$purge_ok" != 1 ] && [ ! -t 0 ]; then
    echo "The modules directories will be removed and reinstalled. Proceed? (Y/n)" >&2
    echo "fake pnpm: no tty to answer the purge prompt — real pnpm would HANG here" >&2
    exit 91
  fi
  [ "$want_prod" = 1 ] && : >"$FAKE_PROD_ONLY"
  echo "fake pnpm install: prod_only=${want_prod}"
  exit 0
fi

# Anything else in this script is `pnpm <filters> build`.
if [ -f "$FAKE_PROD_ONLY" ]; then
  echo "esbuild: command not found" >&2
  exit 127
fi
prev=""
for a in "$@"; do
  [ "$prev" = --filter ] && {
    p="${a#@agenticos/}"
    mkdir -p "packages/${p}/dist"
    if [ "${FAKE_NO_WRITE:-0}" = 1 ]; then
      : >"packages/${p}/dist/worker.js"; : >"packages/${p}/dist/manifest.js"
    else
      echo "// rebuilt ${p} $(date +%s%N)" >"packages/${p}/dist/worker.js"
      echo "// rebuilt ${p} manifest"      >"packages/${p}/dist/manifest.js"
    fi
  }
  prev="$a"
done
exit 0
PNPM
chmod +x "$WORK/pnpm"
export PATH="$WORK:$PATH"
export FAKE_LOG="$WORK/log" FAKE_PROD_ONLY="$WORK/prod_only"

# A throwaway stand-in for /opt/agenticos/repo, holding the STALE dists.
seed_repo() {
  rm -rf "$WORK/repo"
  for p in ${PLUGIN_DIRS}; do
    mkdir -p "$WORK/repo/packages/${p}/dist"
    echo "// stale ${p}" >"$WORK/repo/packages/${p}/dist/worker.js"
    echo "// stale ${p}" >"$WORK/repo/packages/${p}/dist/manifest.js"
  done
  : >"$FAKE_LOG"; rm -f "$FAKE_PROD_ONLY"
}
run() { REPO_DIR="$WORK/repo" bash "$1" </dev/null 2>&1; }

# 1. THE REGRESSION: a droplet profile exporting NODE_ENV=production must not be
# able to strip esbuild out of the install.
seed_repo
out="$(NODE_ENV=production run "$SCRIPT")" \
  || fail "NODE_ENV=production must still rebuild, got exit $?:
$out"
grep -q '^REBUILT_COUNT: 6' <<<"$out" || fail "expected all 6 plugins rebuilt: $out"
grep -q 'esbuild: command not found' <<<"$out" && fail "install resolved production-only: $out"
[ -f "$FAKE_PROD_ONLY" ] && fail "install omitted devDependencies under NODE_ENV=production"
echo "  ok  NODE_ENV=production from the droplet profile cannot strip esbuild"

# 2. The flags are actually on the wire, not merely implied by case 1 passing.
grep -q 'NODE_ENV=development .*--prod=false' "$FAKE_LOG" \
  || fail "install did not pin NODE_ENV=development + --prod=false:
$(cat "$FAKE_LOG")"
grep -q -- '--config.confirmModulesPurge=false' "$FAKE_LOG" \
  || fail "install did not pin --config.confirmModulesPurge=false:
$(cat "$FAKE_LOG")"
# The build invocation is `pnpm <filters> build`, so the subcommand is LAST.
grep -qE '^--filter NODE_ENV=development .* build$' "$FAKE_LOG" \
  || fail "build did not run with NODE_ENV=development:
$(cat "$FAKE_LOG")"
echo "  ok  install pins NODE_ENV=development, --prod=false, confirmModulesPurge=false"

# 3. A build that leaves an EMPTY dist must fail RED — a half-built dist is the
# stale-worker trap this script was written to close, not a successful rebuild.
seed_repo
if out="$(FAKE_NO_WRITE=1 run "$SCRIPT")"; then
  fail "empty dist must exit non-zero: $out"
fi
grep -q 'FATAL: packages/.*/dist/worker.js missing or empty' <<<"$out" \
  || fail "missing FATAL annotation for empty dist: $out"
echo "  ok  empty dist after build fails RED"

# 4. NEGATIVE CONTROL — strip the pins back out and this harness must catch it.
# Without this, cases 1-2 would keep passing against a script that had quietly
# regressed to a bare `pnpm install --frozen-lockfile`.
seed_repo
sed -e 's/^NODE_ENV=development pnpm install --frozen-lockfile --prod=false \\$/pnpm install --frozen-lockfile \\/' \
    -e 's/^  --config.confirmModulesPurge=false \${filters}$/  ${filters}/' \
    -e 's/^NODE_ENV=development pnpm \${filters} build$/pnpm ${filters} build/' \
    "$SCRIPT" >"$WORK/regressed.sh"
# The copy resolves its own `source "${HERE}/plugin-registry.sh"` relative to
# $WORK, so the registry has to travel with it.
cp "$HERE/../plugin-registry.sh" "$WORK/plugin-registry.sh"
grep -q '^NODE_ENV=development pnpm' "$WORK/regressed.sh" \
  && fail "negative control did not strip the pins — the sed anchors have drifted from the script"
if out="$(NODE_ENV=production run "$WORK/regressed.sh")"; then
  fail "the un-pinned script must fail under NODE_ENV=production, but it passed:
$out"
fi
grep -qE 'esbuild: command not found|purge prompt' <<<"$out" \
  || fail "negative control failed for the wrong reason: $out"
echo "  ok  negative control: stripping the pins breaks the rebuild (harness has teeth)"

echo "rebuild-plugin-dists.test.sh: all assertions passed"
