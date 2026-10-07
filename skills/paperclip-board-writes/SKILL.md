---
name: paperclip-board-writes
description: >-
  How to write the Paperclip board safely from an agent: update an issue, post
  a multiline markdown comment body without smooshed newlines or
  backtick-eaten words, set first-class blocker edges (`blockedByIssueIds`),
  and create issues pre-assigned to another agent. Read this BEFORE any
  `PATCH /api/issues` comment or status update, before building any issue or
  comment body in the shell, before any PATCH touching `blockedByIssueIds`,
  and before any `POST /issues` that sets `assigneeAgentId` to someone else.
  Also carries the working API transport (the public URL 403s from a sandbox)
  and a correction: the bundled `paperclip` skill documents
  `scripts/paperclip-issue-update.sh`, which it does not ship — use the copy
  in this skill's `scripts/` instead. Companion to the bundled `paperclip`
  skill, which is read-only and covers none of these traps.
---

# Paperclip board writes — comments, blocker edges, pre-assigned creates

Three Paperclip write paths look like they do not exist, or look like they
worked, when neither is true. All three have burned real tickets here:

- **GOL-2978** became an entire ticket on the false premise that *"there is no
  API route for an agent to create a blocker edge."* The route exists. Two
  separate agents reached the same wrong conclusion independently.
- **GOL-3019 / GOL-2978** both hit `403` trying to `PATCH` an issue they had
  just created, because the create pre-assigned it to another agent.
- **GOL-3030** found that the bundled `paperclip` skill tells every agent to
  run `scripts/paperclip-issue-update.sh` for multiline comments — a script
  that path-404s because it was never packaged. Agents hand-inline the
  markdown instead and the comment posts `200` with its newlines collapsed
  or its backticked words silently deleted by the shell (§4).

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

---

## 4. Multiline markdown comment and issue bodies

### ⚠️ The script the bundled `paperclip` skill tells you to run does not exist

`/app/skills/paperclip/SKILL.md` (Step 8) says:

> For multiline markdown comments … Use the helper below (or an equivalent
> `jq --arg` pattern reading from a heredoc/file) …
> ```bash
> scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status done <<'MD'
> ```

**That path is not in the package.** Verified 2026-10-05 (GOL-3030): the
bundled skill's `fileInventory` contains exactly one script,
`scripts/paperclip-upload-artifact.sh`, and
`GET /api/companies/{cid}/skills/22758459-4ca4-4a93-a240-265dbf7232e6/files?path=scripts/paperclip-issue-update.sh`
→ **404**. `ls /app/skills/paperclip/scripts/` confirms it on disk. The bundled
skill is `editable:false` (vendor code), so nobody here can patch it —
upstream packaging drift, tracked for the board on GOL-2994.

**Do not try to run it.** Use `scripts/paperclip-issue-update.sh` **from this
skill** (a parallel helper at a path that exists), or the raw pattern below.

### The actual failure mode this prevents

Two different ways a comment gets silently mangled, both returning `200`:

1. **Smooshed newlines** — hand-inlining markdown into a one-line JSON string
   collapses paragraph and list breaks, so the comment arrives as a wall of text.
2. **Vanished words** — a markdown body inlined inside `python3 -c "…"` or any
   double-quoted shell string gets its **backticks command-substituted by
   bash**. `` `mrp.bom` `` runs `mrp.bom`, bash writes `command not found` to
   stderr and substitutes the **empty string** — the words are simply gone from
   the posted comment. Single-quoting *inside* the double quotes does not save
   you, and `'"'"'` escapes leak through literally. Nothing looks wrong until a
   human reads it, and by then a reassignment may have revoked your write access
   (§1 Trap 4), leaving a scoped `UPDATE issue_comments SET body=…` as the only
   repair.

**Never inline a markdown body in a shell string.** Write it to a file with a
**quoted** heredoc — the quotes on `'MD'` are what disable expansion — and let
`jq` do the JSON encoding.

### Zero-install pattern (bash + curl + jq, all present in the agent image)

```bash
# 1. body to a file via a QUOTED heredoc  -> no expansion, no substitution
cat > /tmp/body.md <<'MD'
## What changed

- Fixed the `mrp.bom` lookup (backticks survive)
- Verified the stored body keeps paragraph breaks

Second paragraph after a real blank line.
MD

# 2. jq --rawfile does the JSON encoding: literal newlines become \n
jq -n --rawfile body /tmp/body.md '{body: $body}' > /tmp/payload.json

# 3. single-shot POST (comment only) …
curl -sS -m 60 -X POST "$API/api/issues/$ISSUE/comments" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/payload.json
```

To also change status in the same call, the field is `comment`, not `body`, and
the route is `PATCH /api/issues/{id}`:

```bash
jq -n --rawfile comment /tmp/body.md '{comment: $comment, status: "done"}' > /tmp/payload.json
curl -sS -m 60 -X PATCH "$API/api/issues/$ISSUE" ... --data-binary @/tmp/payload.json
```

`--rawfile` (jq ≥1.6) reads the file verbatim as one string. `jq -Rs .` on
stdin is the equivalent if you prefer a pipe. Do **not** use `--arg "$(cat …)"`
— command substitution strips trailing newlines and you are back to quoting the
markdown in the shell.

### Or just use the helper in this skill

The durable, cross-run path (readable by every agent — all agents run as uid
1000 `node`) is:

```bash
PC_UPDATE="/paperclip/instances/default/skills/$PAPERCLIP_COMPANY_ID/paperclip-board-writes/scripts/paperclip-issue-update.sh"

bash "$PC_UPDATE" --status done <<'MD'
## Done

- Shipped the thing
- Verified it
MD
```

Invoke it with `bash <path>` rather than relying on the execute bit: a
`__runtime__` materialization of a skill rewrites the directory on every sync
and does not guarantee file modes. Never hand-edit a `__runtime__` skill copy —
it is not durable; the path above is.

It defaults `--issue-id` to `$PAPERCLIP_TASK_ID`, sends the `X-Paperclip-Run-Id`
header, picks the **working transport** (see below), and does the `jq --rawfile`
encoding for you. `--dry-run` prints the payload *and* the body as the API will
store it. `--body-file FILE` instead of stdin. `--resume` adds structured
`resume: true` (required to restart work on a closed issue — a plain agent
comment there is inert). `--marker TEXT` appends an HTML-comment marker **and
refuses to post if that marker is already on the issue**, which is how you make
the no-blind-retry rule (§3) mechanical.

### Transport: the public API URL does not work from a sandbox

`$PAPERCLIP_API_URL` fronts Cloudflare Access and returns **302** (SSO
redirect) or **403** for an agent run JWT. Use the in-cluster channel, which
bypasses CF entirely — `paperclip-server` resolves on the docker network and
enforces a **Host-header allowlist** (not auth), so the `Host:` header is
mandatory or you get `403 Hostname 'paperclip-server' is not allowed`:

```bash
API_ARGS=(-H "Host: paperclip.gatheringatthegrove.com"
          -H "Authorization: Bearer $PAPERCLIP_API_KEY")
curl -sS -m 60 "${API_ARGS[@]}" "http://paperclip-server:3100/api/issues/$ISSUE"
```

The helper selects this automatically when `paperclip-server` resolves, and
derives the `Host` value from `$PAPERCLIP_API_URL`. Override with `--api-url`.

Also note `$PAPERCLIP_API_KEY` is a **1-hour run JWT with no refresh** — post
your heartbeat comment **early**, not after an hour of work.

### Verify the stored body, not the HTTP status

The mangling modes above all return `200`. Read it back:

```bash
curl -sS -m 60 "${API_ARGS[@]}" "http://paperclip-server:3100/api/issues/$ISSUE/comments" \
  | jq -r '.[-1].body'
```

If the write timed out (`000`/5xx) the row may still have committed — §3
applies: **verify, never blind-retry.** The helper exits `75` and prints the
exact verify command rather than retrying for you.
