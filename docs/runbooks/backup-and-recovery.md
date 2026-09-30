# Backup & Disaster Recovery — the AgenticOS "brain"

**Audience:** operator (Josh) + future agents. This is the durability plan for
the farm/business brain. It treats all three persistent stores as **primary**,
not "rebuildable in theory."

## The three stores

AgenticOS keeps state in three independent places. Losing any one degrades the
brain; the recovery story differs for each.

| Store | What it holds | Lives in | Backed up by | Faithfully rebuildable? |
|-------|---------------|----------|--------------|--------------------------|
| **Vault** | Human knowledge — Obsidian markdown (`wiki/`, `+inbox/`, `+sources/`) | `/opt/vault` | Syncthing → Mac (replica) | It *is* the source of truth |
| **Postgres** (`agenticos-db`) | Cost ledger, task/session ledger, `vault_ingest_state` dedup hashes | `agenticos-db-data` volume | `pg-backup.sh` → `/opt/backups` daily | No — only copy of cost/run history |
| **OpenViking** (`openviking-data`) | Agent memory: embeddings + LLM-extracted memories, sessions, relation graph | `openviking-data` volume | `viking-backup.sh` → `/opt/backups` daily | **No — see below** |
| **Paperclip** (`paperclip-data`) | The board — every issue, comment, document, run | `paperclip-data` volume | Paperclip server, ~4-hourly, → off-box to Spaces by `paperclip-backup-offsite.py` | No — only copy of the board's history |

### Why OpenViking is NOT just a rebuildable cache

It is tempting to treat `openviking-data` as disposable because `vault-ingest.sh`
flows the vault into OpenViking hourly. That reasoning fails for a business brain:

1. **Extraction is non-deterministic.** `ov.conf` sets `memory.extraction_enabled: true`
   — OpenViking runs extraction over ingested content. A re-ingest yields *a*
   memory set, not *the* one you had.
2. **Not everything is vault-sourced.** Memories an agent writes directly via the
   API, plus session state and the relation graph, never exist as vault markdown.
   On volume loss they are gone — pure primary data.
3. **Rebuild ≠ availability.** Even a "faithful" re-ingest costs hours of local
   re-embedding (Ollama), during which a 24/7 brain runs degraded.

Embeddings themselves are deterministic (`nomic-embed-text`, fixed model), so a
restore can recompute vectors — but the *memories* and *graph* cannot be
reconstructed exactly. **Back it up.**

## Target posture — 3-2-1 on a $0 envelope

3 copies, 2 media, 1 off-site — achievable with DO + the Mac only (no paid
services):

1. **Live volumes** on the Droplet (copy 1).
2. **`/opt/backups`** on the Droplet — `pg-backup` + (pending) `viking-backup`
   dumps (copy 2, same box).
3. **Off-box** — two legs, one per artifact class (see §D):
   `/opt/backups` → the Mac via Syncthing, and the Paperclip DB dumps → the
   `agenticos-backups` Spaces bucket. The Paperclip leg was the long-standing
   gap: those dumps live inside the `paperclip-data` docker volume, never in
   `/opt/backups`, so Syncthing never saw them and every restore point of the
   board was single-copy on one droplet (GOL-2769).

> **Replication is not backup.** Syncthing propagates a bad delete or corruption
> to the Mac just as faithfully as a good change. Pair it with **file
> versioning** (below) so there is a point-in-time undo.

## Procedures

### A. Postgres — automated ✅

- **Backup:** `infra/scripts/pg-backup.sh` (systemd `agenticos-pg-backup.timer`,
  daily 04:00) → `/opt/backups/agenticos-<UTC>.sql.gz`, newest 14 kept.
- **Restore:**

  ```bash
  gunzip < agenticos-<UTC>.sql.gz | \
    ssh deploy@$DROPLET 'docker compose -f /opt/agenticos/docker-compose.yml \
      exec -T agenticos-db psql -U agenticos agenticos'
  ```

### B. OpenViking — pack API ⚠️ (automation pending one live check)

OpenViking ships a native, app-consistent snapshot API:

- `POST /api/v1/pack/backup` — body `{"include_vectors": true}` for a
  self-contained pack (restore without re-embedding). Bearer auth +
  `X-OpenViking-Account: agenticos`.
- `POST /api/v1/pack/restore` — body `{"temp_file_id": "...", "on_conflict":
  "overwrite", "vector_mode": "auto"}`.

**Verified contract** (probed against the live v0.3.19 server, 2026-06-04):
`POST /api/v1/pack/backup` returns **HTTP 200 with the pack streamed directly as
the response body** — a ZIP (`.ovpack`) containing `files/{resources,user,agent,
session}/…` + `_ovpack/manifest.json` + `index_records.jsonl`. There is no
`temp_file_id` or server-side path to chase: you save the body with `curl -o`.
Auth = `Authorization: Bearer <root_api_key from ov.conf>` plus the
`X-OpenViking-{Account,User,Agent}` tenant headers.

Use **`include_vectors: false`**: the `true` mode 400s
(`Cannot export incomplete OpenViking vector index snapshot`) whenever any
record is still pending embedding — too brittle for an unattended job — and
vectors recompute deterministically on restore (`nomic-embed-text`), so nothing
is lost. The pack is smaller without them.

**Backup:** automated by `infra/scripts/viking-backup.sh` (systemd
`agenticos-viking-backup.timer`, daily 04:30) →
`/opt/backups/openviking-<UTC>.ovpack`, newest 14 kept. Integrity gates: HTTP
200 (`curl -f`), min-size, ZIP magic `PK`, and `unzip -t` CRC check when
available — so a refusal or truncated stream never overwrites or rotates away a
good pack.

**Restore** (two-step — upload the pack, then restore it):

```bash
# 1. temp_upload the .ovpack → returns a temp_file_id
FID=$(curl -fsS -X POST http://10.116.16.2:1933/api/v1/resources/temp_upload \
  -H "Authorization: Bearer $KEY" -H "X-OpenViking-Account: agenticos" \
  -F file=@openviking-<UTC>.ovpack | jq -r '.result.temp_file_id')
# 2. restore (recompute vectors, overwrite on conflict)
curl -fsS -X POST http://10.116.16.2:1933/api/v1/pack/restore \
  -H "Authorization: Bearer $KEY" -H "X-OpenViking-Account: agenticos" \
  -H "Content-Type: application/json" \
  -d "{\"temp_file_id\": \"$FID\", \"on_conflict\": \"overwrite\", \"vector_mode\": \"recompute\"}"
```

> Confirm the exact `temp_upload` field name + response path against the live
> server on first real restore (drill it — see below); the two-step shape is
> from the OpenAPI but the upload field was not probed.

### C. Vault — Syncthing + versioning

- **Backup:** already replicated Mac ↔ Droplet via Syncthing.
- **Harden:** enable **Staggered File Versioning** on the vault folder in the
  Syncthing GUI (Droplet GUI is on `tailscale0:8384`) so deletes/overwrites are
  recoverable — replication alone is not. *(Operator step — interactive.)*

### D. Off-box copies — what is covered, and how

There are **two** independent off-box stories here, because there are two
different places dumps land. Getting them confused is how the Paperclip dumps
went uncovered for months.

| Artifact | Lives in | Off-box mechanism |
|---|---|---|
| `agenticos-*.sql.gz` (cost/task ledger), `openviking-*.ovpack` | `/opt/backups` | **Syncthing → Mac** (see D1) |
| `paperclip-*.sql.gz` (**the board: every issue, comment, run**) | inside the `agenticos_paperclip-data` docker volume, at `<volume>/instances/*/data/backups/` | **DO Spaces `agenticos-backups`** (see D2) |

The Paperclip dumps are **not** in `/opt/backups`, so they were never in the
Syncthing path either. That was the priority gap; D2 closes it.

#### D1. `/opt/backups` → the Mac, via Syncthing

Add `/opt/backups` as a Syncthing folder shared to the Mac (send-only from the
Droplet is fine). Every `pg-backup` / `viking-backup` artifact then lands on the
Mac automatically — the off-site leg of 3-2-1, at $0.

*Operator step:* in the Droplet Syncthing GUI (`tailscale0:8384`), **Add
Folder** → path `/opt/backups`, share with the Mac device; accept on the Mac.
(Folder-add is interactive; the classifier blocks agent-driven Syncthing
reconfig.)

> **Replication is not backup.** Syncthing propagates a bad delete or corruption
> to the Mac just as faithfully as a good change. Pair it with **Staggered File
> Versioning** (§C) so there is a point-in-time undo.

#### D2. Paperclip DB dumps → DO Spaces `agenticos-backups` (GOL-2769)

**Where the copies live**

```
s3://agenticos-backups/            region nyc3, private, no CDN
  paperclip/daily/<dump>              every completed dump      expire   7d
  paperclip/weekly/<ISOYEAR>W<WW>/    first dump of each week   expire  60d
  paperclip/monthly/<YYYY-MM>/        first dump of each month  expire 400d
```

Endpoint: `https://agenticos-backups.nyc3.digitaloceanspaces.com`.

Retention off-box is enforced **only** by the bucket's lifecycle rules. The
shipper never issues a DELETE — of a local dump or a remote object. It also
never touches local retention, which remains the Paperclip server's job
(`instance_settings.general.backupRetention`, currently `{dailyDays:3,
weeklyWeeks:4, monthlyMonths:1}`). The monthly tier is deliberately ~13× the
local monthly window so at least one monthly restore point always outlives
anything the droplet still holds.

**What ships, and what does not**

`infra/scripts/paperclip-backup-offsite.py`, systemd timer
`agenticos-paperclip-backup-offsite.timer`, every 30 minutes. A dump is
uploaded only if **both** halves of one decompression pass succeed:

1. `gzip -dc` exits 0 — the gzip CRC and length trailer are intact.
2. the last **statement** in the decompressed stream is `COMMIT;`.

Note "statement", not "line": Paperclip's dumper appends a
`-- paperclip statement breakpoint <uuid>` separator after every statement, so a
finished dump's last *line* is a comment. Matching the last line literally
rejects 100% of real dumps — which is exactly what the first live run did before
the gate learned to look past trailing comments.

Bare `*.sql` files are never candidates at all: a dump that has not reached the
gzip step is still being written (these are the multi-GB orphans from GOL-1632).

**Idempotency.** Upload state is the bucket, never a local marker file — a
marker would lie after a droplet rebuild, which is the exact scenario this job
exists for. Each object is HEADed before upload and skipped when already present
at the same byte length; week/month coverage is resolved with one
`ListObjectsV2` per tier per run. Re-running is free.

**Alerting.** Any upload failure, missing credential, or unexpected error pages
`DISCORD_OPS_WEBHOOK_URL` — the same channel as the GOL-1632 backup-failure
alert — throttled per reason (`REPAGE_MIN`, default 360m), and exits non-zero so
systemd records it. A credential-less shipper pages rather than sitting quietly
doing nothing.

**Credentials.** `/opt/agenticos/.env`:

```
SPACES_BACKUP_ACCESS_KEY_ID=DO00…
SPACES_BACKUP_SECRET_KEY=…
```

> **These must be the literal keys, not `op://` references.** `/opt/agenticos/.env`
> is read raw — by the shipper, and by `docker compose --env-file`. Nothing runs
> `op inject` over it. A line like
> `SPACES_BACKUP_SECRET_KEY=op://Goldberry Grove - Admin/AgenticOS Infra/backups_spaces_secret_key`
> looks provisioned and provisions nothing: the shipper would sign with the
> reference string and DigitalOcean would answer `403 SignatureDoesNotMatch`,
> which reads like a revoked key. The shipper now rejects that shape by name and
> pages Discord saying so, but the fix is to write real values. (Caught by Josh,
> 2026-09-30, on the first draft of the snippet below.)

Normally Terraform writes both lines for you — export
`TF_VAR_backups_spaces_access_key_id` / `TF_VAR_backups_spaces_secret_key` and
apply; cloud-init upserts them into `.env` on the next provision. Empty vars
leave an existing `.env` untouched, so an apply without those exports can never
de-provision a working shipper.

To set them by hand on a live droplet without the secret ever reaching a
terminal, a shell history, or a process argument list:

```bash
# On the droplet, as a user who can write /opt/agenticos/.env.
# op read prints to stdout only; the values go straight into the file.
sudo sed -i '/^SPACES_BACKUP_ACCESS_KEY_ID=/d;/^SPACES_BACKUP_SECRET_KEY=/d' /opt/agenticos/.env
{
  printf 'SPACES_BACKUP_ACCESS_KEY_ID=%s\n' \
    "$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/backups_spaces_access_key_id')"
  printf 'SPACES_BACKUP_SECRET_KEY=%s\n' \
    "$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/backups_spaces_secret_key')"
} | sudo tee -a /opt/agenticos/.env >/dev/null
sudo chmod 600 /opt/agenticos/.env

# Confirm without printing the secret: expect two lines, neither an op:// ref.
grep -c '^SPACES_BACKUP_' /opt/agenticos/.env          # -> 2
grep -c '^SPACES_BACKUP_.*op://' /opt/agenticos/.env   # -> 0
sudo systemctl start paperclip-backup-offsite.service
journalctl -u paperclip-backup-offsite.service -n 30 --no-pager
```

This is a DO **bucket-scoped** Spaces key (`agenticos-backups-rw`), `readwrite`
on `agenticos-backups` and **nothing else** — it cannot reach
`agenticos-tfstate`, `grove-tf-state`, `grove-odoo-backups`, or any Grove
bucket. That scoping is the point: this credential sits on the box with the
largest attack surface in the estate. Canonical copy in 1Password
(`Goldberry Grove - Admin` / `AgenticOS Infra` / `backups_spaces_*`); also
recoverable from Terraform state with
`terraform -chdir=infra/terraform/backup-bucket output -raw backups_spaces_secret_key`.

**The bucket and key are Terraform, not click-ops:** `infra/terraform/backup-bucket/`.

```bash
cd infra/terraform/backup-bucket
op run --env-file=.env.op -- terraform plan     # expect: no changes
```

#### Restoring from an off-box copy

```bash
# 0. Credentials (operator machine):
export AWS_ACCESS_KEY_ID="$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/backups_spaces_access_key_id')"
export AWS_SECRET_ACCESS_KEY="$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/backups_spaces_secret_key')"

# 1. Find the restore point you want.
aws --endpoint-url https://nyc3.digitaloceanspaces.com \
    s3 ls --recursive s3://agenticos-backups/paperclip/

# 2. Pull it down.
aws --endpoint-url https://nyc3.digitaloceanspaces.com \
    s3 cp s3://agenticos-backups/paperclip/monthly/2026-09/paperclip-20260930-073020.sql.gz .

# 3. Prove it before you trust it (gzip CRC + trailing COMMIT; + statement parse):
infra/scripts/paperclip-backup-offsite.py --verify-restore --scratch-dir /tmp/restore

# 4. Restore into the Paperclip database.
gunzip < paperclip-<UTC>.sql.gz | \
  ssh deploy@$DROPLET 'docker exec -i paperclip-db psql -U paperclip paperclip'
```

No `aws` CLI on hand? The shipper needs none — it signs SigV4 with the Python
standard library, so `--verify-restore` alone will fetch and validate the newest
off-box dump with no extra tooling.

> **Restoring is destructive.** Restore into a scratch database first and
> compare row counts before pointing the live server at anything.

#### Where this does NOT help

- It is a copy of the **dumps**, not of the running database. RPO is the
  server's dump cadence (~4h) plus up to 30 minutes of shipper lag.
- It does not cover `agenticos-db-data` or `openviking-data` — those are D1's
  job via `/opt/backups`.
- DO Droplet backups (`backups = true` on `agenticos_droplet`) are a separate,
  weekly, whole-image safety net. Useful for total droplet loss, far too coarse
  to be the restore point for the board.

## Restore drills — an untested backup is not a backup

Do this **once now**, then quarterly. Targets: **RPO ≤ 24h** (daily backups),
**RTO ≤ 1h** (restore + verify).

1. **Postgres:** restore the latest dump into a scratch DB; confirm row counts in
   `tasks` / `calls` and that `/api/cost/today` math looks sane.
2. **OpenViking:** once B is automated, restore a pack into a throwaway Viking
   container; confirm `GET /api/v1/stats/memories` total matches and a sample
   `POST /api/v1/search/find` returns expected hits.
3. **Vault:** confirm the Mac replica opens in Obsidian and a recent capture is
   present; test the versioning trash recovers a deleted file.

Record the date + result here:

| Date | Postgres | OpenViking | Vault | Notes |
|------|----------|------------|-------|-------|
| 2026-06-06 | ✅ restored to scratch pgvector (119 tasks, 2 calls, 2 sessions) | ✅ `unzip -t` OK; `files/user/deploy/memories/*` + manifest present | — | Drilled the **Mac off-site replica** (`~/AgenticOS-Backups`); both artifacts were the **unattended 04:00/04:30 timer runs** — so this also proved timer → dump → Syncthing off-site → restore end-to-end |
| 2026-09-30 | ✅ **off-box Spaces copy** drilled end-to-end: uploaded `paperclip-20260930-073020.sql.gz` (310,145,905 B) to all three tiers, downloaded it back from `s3://agenticos-backups/paperclip/daily/`, gzip CRC ok, trailing `COMMIT;` present, statement parse 123 CREATE TABLE / 76 COPY / 312 CREATE INDEX / 366 ALTER TABLE | — | — | GOL-2769. This is the **Paperclip** DB, a different store from the 2026-06-06 row's `agenticos` DB. Reproduce with `infra/scripts/paperclip-backup-offsite.py --verify-restore` |

## Rotating `AGENTICOS_DB_PASSWORD` on an existing Droplet

The Postgres password has **one source of truth**: 1Password
(`op://Goldberry Grove - Admin/AgenticOS Infra/agenticos_db_password`).
Terraform passes it both to App Platform (which builds the dashboard's
`AGENTICOS_DB_URL`) and into the Droplet's cloud-init, which UPSERTs it
into `/opt/agenticos/.env` on every (re-)provision so the two never
drift. **But:** the `agenticos-db` container only consults
`POSTGRES_PASSWORD` on the *first* init of its `agenticos-db-data`
volume. Rewriting `.env` alone does **not** rotate the actual role
password on an existing Droplet — newly-started containers will read
the new value from `.env` and then fail to authenticate against
Postgres, which still has the old role password baked into its volume.

To actually rotate:

1. Update the value in 1Password.
2. On the Droplet, ALTER the role to match — the canonical move:
   ```bash
   NEW_PW=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/agenticos_db_password")
   docker exec -i agenticos-db psql -U agenticos -d agenticos \
     -c "ALTER USER agenticos WITH PASSWORD '$NEW_PW';"
   ```
3. `terraform apply` (or wait for the next plan) to re-render `.env` on
   the Droplet and push the new value to App Platform's env. Restart
   the consumers (`docker compose restart`) so they pick up the new
   `.env`; redeploy the App Platform app so the dashboard picks up the
   new `AGENTICOS_DB_URL`.

The only alternative is a **volume reset** — destroy `agenticos-db-data`
and let the container re-init with the new password. That nukes all
Postgres state (cost ledger, run history, dedup hashes) and requires a
restore from `/opt/backups`. Don't do this for a routine rotation.

## Gotcha: DO "Reset root password" locks you out of SSH

If you use DigitalOcean's **Reset root password**, the account is flagged
**password-expired / must-change-on-next-login**. Until you complete the change
via the **Console**, *all* SSH logins fail — **including key-based ones** — with
`all configured authentication methods failed`. Your key still works at the
`publickey` step; PAM's *account* phase then rejects the session because the
password is expired. (Interleaved power-cycles show as `Connection refused`.)

- **It is not a broken key, a bad deploy, or lost data** — don't panic-restore a
  snapshot over it.
- **Fix:** open DO → Droplet → **Console**, log in as `root` with the temp
  password, set a new one. That clears the expired flag and SSH works again.
- `deploy` is SSH-key-only with a *locked* password (its `sudo` is `NOPASSWD`
  for `systemctl`/`ufw` only). To get general `sudo`, set its password as root:
  `passwd deploy` (don't use `passwd -e` / `chage -d 0` — that re-triggers the
  same expired-account lockout). Stash both passwords in 1Password.

## Optional: paid third failure domain

The above keeps everything on DO + Mac. For a true third site (Droplet *and* Mac
both gone), DO **weekly droplet snapshots** are a few cents/month — breaks the
strict $0 rule, so treat as an explicit business decision, not a default.
