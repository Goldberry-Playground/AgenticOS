#!/usr/bin/env bash
#
# github-sync-heartbeat-read.sh — GOL-2591 (read side of the worker tripwire)
#
# Print the github-sync worker's liveness heartbeat as ONE machine-readable line.
# Runs ON the droplet (SSH'd from inbound-webhook-deadman.yml), because the
# heartbeat lives in the plugin's Postgres schema and that DB is VPC-private.
#
# WHY A HEARTBEAT AND NOT THE DEPLOY'S RED: the GOL-2585 outage was already
# detected by CI — deploy run 35939085377 went red on its own hard gate and the
# failure router minted issue #710 a minute later — and still ran five days,
# because the router delivers by minting a GitHub issue that only reaches the
# board when the **github-sync worker** mirrors it. A deploy that kills that
# worker cannot report itself. Worse, a red deploy only fires when a deploy
# happens at all: the 2026-09-09 crash (GOL-2279) killed the worker with no
# deploy in sight. `github_sync_heartbeat` (migration 007, first row
# 2026-09-29T20:44:31Z) is the tripwire that covers BOTH: it is unconditional, so
# unlike `github_sync_delivery` a quiet inbound window never looks like a crash.
#
# This script only READS and reports; it never decides and never alerts. The
# staleness verdict and the Discord page live on the Actions runner
# (scripts/ci/github-sync-heartbeat-probe.mjs) so the ops webhook is never shipped
# over SSH onto the box — least privilege, and the decision stays unit-testable.
#
# Credentials: none needed on the host. `docker compose exec` runs psql INSIDE the
# agenticos-db container, where POSTGRES_USER/POSTGRES_PASSWORD are already in the
# environment — so the DB password is never read, echoed, or stored host-side.
#
# Output (exactly one line on stdout, always exit 0 so the runner is the single
# decision point — a non-zero here would fail the job before it can page):
#   HEARTBEAT ok <updated_at> <worker_booted_at> <worker_version>
#   HEARTBEAT missing                 # table present, never stamped
#   HEARTBEAT no_table                # migration 007 absent, or the namespace drifted
#   HEARTBEAT unreadable <reason>     # docker/psql unavailable or errored
#
# Env overrides:
#   COMPOSE_DIR   default /opt/agenticos
#   DB_SERVICE    default agenticos-db
#   DB_NAME       default paperclip     (the plugin schemas live here, not `agenticos`)
#   HB_SCHEMA     default plugin_github_sync_40eceaaa3a
#                 Host-derived from pluginKey `agenticos.github-sync-plugin` +
#                 slug `github_sync`; regenerate if either changes (see
#                 packages/github-sync-plugin/migrations/007_heartbeat.sql).
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
DB_SERVICE="${DB_SERVICE:-agenticos-db}"
DB_NAME="${DB_NAME:-paperclip}"
HB_SCHEMA="${HB_SCHEMA:-plugin_github_sync_40eceaaa3a}"
DB_USER="${DB_USER:-agenticos}"

# `unreadable` (not a hard exit) so an unexpected host state still reaches Discord
# as an actionable page rather than dying as a bare red job nobody is watching.
say_unreadable() { echo "HEARTBEAT unreadable $*"; exit 0; }

command -v docker >/dev/null 2>&1 || say_unreadable "docker-not-on-PATH"
cd "$COMPOSE_DIR" 2>/dev/null || say_unreadable "compose-dir-absent:${COMPOSE_DIR}"

# TWO queries, not one CASE: Postgres parses and plans the WHOLE statement, so a
# static reference to a missing relation raises `relation does not exist` even in a
# branch a `to_regclass(...) IS NULL` guard would never take. Probing existence
# first (to_regclass takes a text literal, so it never references the table
# statically) is what makes "migration 007 never ran / namespace drifted" a
# distinct, actionable answer instead of a generic unreadable error.
PROBE_SQL="SELECT coalesce(to_regclass('${HB_SCHEMA}.github_sync_heartbeat')::text, '');"
ROW_SQL="SELECT updated_at || '|' || worker_booted_at || '|' || coalesce(nullif(worker_version, ''), '-')
           FROM ${HB_SCHEMA}.github_sync_heartbeat WHERE id = 1;"

# psql inside the DB container: -A unaligned, -t tuples-only — one bare record with
# no header and no padding, so the parser has a stable contract.
# POSTGRES_USER only exists inside the container, so -U carries the host-side
# default that matches docker-compose.yml; psql over the container's unix socket
# authenticates as `trust` (the postgres image's local pg_hba rule), which is why
# no DB password is ever read, echoed, or stored on the host.
psql_q() {
  docker compose exec -T "$DB_SERVICE" \
    psql -U "${DB_USER}" -d "$DB_NAME" -At -c "$1" 2>&1
}

out="$(psql_q "$PROBE_SQL")"; rc=$?
if [ "$rc" -ne 0 ]; then
  # Collapse to one line — a multi-line psql error would break the one-line contract.
  say_unreadable "psql-rc${rc}:$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-160)"
fi
if [ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
  echo "HEARTBEAT no_table"
  exit 0
fi

out="$(psql_q "$ROW_SQL")"; rc=$?
if [ "$rc" -ne 0 ]; then
  say_unreadable "psql-rc${rc}:$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-160)"
fi

out="$(printf '%s' "$out" | tr -d '\r' | tr -d '[:blank:]' | tail -n1)"
if [ -z "$out" ]; then
  # Table exists but holds no id=1 row: the worker has never stamped a heartbeat.
  echo "HEARTBEAT missing"
  exit 0
fi

IFS='|' read -r updated booted version <<< "$out"
if [ -z "${updated:-}" ] || [ -z "${booted:-}" ]; then
  say_unreadable "row-incomplete:$(printf '%s' "$out" | cut -c1-120)"
fi
echo "HEARTBEAT ok ${updated} ${booted} ${version:--}"
exit 0
