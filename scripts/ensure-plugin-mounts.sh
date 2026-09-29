#!/usr/bin/env bash
#
# ensure-plugin-mounts.sh — GOL-2585 (recurrence of GOL-165 / GOL-166 / GOL-2279)
#
# Run ON the droplet, immediately AFTER anything that can replace a package
# directory's inode and BEFORE any step that talks to the plugin registry.
# Asserts that paperclip-server can actually READ every plugin package, and
# force-recreates the container when it cannot.
#
# Why this exists
# ---------------
# docker-compose.yml binds each plugin per-directory:
#   ./packages/<plugin> -> /paperclip/plugins/<plugin>:ro
# A bind mount pins to the host directory's INODE at container-start, not to the
# path. deploy-droplet-plugins.yml replaces those inodes on every run:
#   * the "Self-heal the packages symlink" step `rm -rf /opt/agenticos/packages`
#     when that path is a real directory — which deletes the exact inodes a
#     container started before the symlink existed has mounted;
#   * `git reset --hard origin/main` can replace a package directory outright.
# A long-lived paperclip-server then keeps the OLD inode and `/paperclip/plugins/*`
# reads EMPTY from inside the container (`/proc/1/mountinfo` marks the mount root
# `//deleted`). Workers keep serving `ready` from in-memory code, then die and can
# NEVER respawn, because a respawn re-reads the same unreadable package. Every
# webhook 502s before `onWebhook`, and all of the plugin's own reconcile crons run
# INSIDE that dead worker, so nothing self-heals.
#
# That is exactly how GOL-2585 happened: run 35939085377 (2026-09-24T00:35:16Z)
# orphaned all five mounts three minutes after a container start, `/upgrade`
# returned `400 Missing package.json at /paperclip/plugins/github-sync-plugin`,
# and github-sync stayed silently dead for five days. The GOL-804 convergence
# assert DID go red — the deploy detected the damage but had no way to repair it.
# This script is that repair, so the deploy converges instead of just complaining.
#
# The ONLY fix for an orphaned bind mount is to recreate the container; the
# in-container respawn watchdog (AgenticOS #688) cannot help. Recreating only
# paperclip-server is surgical: OAuth/login/plugin state lives on the
# paperclip-data volume, not the container layer.
#
# Idempotent and cheap: on a healthy box this is one `test -s` per plugin and no
# mutation at all. It recreates only when a mount is already broken — i.e. when
# the plugin host is already down, so there is nothing left to disrupt.
#
# Usage: scripts/ensure-plugin-mounts.sh [<plugin> ...]
#   plugin ∈ any name in PLUGIN_DIRS (scripts/plugin-registry.sh); no args → all of them
#
# Env overrides:
#   COMPOSE_DIR    default /opt/agenticos
#   SERVICE        default paperclip-server
#   DOCKER_BIN     default docker          (test seam)
#   MOUNT_RETRIES  default 10              post-recreate probe attempts
#   MOUNT_SLEEP    default 3               seconds between probes
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
SERVICE="${SERVICE:-paperclip-server}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
MOUNT_RETRIES="${MOUNT_RETRIES:-10}"
MOUNT_SLEEP="${MOUNT_SLEEP:-3}"

# The plugin list comes from the ONE source of truth (GOL-2423), never a local
# copy: every plugin in PLUGIN_DIRS is bind-mounted per-directory in
# docker-compose.yml, so every one of them can be orphaned and every one of them
# must be probed. A hardcoded list here would silently stop covering the newest
# plugin the first time someone adds one — which is exactly the drift
# plugin-registry.sh exists to end.
# shellcheck source=scripts/plugin-registry.sh
source "${HERE}/plugin-registry.sh"
VALID="${PLUGIN_DIRS}"

plugins=("$@")
[ "${#plugins[@]}" -ge 1 ] || read -r -a plugins <<< "$VALID"
for p in "${plugins[@]}"; do
  case " ${VALID} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}' (valid: ${VALID})" >&2; exit 2 ;;
  esac
done

command -v "$DOCKER_BIN" >/dev/null || { echo "FATAL: ${DOCKER_BIN} not found on PATH" >&2; exit 1; }
cd "$COMPOSE_DIR"

# Echo the list of plugins whose package.json is NOT readable+non-empty inside
# the running container. Empty output == every mount is live.
probe_orphans() {
  local p missing=""
  for p in "${plugins[@]}"; do
    if ! "$DOCKER_BIN" compose exec -T "$SERVICE" \
           test -s "/paperclip/plugins/${p}/package.json" >/dev/null 2>&1; then
      missing="${missing} ${p}"
    fi
  done
  echo "${missing# }"
}

# Decisive evidence for the report: an orphaned bind mount's root field in
# /proc/1/mountinfo carries a `//deleted` suffix. Best-effort — the probe above,
# not this, is the gate.
dump_mountinfo() {
  "$DOCKER_BIN" compose exec -T "$SERVICE" \
    grep -F '/paperclip/plugins/' /proc/1/mountinfo 2>/dev/null || true
}

orphans="$(probe_orphans)"
if [ -z "$orphans" ]; then
  echo "ok: all plugin mounts live inside ${SERVICE}: ${plugins[*]}"
  exit 0
fi

echo "::warning::orphaned plugin bind mount(s) detected in ${SERVICE}:${orphans} — package(s) unreadable from inside the container (GOL-2585). Force-recreating to re-resolve the mounts."
echo "--- /proc/1/mountinfo (plugin mounts, pre-recreate) ---"
dump_mountinfo

"$DOCKER_BIN" compose up -d --force-recreate "$SERVICE"
"$DOCKER_BIN" compose ps "$SERVICE"

for i in $(seq 1 "$MOUNT_RETRIES"); do
  orphans="$(probe_orphans)"
  if [ -z "$orphans" ]; then
    echo "--- /proc/1/mountinfo (plugin mounts, post-recreate) ---"
    dump_mountinfo
    echo "recreated ${SERVICE}: all plugin mounts re-resolved after ${i} probe(s)"
    exit 0
  fi
  echo "waiting for mounts (${i}/${MOUNT_RETRIES}) — still missing:${orphans}"
  sleep "$MOUNT_SLEEP"
done

echo "--- /proc/1/mountinfo (plugin mounts, after failed recreate) ---"
dump_mountinfo
echo "::error::plugin mount(s) still unreadable after force-recreating ${SERVICE}:${orphans}. The host package directories themselves are likely missing or unbuilt — inspect /opt/agenticos/packages and ${COMPOSE_DIR}/docker-compose.yml before retrying."
exit 1
