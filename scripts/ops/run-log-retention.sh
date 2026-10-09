#!/usr/bin/env bash
# Retention for Paperclip heartbeat run logs (GOL-3255).
#
#   <instance>/data/run-logs/<companyId>/<agentId>/<runId>.ndjson
#
# Policy (board ticket GOL-3255; the 7d/30d numbers are its own proposal):
#   * younger than COMPRESS_AFTER_DAYS (7)  -> untouched, readable in the UI
#   * older                                -> gzip in place (<runId>.ndjson.gz)
#   * older than DELETE_AFTER_DAYS (30)    -> deleted (raw or .gz)
#
# What that costs, measured against the server (/app/server/dist,
# services/run-log-store.js): the store only ever opens `<runId>.ndjson` and
# answers a missing file with a 404 that every caller already tolerates (the
# run viewer shows "log not found"; comment-metadata derivation and feedback
# export skip it). So a compressed log is gone from the UI but still on the box
# for `zcat`/`zgrep`; a deleted one is gone. Nothing else breaks.
#
# NEVER touches the database. `heartbeat_runs` rows (status, timing, cost,
# result) are the audit record and stay forever; only the raw stdout stream
# file ages out.
#
# Age is the file's mtime = the last line the run appended, so a running run's
# log (appended every few seconds) is never inside the window. gzip keeps the
# original mtime, so the delete clock keeps counting from the run, not from the
# compression.
#
# Runs INSIDE paperclip-server as `node` (files stay node-owned), from the
# nightly host wrapper infra/scripts/worktree-reaper.sh. Idempotent. Dry-run by
# default; --apply to act.
#
# Knobs: --root=<run-logs dir>, COMPRESS_AFTER_DAYS, DELETE_AFTER_DAYS.
set -euo pipefail

ROOT="${RUN_LOG_ROOT:-/paperclip/instances/default/data/run-logs}"
COMPRESS_AFTER_DAYS="${COMPRESS_AFTER_DAYS:-7}"
DELETE_AFTER_DAYS="${DELETE_AFTER_DAYS:-30}"
APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --root=*) ROOT="${arg#*=}" ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done
for v in COMPRESS_AFTER_DAYS DELETE_AFTER_DAYS; do
  case "${!v}" in ''|*[!0-9]*) echo "$v must be a whole number of days" >&2; exit 2 ;; esac
done
if [ "$DELETE_AFTER_DAYS" -le "$COMPRESS_AFTER_DAYS" ]; then
  echo "DELETE_AFTER_DAYS ($DELETE_AFTER_DAYS) must be > COMPRESS_AFTER_DAYS ($COMPRESS_AFTER_DAYS)" >&2; exit 2
fi
if [ ! -d "$ROOT" ]; then
  echo "run-log-retention: $ROOT does not exist — nothing to do"; exit 0
fi

log() { printf 'run-log-retention: %s\n' "$*"; }
mb() { awk -v b="$1" 'BEGIN{printf "%.0f", b/1048576}'; }

# -mtime +N means "more than N whole days"; -mmin keeps the boundary exact.
del_min=$((DELETE_AFTER_DAYS * 1440)); gz_min=$((COMPRESS_AFTER_DAYS * 1440))
before=$(du -sb "$ROOT" 2>/dev/null | cut -f1)

# 1. delete everything past the delete window (raw or compressed)
del_n=0; del_b=0
while IFS= read -r -d '' f; do
  sz=$(stat -c %s "$f" 2>/dev/null || echo 0)
  if [ "$APPLY" -eq 1 ]; then rm -f -- "$f" || continue; fi
  del_n=$((del_n + 1)); del_b=$((del_b + sz))
done < <(find "$ROOT" -type f \( -name '*.ndjson' -o -name '*.ndjson.gz' \) -mmin "+$del_min" -print0)

# 2. compress raw logs past the compress window
gz_n=0; gz_b=0
while IFS= read -r -d '' f; do
  sz=$(stat -c %s "$f" 2>/dev/null || echo 0)
  if [ "$APPLY" -eq 1 ]; then
    # A half-written .gz from an interrupted earlier run would make gzip refuse;
    # the raw file is still the source of truth, so drop the partial and redo.
    rm -f -- "$f.gz"
    gzip -n -6 -- "$f" || { log "WARN gzip failed: $f"; rm -f -- "$f.gz"; continue; }
  fi
  gz_n=$((gz_n + 1)); gz_b=$((gz_b + sz))
# `! -mmin +del` keeps the dry-run count honest: on --apply those are already gone.
done < <(find "$ROOT" -type f -name '*.ndjson' -mmin "+$gz_min" ! -mmin "+$del_min" -print0)

verb=$([ "$APPLY" -eq 1 ] && echo "" || echo "would ")
log "${verb}delete ${del_n} log(s) older than ${DELETE_AFTER_DAYS}d ($(mb "$del_b")MB)"
log "${verb}gzip ${gz_n} log(s) older than ${COMPRESS_AFTER_DAYS}d ($(mb "$gz_b")MB raw, ~4x smaller after)"
if [ "$APPLY" -eq 1 ]; then
  after=$(du -sb "$ROOT" 2>/dev/null | cut -f1)
  log "run-logs $(mb "$before")MB -> $(mb "$after")MB"
fi
log "--- apply=$APPLY"
