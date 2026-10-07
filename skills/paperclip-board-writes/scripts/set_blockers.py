#!/usr/bin/env python3
"""Add / remove / list first-class blocker edges on a Paperclip issue, safely.

Why this exists — three traps in the raw API (see ../SKILL.md):

  1. WRITE KEY != READ KEY. You write `blockedByIssueIds`; you read `blockedBy`
     (objects) and `blocks` (reverse). `blockedByIssueIds` is write-only and is
     absent from every GET response, so a successful write looks like a no-op
     and people conclude the route does not exist (it does).

  2. FULL-SET REPLACE, NOT APPEND. `PATCH {"blockedByIssueIds":["<one-uuid>"]}`
     DELETES every other blocker on that issue and returns 200. This tool reads
     the current set and unions into it; it refuses to shrink a set unless you
     pass --replace or --remove.

  3. UUIDS ONLY. `"GOL-2978"` is rejected 400 (`validation: uuid`) before any
     write. This tool resolves identifiers -> UUIDs for you.

Plus the authorization rule: you may only write the blocker set of the BLOCKED
issue (the edge receiver), as its current assignee or as the board. Creating the
issue grants nothing; an unauthorized PATCH is 403 "Issue is outside this
actor's authorization boundary" (the boundary check runs before field
validation, so even an empty PATCH 403s).

Usage
  # show both directions
  set_blockers.py show GOL-3023

  # add blockers WITHOUT destroying the existing set (read-union-write)
  set_blockers.py add GOL-3023 GOL-2977 GOL-2971

  # drop specific blockers
  set_blockers.py remove GOL-3023 GOL-2977

  # declare the complete set (destructive; requires the explicit verb)
  set_blockers.py replace GOL-3023 GOL-2971
  set_blockers.py replace GOL-3023            # clears all blocker edges

  # see the payload without sending it
  set_blockers.py add GOL-3023 GOL-2977 --dry-run

Env: PAPERCLIP_API_URL, PAPERCLIP_API_KEY (both injected into agent runs).
     PAPERCLIP_API_HOST_HEADER optionally overrides the Host header when
     PAPERCLIP_API_URL points at an in-cluster address.
Exit: 0 ok / 2 usage / 3 API error.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("PAPERCLIP_API_URL", "").rstrip("/")
KEY = os.environ.get("PAPERCLIP_API_KEY", "")
HOST = os.environ.get("PAPERCLIP_API_HOST_HEADER")


def _req(method, path, body=None):
    url = f"{API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Content-Type", "application/json")
    # Cloudflare in front of the control plane 403s (error 1010) on a missing UA.
    req.add_header("User-Agent", "paperclip-set-blockers/1.0")
    if HOST:
        req.add_header("Host", HOST)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except ValueError:
            return e.code, {"error": raw.decode("utf-8", "replace")[:400]}


def get_issue(ref):
    status, body = _req("GET", f"/api/issues/{ref}")
    if status != 200:
        die(3, f"GET {ref} -> {status} {body.get('error') or body}")
    return body


def die(code, msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def to_uuid(ref):
    """Identifiers are 400-rejected inside blockedByIssueIds; resolve them."""
    if len(ref) == 36 and ref.count("-") == 4:
        return ref
    return get_issue(ref)["id"]


def fmt(rows):
    return ", ".join(f"{r['identifier']}({r['status']})" for r in rows) or "(none)"


def main(argv):
    if len(argv) < 2 or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    verb, target = argv[0], argv[1]
    rest = [a for a in argv[2:] if not a.startswith("-")]
    dry = "--dry-run" in argv
    if not API or not KEY:
        die(2, "PAPERCLIP_API_URL and PAPERCLIP_API_KEY must be set")
    if verb not in ("show", "add", "remove", "replace"):
        die(2, f"unknown verb {verb!r} (show|add|remove|replace)")

    issue = get_issue(target)
    current = [b["id"] for b in issue.get("blockedBy") or []]
    print(f"{issue['identifier']} [{issue['status']}]")
    print(f"  blockedBy: {fmt(issue.get('blockedBy') or [])}")
    print(f"  blocks   : {fmt(issue.get('blocks') or [])}")
    if verb == "show":
        return 0

    args = [to_uuid(r) for r in rest]
    if verb == "add":
        new = current + [u for u in args if u not in current]
    elif verb == "remove":
        new = [u for u in current if u not in args]
    else:  # replace
        new = args
        dropped = [u for u in current if u not in new]
        if dropped:
            print(f"  ! replace drops {len(dropped)} existing blocker(s)")

    if new == current:
        print("  = no change needed")
        return 0

    payload = {"blockedByIssueIds": new}
    print(f"  -> PATCH {json.dumps(payload)}")
    if dry:
        print("  (dry-run, nothing sent)")
        return 0

    status, body = _req("PATCH", f"/api/issues/{issue['id']}", payload)
    if status == 403:
        die(3, "403 outside authorization boundary — only the BLOCKED issue's "
               "current assignee (or the board) may write its blocker set")
    if status != 200:
        die(3, f"PATCH -> {status} {body.get('error') or body} {body.get('details') or ''}")
    # The response echoes the result under the READ key, never the write key.
    print(f"  200 blockedBy now: {fmt(body.get('blockedBy') or [])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
