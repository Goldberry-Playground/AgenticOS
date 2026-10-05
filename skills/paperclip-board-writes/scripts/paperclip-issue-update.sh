#!/usr/bin/env bash
# paperclip-issue-update.sh — post a MULTILINE markdown comment (and optionally
# update status/priority/title) on a Paperclip issue without smooshing newlines.
#
# Exists because the bundled `paperclip` skill documents a script at
# scripts/paperclip-issue-update.sh that it never ships (GOL-3030: the path
# 404s in the package). This is a parallel, working helper — it does NOT fix
# that broken relative path. Call THIS copy, from this skill.
#
# Zero-install: bash + curl + jq (jq 1.7 present in the agent image). The body
# is passed to jq via --rawfile, so literal newlines, backticks, quotes and
# emoji survive JSON encoding untouched.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  paperclip-issue-update.sh [options] <<'MD'
  ... multiline markdown body ...
  MD

  paperclip-issue-update.sh --body-file notes.md [options]

Reads the comment body from stdin (heredoc) or --body-file.

Options:
  --issue-id ID        Issue id or identifier (default: $PAPERCLIP_TASK_ID)
  --body-file FILE     Read body from FILE instead of stdin
  --status STATUS      backlog|todo|in_progress|in_review|done|blocked|cancelled
  --priority PRIORITY  critical|high|medium|low
  --title TEXT         New issue title
  --resume             Send structured resume:true (needed to restart work on a
                       closed issue; generic agent comments there are inert)
  --comment-only       Force POST /comments even if --status is given
  --marker TEXT        Embed an HTML-comment idempotency marker in the body and
                       refuse to post if that marker is already on the issue
  --api-url URL        Override API base (default: Host-override channel)
  --dry-run            Print the resolved request + JSON payload, send nothing
  --help, -h           Show this help

Transport: defaults to the in-cluster channel
  http://paperclip-server:3100  with  Host: <host of $PAPERCLIP_API_URL>
because the public URL returns 302/403 for an agent run JWT from a sandbox.
Pass --api-url to use something else; the public URL is tried automatically if
the in-cluster host does not resolve.

Behavior:
  body + no field updates  -> POST /api/issues/{id}/comments   {"body": ...}
  body + field updates     -> PATCH /api/issues/{id}           {"comment": ..., ...}
  Writes are SINGLE-SHOT. Paperclip write endpoints routinely time out to the
  client while the row still commits, so this script never retries: on a
  timeout it tells you to verify before re-posting. Use --marker to make that
  check mechanical.

Examples:
  "$SKILL_DIR"/scripts/paperclip-issue-update.sh --status done <<'MD'
  ## Done

  - Shipped the helper
  - Verified the stored body keeps paragraph breaks
  MD

  paperclip-issue-update.sh --issue-id GOL-3058 --body-file /tmp/update.md --dry-run
EOF
}

die() { printf 'paperclip-issue-update: %s\n' "$*" >&2; exit 1; }

for c in curl jq; do
  command -v "$c" >/dev/null 2>&1 || die "missing required command: $c"
done

issue_id="${PAPERCLIP_TASK_ID:-}"
body_file=""
status=""
priority=""
title=""
resume=0
comment_only=0
marker=""
api_url=""
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-id)   issue_id="${2:?--issue-id needs a value}"; shift 2 ;;
    --body-file)  body_file="${2:?--body-file needs a value}"; shift 2 ;;
    --status)     status="${2:?--status needs a value}"; shift 2 ;;
    --priority)   priority="${2:?--priority needs a value}"; shift 2 ;;
    --title)      title="${2:?--title needs a value}"; shift 2 ;;
    --marker)     marker="${2:?--marker needs a value}"; shift 2 ;;
    --api-url)    api_url="${2:?--api-url needs a value}"; shift 2 ;;
    --resume)     resume=1; shift ;;
    --comment-only) comment_only=1; shift ;;
    --dry-run)    dry_run=1; shift ;;
    --help|-h)    usage; exit 0 ;;
    *)            die "unknown option: $1 (try --help)" ;;
  esac
done

[[ -n "$issue_id" ]] || die "no issue id: pass --issue-id or set PAPERCLIP_TASK_ID"
[[ -n "${PAPERCLIP_API_KEY:-}" ]] || die "PAPERCLIP_API_KEY is not set"

# ---- body: stdin heredoc or --body-file, never an inlined shell string -------
tmp_body="$(mktemp /tmp/pc-issue-body.XXXXXX.md)"
trap 'rm -f "$tmp_body"' EXIT
if [[ -n "$body_file" ]]; then
  [[ -r "$body_file" ]] || die "cannot read --body-file $body_file"
  cat -- "$body_file" > "$tmp_body"
else
  [[ -t 0 ]] && die "no body on stdin and no --body-file (try --help)"
  cat > "$tmp_body"
fi
[[ -s "$tmp_body" ]] || die "body is empty"

if [[ -n "$marker" ]]; then
  printf '\n<!-- marker:%s -->\n' "$marker" >> "$tmp_body"
fi

# ---- transport ---------------------------------------------------------------
public_url="${PAPERCLIP_API_URL:-${PAPERCLIP_RUNTIME_API_URL:-}}"
host_header=""
if [[ -n "$api_url" ]]; then
  base="$api_url"
else
  host_header="$(printf '%s' "$public_url" | sed -E 's#^[a-z]+://##; s#/.*$##')"
  if [[ -n "$host_header" ]] && getent hosts paperclip-server >/dev/null 2>&1; then
    base="http://paperclip-server:3100"
  else
    base="$public_url"
    host_header=""
  fi
fi
[[ -n "$base" ]] || die "no API base: set PAPERCLIP_API_URL or pass --api-url"

pc_curl() { # pc_curl METHOD PATH [JSON_FILE] -> prints body, sets PC_CODE
  local method="$1" path="$2" payload="${3:-}"
  local -a args=(-sS -m 60 -o /tmp/pc-resp.$$ -w '%{http_code}'
                 -X "$method" "${base}${path}"
                 -H "Authorization: Bearer ${PAPERCLIP_API_KEY}"
                 -H 'Content-Type: application/json'
                 -H 'Accept: application/json')
  [[ -n "$host_header" ]] && args+=(-H "Host: ${host_header}")
  [[ -n "${PAPERCLIP_RUN_ID:-}" ]] && args+=(-H "X-Paperclip-Run-Id: ${PAPERCLIP_RUN_ID}")
  [[ -n "$payload" ]] && args+=(--data-binary "@${payload}")
  PC_CODE="$(curl "${args[@]}" || true)"
  cat /tmp/pc-resp.$$ 2>/dev/null || true
  rm -f /tmp/pc-resp.$$
}

# ---- marker pre-check: duplicate guard, not a retry --------------------------
if [[ -n "$marker" && $dry_run -eq 0 ]]; then
  existing="$(pc_curl GET "/api/issues/${issue_id}/comments")"
  if [[ "$PC_CODE" == "200" ]] && printf '%s' "$existing" | grep -qF "marker:${marker}"; then
    printf 'marker:%s already present on %s — nothing posted (duplicate guard).\n' \
      "$marker" "$issue_id" >&2
    exit 0
  fi
fi

# ---- payload: jq --rawfile keeps literal newlines ----------------------------
use_patch=0
if [[ $comment_only -eq 0 && ( -n "$status" || -n "$priority" || -n "$title" ) ]]; then
  use_patch=1
fi

payload_file="$(mktemp /tmp/pc-issue-payload.XXXXXX.json)"
trap 'rm -f "$tmp_body" "$payload_file"' EXIT

if [[ $use_patch -eq 1 ]]; then
  jq -n --rawfile comment "$tmp_body" \
        --arg status "$status" --arg priority "$priority" --arg title "$title" \
        --argjson resume "$resume" '
    {comment: $comment}
    + (if $status   != "" then {status: $status}     else {} end)
    + (if $priority != "" then {priority: $priority} else {} end)
    + (if $title    != "" then {title: $title}       else {} end)
    + (if $resume == 1    then {resume: true}        else {} end)
  ' > "$payload_file"
  method=PATCH; path="/api/issues/${issue_id}"
else
  jq -n --rawfile body "$tmp_body" --argjson resume "$resume" '
    {body: $body} + (if $resume == 1 then {resume: true} else {} end)
  ' > "$payload_file"
  method=POST; path="/api/issues/${issue_id}/comments"
fi

if [[ $dry_run -eq 1 ]]; then
  printf '%s %s%s\n' "$method" "$base" "$path"
  [[ -n "$host_header" ]] && printf 'Host: %s\n' "$host_header"
  printf -- '--- payload ---\n'
  cat "$payload_file"
  printf '\n--- body as the API will store it ---\n'
  jq -r 'if has("comment") then .comment else .body end' "$payload_file"
  exit 0
fi

resp="$(pc_curl "$method" "$path" "$payload_file")"

case "$PC_CODE" in
  200|201)
    printf 'OK %s %s %s\n' "$PC_CODE" "$method" "$path"
    printf '%s' "$resp" | jq -r '
      "comment id: " + ((.id // .comment.id // "n/a")|tostring)
      + (if .status then "  status: " + .status else "" end)' 2>/dev/null || true
    ;;
  000|5*)
    cat >&2 <<EOF
WRITE RESULT UNKNOWN (http=$PC_CODE). Paperclip write endpoints time out to the
client while the row still commits. DO NOT RETRY BLINDLY — a retry duplicates
the comment (and a duplicated create spawns a duplicate agent run).

Verify first:
  curl -sS -m 60 ${host_header:+-H "Host: ${host_header}" }\\
    -H "Authorization: Bearer \$PAPERCLIP_API_KEY" \\
    ${base}/api/issues/${issue_id}/comments | jq -r '.[-3:][] | .createdAt + " " + (.body[0:80])'
EOF
    exit 75
    ;;
  *)
    printf 'FAILED http=%s %s %s\n%s\n' "$PC_CODE" "$method" "$path" "$resp" >&2
    exit 1
    ;;
esac
