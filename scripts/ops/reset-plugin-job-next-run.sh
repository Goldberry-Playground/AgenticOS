#!/usr/bin/env bash
#
# reset-plugin-job-next-run.sh — GOL-2844
#
# Make a plugin job's NEW cron schedule take effect now instead of one old-cadence
# interval from now.
#
# THE TRAP (measured on prod 2026-09-30): when a plugin manifest ships a changed
# `jobs[].schedule`, the host upserts `plugin_jobs.schedule` but LEAVES
# `plugin_jobs.next_run_at` at the value computed from the OLD cron — and the
# scheduler gates on `next_run_at`, not on the cron string. So
# `grove-content-drafter`'s `content-draft-request` read `*/15 * * * *` in both
# `GET /api/plugins/{id}` and `GET /api/plugins/{id}/jobs` while `next_run_at`
# still said 07:00Z tomorrow — the nightly cadence the bump was meant to end,
# for another eight hours. None of the host-API levers clear it:
#
#   POST …/disable + …/enable        -> schedule re-read, next_run_at untouched
#   DELETE + POST /api/plugins/install -> job row is upserted on (plugin_id, job_key);
#                                       created_at survives, next_run_at untouched
#   POST …/jobs/{jobId}/trigger      -> runs the job out of band; does not write
#                                       last_run_at or next_run_at at all
#
# THE FIX: set `next_run_at = now()`. The host then runs the job on its next tick
# and recomputes `next_run_at` from the CURRENT cron itself — so this script never
# has to parse cron, and the host stays the only owner of the cadence.
#
# Idempotent by design: it only writes when `next_run_at` is further out than
# --max-wait (default 30 min). Run it twice and the second run reports `ok` and
# changes nothing. Safe to run after any manifest deploy that touched a schedule.
#
# Prerequisite: the job must be safe to run once immediately (both drafter jobs
# are — the request job dedupes against open issues via `pt#<id>`). If a job is
# not, wait for its natural fire instead of forcing a catch-up run.
#
# Credentials: none. `docker compose exec` runs psql INSIDE the agenticos-db
# container, where POSTGRES_USER/POSTGRES_PASSWORD already live, so no DB
# password is ever read, echoed, or stored host-side (same pattern as
# scripts/github-sync-heartbeat-read.sh).
#
# Usage (on the droplet):
#   bash scripts/ops/reset-plugin-job-next-run.sh <pluginKey> <jobKey> [--max-wait MIN] [--dry-run]
#   bash scripts/ops/reset-plugin-job-next-run.sh agenticos.grove-content-drafter content-draft-request
#
# Output (one line, machine-readable):
#   reset <pluginKey> <jobKey> was=<old next_run_at> now=<new next_run_at>
#   ok <pluginKey> <jobKey> next=<next_run_at>          # already due within --max-wait
#   error <reason>                                       # exit 1
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
DB_SERVICE="${DB_SERVICE:-agenticos-db}"
DB_NAME="${DB_NAME:-paperclip}"
DB_USER="${DB_USER:-agenticos}"

die() { echo "error $*"; exit 1; }

PLUGIN_KEY=""; JOB_KEY=""; MAX_WAIT=30; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --max-wait) MAX_WAIT="${2:-}"; shift 2 || die "--max-wait needs a value";;
    --dry-run)  DRY_RUN=1; shift;;
    -h|--help)  sed -n '2,45p' "$0"; exit 0;;
    -*)         die "unknown-flag:$1";;
    *)          if [ -z "$PLUGIN_KEY" ]; then PLUGIN_KEY="$1"; else JOB_KEY="$1"; fi; shift;;
  esac
done
[ -n "$PLUGIN_KEY" ] && [ -n "$JOB_KEY" ] || die "usage: $0 <pluginKey> <jobKey> [--max-wait MIN] [--dry-run]"
case "$MAX_WAIT" in (*[!0-9]*|'') die "max-wait-not-an-integer:${MAX_WAIT}";; esac

# Single-quoted SQL literals: reject the one character that could break out of
# them rather than trying to escape it. Plugin/job keys are dotted slugs.
for v in "$PLUGIN_KEY" "$JOB_KEY"; do
  case "$v" in (*"'"*) die "quote-in-argument";; esac
done

command -v docker >/dev/null 2>&1 || die "docker-not-on-PATH"
cd "$COMPOSE_DIR" 2>/dev/null || die "compose-dir-absent:${COMPOSE_DIR}"

psql_q() {
  docker compose exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -At -c "$1" 2>&1
}

one_line() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-160; }

# Read first, so "no such job" is a distinct answer from "nothing to do".
READ_SQL="SELECT j.next_run_at, j.schedule, j.status
            FROM plugin_jobs j JOIN plugins p ON p.id = j.plugin_id
           WHERE p.plugin_key = '${PLUGIN_KEY}' AND j.job_key = '${JOB_KEY}';"
row="$(psql_q "$READ_SQL")"; rc=$?
[ "$rc" -eq 0 ] || die "psql-rc${rc}:$(one_line "$row")"
row="$(printf '%s' "$row" | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -n1)"
[ -n "$row" ] || die "no-such-job:${PLUGIN_KEY}/${JOB_KEY}"

old_next="${row%%|*}"

# Postgres decides "is it due soon" so the comparison happens in the DB's clock,
# not the caller's. A NULL next_run_at counts as due (nothing to reset).
DUE_SQL="SELECT CASE WHEN j.next_run_at IS NULL
                     OR j.next_run_at <= now() + interval '${MAX_WAIT} minutes'
                THEN 'soon' ELSE 'far' END
           FROM plugin_jobs j JOIN plugins p ON p.id = j.plugin_id
          WHERE p.plugin_key = '${PLUGIN_KEY}' AND j.job_key = '${JOB_KEY}';"
due="$(psql_q "$DUE_SQL")"; rc=$?
[ "$rc" -eq 0 ] || die "psql-rc${rc}:$(one_line "$due")"
due="$(printf '%s' "$due" | tr -d '\r[:blank:]' | grep -v '^$' | tail -n1)"

if [ "$due" = "soon" ]; then
  echo "ok ${PLUGIN_KEY} ${JOB_KEY} next=${old_next}"
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "reset ${PLUGIN_KEY} ${JOB_KEY} was=${old_next} now=<dry-run>"
  exit 0
fi

# The same `next_run_at > now() + interval` guard rides on the UPDATE, so a
# concurrent scheduler tick between the read and the write cannot be clobbered.
WRITE_SQL="UPDATE plugin_jobs j SET next_run_at = now(), updated_at = now()
             FROM plugins p
            WHERE p.id = j.plugin_id
              AND p.plugin_key = '${PLUGIN_KEY}' AND j.job_key = '${JOB_KEY}'
              AND j.next_run_at > now() + interval '${MAX_WAIT} minutes'
        RETURNING j.next_run_at;"
out="$(psql_q "$WRITE_SQL")"; rc=$?
[ "$rc" -eq 0 ] || die "psql-rc${rc}:$(one_line "$out")"
new_next="$(printf '%s' "$out" | tr -d '\r' | grep -E '^[0-9]{4}-' | tail -n1)"
[ -n "$new_next" ] || die "no-row-updated:${PLUGIN_KEY}/${JOB_KEY}"

echo "reset ${PLUGIN_KEY} ${JOB_KEY} was=${old_next} now=${new_next}"
