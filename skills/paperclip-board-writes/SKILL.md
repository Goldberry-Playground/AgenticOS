---
name: paperclip-board-writes
description: >-
  How to write the Paperclip board graph safely: first-class blocker edges
  (`blockedByIssueIds`) and issues created pre-assigned to another agent. Read
  this BEFORE any PATCH that touches `blockedByIssueIds` and before any
  `POST /issues` that sets `assigneeAgentId` to someone other than yourself.
  Both routes have traps where the API returns 200 and destroys or strands
  board state. Companion to the bundled `paperclip` skill (which is read-only
  and does not cover these traps).
---

# Paperclip board writes — blocker edges and pre-assigned creates

Two Paperclip write paths look like they do not exist, or look like they
worked, when neither is true. Both have burned real tickets here:

- **GOL-2978** became an entire ticket on the false premise that *"there is no
  API route for an agent to create a blocker edge."* The route exists. Two
  separate agents reached the same wrong conclusion independently.
- **GOL-3019 / GOL-2978** both hit `403` trying to `PATCH` an issue they had
  just created, because the create pre-assigned it to another agent.

Everything below was re-verified empirically against the live control plane on
**2026-10-05** (on `GOL-3023`, whose blocker set was empty, then restored).

---

## 1. First-class blockers

### The key names differ between write and read

| Direction | Key | Shape | Where |
| --- | --- | --- | --- |
| **write** | `blockedByIssueIds` | `string[]` of **issue UUIDs** | `POST /api/companies/:companyId/issues`, `PATCH /api/issues/:idOrIdentifier` |
| **read** | `blockedBy` | array of **objects** `{id, identifier, title, status, priority, assigneeAgentId, assigneeUserId}` | `GET /api/issues/:idOrIdentifier` |
| **read** | `blocks` | same object shape, **reverse** edge | `GET /api/issues/:idOrIdentifier` |

```bash
# write
PATCH /api/issues/GOL-3023   {"blockedByIssueIds": ["3e38ced3-...","c647a272-..."]}
# read
GET   /api/issues/GOL-3023   -> "blockedBy": [ {id, identifier, status, ...} ], "blocks": [ ... ]
```

### Trap 1 — a successful write looks like a no-op

`blockedByIssueIds` is **write-only**. It is not merely `null` on a `GET` — the
key is **absent from the response object entirely**, even when the edge is
live. If you write it and then `GET` looking for the key you sent, you will
conclude the write was dropped and go hunting for a route that does not exist.
That is exactly how GOL-2978 happened.

**Confirm the write under the read key, not the write key.** The `PATCH`
response body *does* echo the resulting set — as `blockedBy`:

```bash
PATCH /api/issues/GOL-3023 {"blockedByIssueIds":["3e38ced3-..."]}
# -> 200, body contains:  "blockedBy": [ { "identifier": "GOL-2977", "status": "done", ... } ]
# -> body does NOT contain "blockedByIssueIds"
```

### Trap 2 — it is a FULL-SET REPLACE, not an append ⚠️

This is the one that actually destroys board state. Sending one new UUID
**deletes every blocker already on the issue** and returns `200` with no
warning. Because the read key has a different name *and* a different shape
(objects, not ids), the naive "add a blocker" call silently drops the others.

Verified, on an issue with one existing blocker:

```
PATCH {"blockedByIssueIds": ["<GOL-2977 uuid>"]}  -> 200, blockedBy = [GOL-2977]
PATCH {"blockedByIssueIds": ["<GOL-2971 uuid>"]}  -> 200, blockedBy = [GOL-2971]   # GOL-2977 GONE
```

**Always read-union-write.** Never PATCH a bare single-element array unless you
intend that to be the issue's complete blocker set.

```bash
# add BLOCKER_UUID to ISSUE without losing existing edges
CUR=$(curl -sS "$API/api/issues/$ISSUE" -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      | python3 -c 'import sys,json;print(json.dumps([b["id"] for b in json.load(sys.stdin)["blockedBy"]]))')
PAYLOAD=$(python3 -c "
import json
cur=json.loads('''$CUR''')
if '$BLOCKER_UUID' not in cur: cur.append('$BLOCKER_UUID')
print(json.dumps({'blockedByIssueIds': cur}))")
curl -sS -X PATCH "$API/api/issues/$ISSUE" -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     -H 'Content-Type: application/json' -d "$PAYLOAD"
```

Or use `scripts/set_blockers.py` in this skill, which does the read-union-write
for you and refuses to shrink a blocker set unless you pass `--replace`.

Clearing is legitimate and explicit: `{"blockedByIssueIds": []}` drops all
blocker edges on that issue.

### Trap 3 — UUIDs only (this one is safe)

Identifiers are rejected by schema validation **before any write**, so this
form cannot corrupt anything:

```
PATCH {"blockedByIssueIds": ["GOL-2978"]}
-> 400 {"error":"Validation error",
        "details":[{"validation":"uuid","code":"invalid_string","path":["blockedByIssueIds",0]}]}
```

Resolve identifier → UUID first: `GET /api/issues/GOL-2978` → `.id`.
(`GET`/`PATCH` *paths* accept either form; only the array contents are
UUID-strict.)

### Trap 4 — only the blocked issue's assignee may write the edge

Authorization is on the **edge receiver** — the issue that becomes `blocked`.
You may write it as that issue's **current assignee**, or as the board.
**Having created the issue grants you nothing.**

The boundary check runs *before* field validation, so even a field-less probe
fails:

```
PATCH /api/issues/<someone-else's-issue>  {}
-> 403 {"error":"Issue is outside this actor's authorization boundary"}
```

If you need an edge on an issue you do not own, either put it in the **create**
payload (§2) or ask that issue's assignee / the board to write it.

Related: `PATCH assigneeAgentId` away from yourself revokes your own access to
that issue **immediately** — post any handoff comment *before* reassigning.

### Trap 5 — the discovery route is under `diagnostics/`

There is no bare blocker route. Probing for one returns nothing and reinforces
the "no route exists" conclusion:

```
GET /api/issues/:id/blockers       -> 404 {"error":"API route not found"}
GET /api/issues/:id/relations      -> 404
GET /api/issues/:id/dependencies   -> 404
GET /api/issues/:id/diagnostics/blockers -> 200   ✅
```

`GET /api/issues/:issueId/diagnostics/blockers` is the read-only diagnostic for
a stuck issue. Read its `diagnosis` string first; it also returns
`readiness.allBlockersDone`, `readiness.unresolvedBlockerCount`, and bounded
per-blocker rows with anomaly flags. Use it when an issue still looks blocked
after its blockers went `done` (a stale hold).

### Direction and wake semantics

- `blockedByIssueIds` on **X** means *"X waits for these."* To make X **block**
  Y, you PATCH **Y** — which means you must own Y (Trap 4).
- `parentId` is structural only; it creates **no** blocker relationship.
- `issue_blockers_resolved` wakes the blocked assignee only when **every**
  blocker reaches `done`. A blocker moved to `cancelled` leaves a **stale
  hold** — clear the edge or re-triage by hand.

---

## 2. Creating an issue pre-assigned to another agent

**Put every field you need — `status`, `priority`, `blockedByIssueIds`,
`parentId` — in the `POST /issues` create payload.** The create is your only
write. The instant the issue exists assigned to another agent it is outside
your authorization boundary, and a follow-up `PATCH` returns:

```
403 {"error":"Issue is outside this actor's authorization boundary"}
```

This bit GOL-2978 and GOL-3019: both created a delegated child, then tried to
`PATCH` it to `blocked` (or to attach a blocker edge) and were locked out of
their own ticket.

```bash
POST /api/companies/:companyId/issues
{
  "title": "...",
  "description": "...",
  "assigneeAgentId": "<other-agent-uuid>",
  "parentId": "<parent-uuid>",
  "status": "todo",                              # ← set it HERE, not in a later PATCH
  "priority": "low",
  "blockedByIssueIds": ["<uuid>"]                 # ← and here, not in a later PATCH
}
```

Only the **blocked** issue's assignee can write its blocker edge, so the usual
delegation shape is:

1. `POST` the child pre-assigned, with its `status` and any `blockedByIssueIds`
   inline.
2. `PATCH` **your own** issue to add the child as *your* blocker
   (read-union-write) — you own that side, so this is always allowed.

---

## 3. Never blind-retry a create or a comment

Paperclip write endpoints routinely **time out to the client while the row
still commits** (the control-plane box is small; a create can commit seconds
after the socket returns `000`/5xx). A blind retry POSTs a duplicate, and every
duplicate issue spawns a fresh agent run — a self-amplifying capacity drain
that has produced 20+ duplicate clusters here.

**Verify, then retry.** Read the DB or re-`GET` and match on
`(company, title, parent, assignee)` — or a unique marker you embedded in the
comment body — before ever re-POSTing.
