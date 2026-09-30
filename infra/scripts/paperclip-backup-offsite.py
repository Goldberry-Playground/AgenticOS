#!/usr/bin/env python3
"""Ship completed Paperclip DB dumps off-box to DigitalOcean Spaces (GOL-2769).

WHY THIS EXISTS
---------------
Every retained Paperclip dump lives in exactly ONE place: inside the
``agenticos_paperclip-data`` docker volume on the agenticos droplet, at
``<volume>/instances/*/data/backups/paperclip-*.sql.gz``. They are not in
``/opt/backups`` and therefore not in the Syncthing path either, so the
Syncthing off-site leg that covers ``pg-backup``/``viking-backup`` does not
cover these at all. A volume loss, a bad ``docker compose down -v``, or a
droplet loss takes every restore point of the board with it. That is the gap
``docs/runbooks/backup-and-recovery.md`` §D calls "the priority gap"; this
script closes it.

WHAT IT DOES
------------
On every run (systemd timer, every 30 min) it walks the backups directory and,
for each *completed* dump not already off-box, uploads it to the
``agenticos-backups`` Spaces bucket under a tiered prefix. Off-box retention is
enforced by bucket lifecycle rules (see ``infra/terraform/backup-bucket/``), NOT
by this script -- nothing here ever deletes anything, locally or remotely.

  paperclip/daily/<name>                every completed dump      (expire 7d)
  paperclip/weekly/<ISOYEAR>W<WW>/<n>   first dump of an ISO week (expire 60d)
  paperclip/monthly/<YYYY-MM>/<name>    first dump of a month     (expire 400d)

The monthly tier is deliberately far longer than the local window (the server's
GFS ``monthlyMonths`` is 1) so at least one monthly restore point outlives
anything the droplet still holds.

INTEGRITY GATE -- the whole point of an off-box copy is that it restores
-----------------------------------------------------------------------
A dump is uploaded ONLY if it passes both halves of a single decompression pass:

  1. ``gzip -dc`` exits 0  -> the gzip CRC is intact, the stream is complete.
  2. the decompressed tail ends in ``COMMIT;`` -> pg_dump finished. A dump that
     died mid-``COPY`` (the class that leaves 1.4 GB orphans on the volume,
     GOL-1632) ends mid-statement and is rejected.

Bare ``*.sql`` files are never considered at all: a dump that has not reached
the gzip step is by definition still being written.

IDEMPOTENCY -- safe to run twice, safe to run every 30 minutes
--------------------------------------------------------------
Upload state is the BUCKET, never a local marker file: each object is HEADed
first and skipped when it is already present with the same byte length. A local
marker would lie after a droplet rebuild (the exact scenario this job exists
for). Tier membership is likewise resolved by listing the bucket, so a week or
month already covered is never uploaded twice.

CREDENTIALS -- least privilege
------------------------------
``SPACES_BACKUP_ACCESS_KEY_ID`` / ``SPACES_BACKUP_SECRET_KEY`` are read from
``/opt/agenticos/.env`` (same channel as ``DISCORD_OPS_WEBHOOK_URL``), or from
the process environment, which wins. The key is a DO **bucket-scoped**
``readwrite`` key that can touch ``agenticos-backups`` and nothing else -- not
``agenticos-tfstate``, not any Grove bucket. See the GOL-2769 credential
decision.

FAILURE IS LOUD
---------------
Any upload failure, credential problem, or integrity rejection pages the same
Discord ops webhook as the GOL-1632 backup-failure alert, throttled per reason
(``REPAGE_MIN``, default 360m) exactly like ``paperclip-volume-guard.sh`` so a
sustained fault re-pages every ~6h rather than every run. Exit status is
non-zero on failure so systemd records it too.

MODES
-----
  (default)          upload every eligible dump
  --dry-run          decide and log, upload nothing
  --verify-restore   download the newest off-box object to a scratch dir and
                     prove it restores: gzip CRC + trailing ``COMMIT;`` +
                     a statement-level parse (the plain-SQL equivalent of
                     ``pg_restore --list``). Used for the quarterly drill.

No external dependencies: Python 3 standard library only (the droplet has no
boto3 and this must not acquire one).
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

# --- configuration (every value overridable from the environment) -----------

BUCKET = os.environ.get("SPACES_BACKUP_BUCKET", "agenticos-backups")
REGION = os.environ.get("SPACES_BACKUP_REGION", "nyc3")
ENDPOINT = os.environ.get(
    "SPACES_BACKUP_ENDPOINT", f"https://{BUCKET}.{REGION}.digitaloceanspaces.com"
)
PREFIX = os.environ.get("SPACES_BACKUP_PREFIX", "paperclip").strip("/")
ENV_FILE = os.environ.get("ENV_FILE", "/opt/agenticos/.env")
VOLUME = os.environ.get("PAPERCLIP_VOLUME", "paperclip-data")
STAMP_DIR = os.environ.get("STAMP_DIR", "/run/agenticos/backup-offsite")
REPAGE_MIN = int(os.environ.get("REPAGE_MIN", "360"))
HTTP_TIMEOUT = int(os.environ.get("HTTP_TIMEOUT", "300"))
# Cap the work a single run will do so a cold start (or a long outage) uploads
# steadily instead of saturating the droplet's uplink for an hour.
MAX_UPLOADS = int(os.environ.get("MAX_UPLOADS", "4"))

DUMP_RE = re.compile(r"^paperclip-(\d{8})-(\d{6})\.sql\.gz$")

_exit_code = 0


def log(msg: str) -> None:
    stamp = dt.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
    print(f"[{stamp}] backup-offsite: {msg}", flush=True)


# --- environment / secrets ---------------------------------------------------


def load_env_file(path: str) -> dict:
    """Parse a dotenv-style file. Missing file is not an error (fresh box)."""
    out: dict = {}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def resolve_credentials(env_file_vals: dict) -> tuple:
    """Process environment wins over the .env file (lets the test harness and an
    operator override without editing a root-owned file)."""
    access = os.environ.get("SPACES_BACKUP_ACCESS_KEY_ID") or env_file_vals.get(
        "SPACES_BACKUP_ACCESS_KEY_ID", ""
    )
    secret = os.environ.get("SPACES_BACKUP_SECRET_KEY") or env_file_vals.get(
        "SPACES_BACKUP_SECRET_KEY", ""
    )
    return access.strip(), secret.strip()


# --- Discord alerting (mirrors paperclip-volume-guard.sh) --------------------


def post_discord(env_file_vals: dict, message: str) -> None:
    url = os.environ.get("DISCORD_OPS_WEBHOOK_URL") or env_file_vals.get(
        "DISCORD_OPS_WEBHOOK_URL", ""
    )
    if not url:
        log("DISCORD_OPS_WEBHOOK_URL unset — skipping webhook")
        return
    body = json.dumps({"content": message}).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req, timeout=15).read()
        log("posted to Discord ops webhook")
    except Exception as exc:  # noqa: BLE001 - alerting must never abort the job
        log(f"WARN webhook post failed: {exc}")


def alert(env_file_vals: dict, key: str, message: str) -> None:
    """Throttled per reason-key via a stamp file, same contract as the guard."""
    global _exit_code
    _exit_code = 1
    try:
        os.makedirs(STAMP_DIR, exist_ok=True)
    except OSError:
        pass
    stamp = os.path.join(STAMP_DIR, key)
    try:
        age_min = (time.time() - os.stat(stamp).st_mtime) / 60
        if age_min < REPAGE_MIN:
            log(f"alert '{key}' throttled (last {age_min:.0f}m ago) — webhook skipped")
            return
    except OSError:
        pass
    post_discord(env_file_vals, message)
    try:
        open(stamp, "w").close()
    except OSError:
        pass


# --- SigV4 -------------------------------------------------------------------


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def sigv4_headers(
    method: str,
    url: str,
    region: str,
    access_key: str,
    secret_key: str,
    payload_sha256: str,
    extra_headers: dict | None = None,
    now: dt.datetime | None = None,
) -> dict:
    """Return the headers (including Authorization) for an AWS SigV4 S3 request.

    Implements the SigV4 'Authorization header' flavour against service ``s3``.
    DigitalOcean Spaces speaks the S3 protocol, so the signature math is
    identical to AWS -- only the endpoint and region differ. Verified offline
    against the published AWS SigV4 test-suite vector in
    ``scripts/ci/paperclip-backup-offsite.test.sh``.
    """
    parsed = urllib.parse.urlsplit(url)
    host = parsed.netloc
    # The path is already percent-encoded by the caller (build_url); S3's
    # canonical URI must carry exactly the encoding that goes on the wire.
    canonical_uri = parsed.path or "/"
    # Canonical query: sorted by encoded key, each key and value RFC3986-encoded.
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    canonical_qs = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
        for k, v in sorted(pairs)
    )

    now = now or dt.datetime.now(dt.timezone.utc)
    amzdate = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_sha256,
        "x-amz-date": amzdate,
    }
    for k, v in (extra_headers or {}).items():
        headers[k.lower()] = v

    signed_names = sorted(headers)
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in signed_names)
    signed_headers = ";".join(signed_names)

    canonical_request = "\n".join(
        [
            method,
            canonical_uri,
            canonical_qs,
            canonical_headers,
            signed_headers,
            payload_sha256,
        ]
    )
    scope = f"{datestamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amzdate,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )

    k_date = _sign(("AWS4" + secret_key).encode("utf-8"), datestamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, "s3")
    k_signing = _sign(k_service, "aws4_request")
    signature = hmac.new(
        k_signing, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return headers


EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


def build_url(key: str = "", query: dict | None = None) -> str:
    """Virtual-hosted-style URL. ``/`` stays unescaped so the tier prefixes are
    real key hierarchy, matching what the lifecycle rules filter on."""
    path = "/" + urllib.parse.quote(key, safe="/")
    if query:
        return f"{ENDPOINT}{path}?" + urllib.parse.urlencode(query)
    return f"{ENDPOINT}{path}"


class SpacesError(RuntimeError):
    pass


def spaces_request(
    method: str,
    url: str,
    access_key: str,
    secret_key: str,
    payload_sha256: str = EMPTY_SHA256,
    body=None,
    extra_headers: dict | None = None,
):
    headers = sigv4_headers(
        method, url, REGION, access_key, secret_key, payload_sha256, extra_headers
    )
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        return urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read(2048).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            pass
        raise SpacesError(f"{method} {url} -> HTTP {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise SpacesError(f"{method} {url} -> {exc.reason}") from exc


def head_object(key: str, access_key: str, secret_key: str):
    """Return the object's byte length, or None when it does not exist."""
    try:
        resp = spaces_request("HEAD", build_url(key), access_key, secret_key)
    except SpacesError as exc:
        if "HTTP 404" in str(exc):
            return None
        raise
    length = resp.headers.get("Content-Length")
    return int(length) if length is not None else -1


def list_keys(prefix: str, access_key: str, secret_key: str, max_keys: int = 1000):
    """ListObjectsV2, following continuation tokens."""
    keys: list = []
    token = None
    while True:
        query = {"list-type": "2", "prefix": prefix, "max-keys": str(max_keys)}
        if token:
            query["continuation-token"] = token
        resp = spaces_request("GET", build_url("", query), access_key, secret_key)
        root = ET.fromstring(resp.read())
        ns = {"s3": root.tag.split("}")[0].strip("{")} if "}" in root.tag else {}

        def find_all(node, name):
            return node.findall(f"s3:{name}", ns) if ns else node.findall(name)

        def find_text(node, name):
            el = node.find(f"s3:{name}", ns) if ns else node.find(name)
            return el.text if el is not None else None

        for contents in find_all(root, "Contents"):
            k = find_text(contents, "Key")
            if k:
                keys.append(k)
        if (find_text(root, "IsTruncated") or "false").lower() != "true":
            break
        token = find_text(root, "NextContinuationToken")
        if not token:
            break
    return keys


def put_object(path: str, key: str, access_key: str, secret_key: str) -> None:
    size = os.path.getsize(path)
    sha = sha256_file(path)
    with open(path, "rb") as fh:
        spaces_request(
            "PUT",
            build_url(key),
            access_key,
            secret_key,
            payload_sha256=sha,
            body=fh,
            extra_headers={
                "content-length": str(size),
                "content-type": "application/gzip",
                # Private by default on this bucket, but be explicit: a backup
                # must never become world-readable through an ACL default change.
                "x-amz-acl": "private",
            },
        )


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --- dump discovery + integrity ---------------------------------------------


def resolve_mount() -> str | None:
    """PAPERCLIP_DATA_DIR wins (tests / non-docker layouts); otherwise ask
    docker, including the ``<project>_<name>`` compose namespacing."""
    mount = os.environ.get("PAPERCLIP_DATA_DIR", "").strip()
    if mount:
        return mount if os.path.isdir(mount) else None
    for name in (VOLUME,):
        try:
            out = subprocess.run(
                ["docker", "volume", "inspect", "-f", "{{ .Mountpoint }}", name],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return None
    try:
        out = subprocess.run(
            ["docker", "volume", "ls", "-q"], capture_output=True, text=True, timeout=30
        )
        for line in out.stdout.splitlines():
            if line.strip().endswith("_" + VOLUME):
                got = subprocess.run(
                    [
                        "docker",
                        "volume",
                        "inspect",
                        "-f",
                        "{{ .Mountpoint }}",
                        line.strip(),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if got.returncode == 0 and got.stdout.strip():
                    return got.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def find_dumps(mount: str) -> list:
    """Completed dumps only. ``*.sql`` partials are never candidates."""
    found = []
    for path in glob.glob(
        os.path.join(mount, "instances", "*", "data", "backups", "paperclip-*.sql.gz")
    ):
        if DUMP_RE.match(os.path.basename(path)):
            found.append(path)
    return sorted(found)


def dump_date(name: str) -> dt.date:
    """Parse the date out of the FILENAME stamp, never mtime.

    GOL-1632 trap: the dump filename stamp is written in the box's LOCAL time,
    while ``st_mtime`` reads back as UTC. Bucketing an evening dump by mtime
    folds it into the next UTC day and lands it in the wrong weekly/monthly
    tier. The filename is the authoritative clock for tiering.
    """
    m = DUMP_RE.match(name)
    if not m:
        raise ValueError(f"not a dump filename: {name}")
    return dt.datetime.strptime(m.group(1), "%Y%m%d").date()


def verify_dump(path: str) -> tuple:
    """One decompression pass proving BOTH gzip integrity and pg_dump completion.

    ``gzip -dc`` validates the CRC and length trailer as it streams; a non-zero
    exit means the file is truncated or corrupt. Keeping only the trailing bytes
    of that same stream tells us whether pg_dump reached its final ``COMMIT;``.
    Doing it in one pass matters: these dumps are ~300 MB compressed and several
    GB decompressed, and this runs every 30 minutes.
    """
    try:
        proc = subprocess.Popen(
            ["gzip", "-dc", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
    except OSError as exc:
        return False, f"cannot run gzip: {exc}"
    tail = b""
    assert proc.stdout is not None
    while True:
        chunk = proc.stdout.read(1 << 20)
        if not chunk:
            break
        tail = (tail + chunk)[-512:]
    proc.stdout.close()
    rc = proc.wait()
    if rc != 0:
        err = (proc.stderr.read() if proc.stderr else b"").decode("utf-8", "replace")
        return False, f"gzip integrity check failed (rc={rc}) {err.strip()}"
    return _check_tail(tail)


def _check_tail(tail: bytes) -> tuple:
    """Is this the tail of a dump that pg_dump/Paperclip actually FINISHED?

    A completed dump's last meaningful SQL statement is ``COMMIT;``. It is not
    necessarily the last *line*: Paperclip's dumper emits a
    ``-- paperclip statement breakpoint <uuid>`` separator after every
    statement, so a real dump ends

        COMMIT;
        -- paperclip statement breakpoint 69f6f3f1-…

    while a plain ``pg_dump`` (the /opt/backups shape) ends at ``COMMIT;``
    itself. Matching the literal last line therefore rejects every real
    Paperclip dump — which is exactly what the first live run against the
    droplet's own backups directory did, before this function looked past the
    trailing comment. Ignore trailing blank and ``--`` comment lines, then
    require the last remaining line to be ``COMMIT;``. A dump killed mid-write
    ends inside a ``COPY`` block or a data row, so it still fails.
    """
    text = tail.decode("utf-8", "replace")
    lines = [ln.strip() for ln in text.splitlines()]
    while lines and (not lines[-1] or lines[-1].startswith("--")):
        lines.pop()
    if not lines:
        return False, f"dump tail has no SQL statement (tail: {text[-120:]!r})"
    if lines[-1] != "COMMIT;":
        return False, (
            f"dump does not end in COMMIT; (last statement: {lines[-1][:80]!r})"
        )
    return True, "ok"


# --- tiering -----------------------------------------------------------------


def tier_keys(name: str) -> dict:
    """Map a dump filename to its candidate object key in each tier."""
    d = dump_date(name)
    iso_year, iso_week, _ = d.isocalendar()
    return {
        "daily": f"{PREFIX}/daily/{name}",
        "weekly": f"{PREFIX}/weekly/{iso_year}W{iso_week:02d}/{name}",
        "monthly": f"{PREFIX}/monthly/{d.strftime('%Y-%m')}/{name}",
    }


def tier_group_prefix(tier: str, name: str) -> str:
    """The prefix whose non-emptiness means 'this week/month is already covered'."""
    key = tier_keys(name)[tier]
    return key.rsplit("/", 1)[0] + "/"


# --- main modes --------------------------------------------------------------


def run_upload(args, env_vals, access_key, secret_key) -> None:
    mount = resolve_mount()
    if not mount:
        log(
            "cannot resolve paperclip-data mountpoint "
            f"(volume={VOLUME}, PAPERCLIP_DATA_DIR={os.environ.get('PAPERCLIP_DATA_DIR', 'unset')})"
            " — nothing to ship"
        )
        return
    log(f"paperclip-data mountpoint: {mount}")

    dumps = find_dumps(mount)
    if not dumps:
        log("no completed dumps found — nothing to ship (fresh box?)")
        return
    log(f"{len(dumps)} completed dump(s) on the volume")

    # Newest first: if a run is cut short by MAX_UPLOADS, the most recent
    # restore point is the one that made it off-box.
    dumps.sort(key=lambda p: os.path.basename(p), reverse=True)

    # One listing per tier per run; membership questions are answered from it
    # instead of a HEAD per candidate.
    covered: dict = {}
    for tier in ("weekly", "monthly"):
        covered[tier] = set(
            k.rsplit("/", 1)[0] + "/"
            for k in list_keys(f"{PREFIX}/{tier}/", access_key, secret_key)
        )
    log(
        f"off-box coverage: {len(covered['weekly'])} week(s), "
        f"{len(covered['monthly'])} month(s)"
    )

    uploaded = 0
    for path in dumps:
        if uploaded >= MAX_UPLOADS:
            log(f"MAX_UPLOADS={MAX_UPLOADS} reached — remaining dumps ship next run")
            break
        name = os.path.basename(path)
        keys = tier_keys(name)
        size = os.path.getsize(path)

        wanted = []
        if head_object(keys["daily"], access_key, secret_key) != size:
            wanted.append("daily")
        for tier in ("weekly", "monthly"):
            group = tier_group_prefix(tier, name)
            if group not in covered[tier]:
                wanted.append(tier)

        if not wanted:
            log(f"{name}: already off-box in every tier — skip")
            continue

        ok, reason = verify_dump(path)
        if not ok:
            # Not an alert on its own: a dump can legitimately be mid-write when
            # the timer fires. It becomes an alert only once it is older than the
            # backup cadence, which the volume guard already pages on. Log loudly.
            log(f"{name}: REJECTED, not shippable — {reason}")
            continue

        if args.dry_run:
            log(f"{name}: DRY-RUN would upload to {', '.join(wanted)} ({size} bytes)")
            uploaded += 1
            continue

        for tier in wanted:
            key = keys[tier]
            log(f"{name}: uploading -> s3://{BUCKET}/{key} ({size} bytes)")
            put_object(path, key, access_key, secret_key)
            confirmed = head_object(key, access_key, secret_key)
            if confirmed != size:
                raise SpacesError(
                    f"post-upload HEAD mismatch for {key}: {confirmed} != {size}"
                )
            if tier in covered:
                covered[tier].add(tier_group_prefix(tier, name))
            log(f"{name}: confirmed off-box at {key}")
        uploaded += 1

    log(f"done — {uploaded} dump(s) shipped this run")


def run_verify_restore(args, env_vals, access_key, secret_key) -> int:
    """Download the newest off-box object and prove it is restorable.

    Plain-SQL dumps have no ``pg_restore --list``, so the equivalent proof is a
    statement-level parse of the decompressed stream: it must decompress with an
    intact CRC, contain real schema/data statements, and terminate in ``COMMIT;``.
    """
    keys = list_keys(f"{PREFIX}/daily/", access_key, secret_key)
    if not keys:
        log(f"no objects under {PREFIX}/daily/ — nothing to verify")
        return 1
    newest = sorted(keys)[-1]
    scratch = args.scratch_dir or tempfile.mkdtemp(prefix="paperclip-restore-")
    os.makedirs(scratch, exist_ok=True)
    local = os.path.join(scratch, os.path.basename(newest))
    log(f"downloading s3://{BUCKET}/{newest} -> {local}")
    resp = spaces_request("GET", build_url(newest), access_key, secret_key)
    with open(local, "wb") as out:
        shutil.copyfileobj(resp, out, 1 << 20)
    size = os.path.getsize(local)
    log(f"downloaded {size} bytes")

    ok, reason = verify_dump(local)
    if not ok:
        log(f"RESTORE PROOF FAILED: {reason}")
        return 1

    counts = {"CREATE TABLE": 0, "COPY ": 0, "CREATE INDEX": 0, "ALTER TABLE": 0}
    proc = subprocess.Popen(["gzip", "-dc", local], stdout=subprocess.PIPE)
    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.decode("utf-8", "replace")
        for stmt in counts:
            if line.startswith(stmt):
                counts[stmt] += 1
    proc.stdout.close()
    proc.wait()
    log(
        "restore parse: "
        + ", ".join(f"{k.strip()}={v}" for k, v in counts.items())
        + f"; trailing COMMIT; present; gzip CRC ok ({size} bytes compressed)"
    )
    if counts["CREATE TABLE"] == 0 or counts["COPY "] == 0:
        log("RESTORE PROOF FAILED: no CREATE TABLE / COPY statements in the dump")
        return 1
    log(f"RESTORE PROOF OK for {newest}")
    if not args.keep:
        os.remove(local)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--dry-run", action="store_true", help="decide and log, upload nothing"
    )
    parser.add_argument(
        "--verify-restore",
        action="store_true",
        help="download the newest off-box dump and prove it restores",
    )
    parser.add_argument("--scratch-dir", help="where --verify-restore downloads to")
    parser.add_argument(
        "--keep", action="store_true", help="keep the --verify-restore download"
    )
    args = parser.parse_args()

    env_vals = load_env_file(ENV_FILE)
    access_key, secret_key = resolve_credentials(env_vals)
    if not access_key or not secret_key:
        # Fail loudly. A silently credential-less backup shipper is precisely the
        # "it looked fine for months" failure this job exists to prevent.
        alert(
            env_vals,
            "offsite-credentials",
            ":rotating_light: **agenticos-droplet** Paperclip off-box backup is NOT running: "
            f"`SPACES_BACKUP_ACCESS_KEY_ID`/`SPACES_BACKUP_SECRET_KEY` missing from `{ENV_FILE}` "
            "and the environment. Every DB dump is single-copy on this droplet until this is "
            "fixed (GOL-2769).",
        )
        log(f"ERROR: Spaces credentials not found in {ENV_FILE} or environment")
        return 2

    try:
        if args.verify_restore:
            return run_verify_restore(args, env_vals, access_key, secret_key)
        run_upload(args, env_vals, access_key, secret_key)
    except SpacesError as exc:
        alert(
            env_vals,
            "offsite-upload",
            ":rotating_light: **agenticos-droplet** Paperclip off-box backup upload FAILED — "
            f"`{exc}`. DB dumps are single-copy on this droplet until this clears (GOL-2769).",
        )
        log(f"ERROR: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001
        alert(
            env_vals,
            "offsite-unexpected",
            ":rotating_light: **agenticos-droplet** Paperclip off-box backup hit an unexpected "
            f"error — `{type(exc).__name__}: {exc}` (GOL-2769).",
        )
        log(f"ERROR unexpected: {type(exc).__name__}: {exc}")
        return 1
    return _exit_code


if __name__ == "__main__":
    sys.exit(main())
