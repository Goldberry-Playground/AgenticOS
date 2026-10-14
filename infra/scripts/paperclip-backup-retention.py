#!/usr/bin/env python3
"""Cap the on-box Paperclip DB dumps to the newest few, deleting only what is
PROVEN to exist off-box in the same run (GOL-3321, follow-up to GOL-3255).

WHY THIS EXISTS
---------------
``<paperclip-data volume>/instances/*/data/backups/paperclip-*.sql.gz`` is the
last uncapped growth path on the volume. The server's own GFS retention keeps
the file COUNT bounded (~10-13: a day of 4-hourly dumps + 3 daily + 4 weekly +
1 monthly) but every dump is a full copy of a growing database, so the
directory grows with it (2.6 GB on 2026-10-09, 3.4 GB four days later).

The droplet is not a backup location. Since GOL-2769 every completed dump is
shipped to the ``agenticos-backups`` Spaces bucket by
``paperclip-backup-offsite.py`` (every 30 min), where bucket lifecycle rules
keep daily/weekly/monthly tiers at 7d/60d/400d. Once a dump is off-box the
on-box copy only buys a fast local restore; a day of those is plenty.

WHAT IT DOES
------------
Keeps the newest ``KEEP_NEWEST`` dumps (default 6, ~24h at the 4h cadence) and
never touches anything younger than ``MIN_AGE_HOURS`` (default 24) regardless
of count. Everything older is deleted ONLY when, in this same run, an off-box
object with the same name and the same byte length was listed in any tier.

GUARD RAIL -- the off-box check fails closed
-------------------------------------------
Before anything is deleted, this run must itself observe that the shipper is
healthy and current:

  * the liveness beacon ``paperclip/_status/last-run.json`` exists, reports
    ``state=ok`` and completed within ``STATUS_MAX_AGE_MIN`` (the shipper's
    own threshold, 90 min);
  * the bucket listing succeeds;
  * every dump older than ``MIN_AGE_HOURS`` but younger than the daily tier's
    lifecycle (``DAILY_EXPIRE_DAYS``, 7) has a size-matching off-box object.
    A dump in that window with no copy means the shipper is NOT keeping up,
    which is a problem on its own, not just a reason to skip one file.

If any of that fails the run deletes NOTHING, logs exactly why, and posts to
the ops Discord webhook ONCE per state change (blocked -> ok posts an
all-clear), the GOL-3226 pattern: the state is remembered in ``STATE_FILE`` so
a fault that persists for a week pages once, not nightly.

Dumps older than the daily lifecycle are a per-file decision: they are only
off-box if they were their week's or month's representative (or the shipper
has since re-uploaded them to ``daily/``). One with no copy is simply KEPT
and reported -- it is single-copy, and this script never creates a
single-copy loss. It is never a reason to block the run.

NEVER
-----
  * deletes anything in the bucket (the only requests it makes are GET/HEAD
    and a listing -- the test journals every method to prove it);
  * touches the ``agenticos-db-data`` volume, Postgres, or any DB row;
  * deletes a ``*.sql`` partial (that is paperclip-volume-guard's job) or any
    file that is not a completed ``paperclip-<stamp>.sql.gz`` dump.

HOW IT RUNS
-----------
On the HOST, as root, from the nightly ``infra/scripts/worktree-reaper.sh``
janitor (03:40) -- dry-run first, then ``--apply``, isolated from the other
janitors so a failure here never skips them and vice versa. The host is where
the Spaces credentials live (``/opt/agenticos/.env``) and where the volume is
reachable by ``docker volume inspect``; reusing the shipper's env loading,
SigV4 and mount resolution keeps the two scripts in lockstep (same clone,
same deploy). Dry-run by default: ``--apply`` to delete.

Knobs (environment): KEEP_NEWEST, MIN_AGE_HOURS, DAILY_EXPIRE_DAYS,
STATUS_MAX_AGE_MIN, STATE_FILE, SHIPPER (path to the shipper module),
PAPERCLIP_DATA_DIR (bypass docker; tests), plus everything the shipper reads
(ENV_FILE, SPACES_BACKUP_*, DISCORD_OPS_WEBHOOK_URL).

Exit: 0 pruned or nothing to prune; 1 off-box check failed (nothing deleted);
2 configuration error.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import socket
import sys
import time
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
SHIPPER = os.environ.get("SHIPPER") or os.path.join(HERE, "paperclip-backup-offsite.py")
KEEP_NEWEST = int(os.environ.get("KEEP_NEWEST", "6"))
MIN_AGE_HOURS = float(os.environ.get("MIN_AGE_HOURS", "24"))
DAILY_EXPIRE_DAYS = float(os.environ.get("DAILY_EXPIRE_DAYS", "7"))
STATE_FILE = os.environ.get(
    "STATE_FILE", "/var/lib/agenticos/backup-retention/state"
)
HOSTNAME_SHORT = socket.gethostname().split(".")[0]


def log(msg: str) -> None:
    stamp = dt.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
    print(f"[{stamp}] backup-retention: {msg}", flush=True)


def load_shipper():
    spec = importlib.util.spec_from_file_location("paperclip_backup_offsite", SHIPPER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"shipper module not found at {SHIPPER}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def mib(n: int) -> str:
    return f"{n / 1048576:.0f}M"


# --- off-box inventory --------------------------------------------------------


def list_objects(m, access_key: str, secret_key: str) -> dict:
    """``{key: size}`` for everything under the shipper's prefix. The shipper's
    own ``list_keys`` drops sizes, and the size is the whole point here."""
    out: dict = {}
    token = None
    while True:
        query = {"list-type": "2", "prefix": m.PREFIX + "/", "max-keys": "1000"}
        if token:
            query["continuation-token"] = token
        resp = m.spaces_request("GET", m.build_url("", query), access_key, secret_key)
        root = ET.fromstring(resp.read())
        ns = {"s3": root.tag.split("}")[0].strip("{")} if "}" in root.tag else {}
        q = (lambda n: f"s3:{n}") if ns else (lambda n: n)
        for c in root.findall(q("Contents"), ns):
            key = c.findtext(q("Key"), default="", namespaces=ns)
            size = c.findtext(q("Size"), default="", namespaces=ns)
            if key and size.isdigit():
                out[key] = int(size)
        if (root.findtext(q("IsTruncated"), default="false", namespaces=ns)).lower() != "true":
            break
        token = root.findtext(q("NextContinuationToken"), default="", namespaces=ns)
        if not token:
            break
    return out


def read_beacon(m, access_key: str, secret_key: str, max_age_min: int) -> tuple:
    """(ok, reason-key, human detail). Mirrors the shipper's ``--status``."""
    try:
        resp = m.spaces_request("GET", m.build_url(m.STATUS_KEY), access_key, secret_key)
        status = json.loads(resp.read().decode("utf-8"))
    except m.SpacesError as exc:
        if "HTTP 404" in str(exc):
            return False, "beacon-missing", (
                f"s3://{m.BUCKET}/{m.STATUS_KEY} does not exist — the shipper has "
                "never completed a run against this bucket"
            )
        raise
    completed = status.get("run_completed_at")
    if not completed:
        return False, "beacon-malformed", "beacon has no run_completed_at"
    age_min = int(
        (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(completed)).total_seconds()
        // 60
    )
    if age_min > max_age_min:
        return False, "beacon-stale", (
            f"shipper's last completed run was {age_min}m ago (threshold {max_age_min}m) "
            "— its timer is not firing"
        )
    if status.get("state") != "ok":
        return False, "beacon-failed", (
            f"shipper's last run ({age_min}m ago) ended state={status.get('state')!r} "
            f"{status.get('error', '')}".strip()
        )
    return True, "ok", f"beacon ok, last run {age_min}m ago, uploaded={status.get('uploaded')}"


# --- alert on change (GOL-3226) ----------------------------------------------


def state_get() -> str:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def state_put(key: str) -> None:
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        tmp = f"{STATE_FILE}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(key + "\n")
        os.replace(tmp, STATE_FILE)
    except OSError as exc:
        # Degrades to alerting every night — loud, never silent.
        log(f"WARN could not write {STATE_FILE} ({exc}); the alert will repeat nightly")


def transition(m, env_vals: dict, apply: bool, key: str, message: str) -> None:
    """Post only when the state key changes. ``blocked:*`` -> ``ok`` posts an
    all-clear, but only if we actually alerted (an unwritten state is ``""``).
    Dry-run neither posts nor records: the wrapper runs dry-run then --apply,
    and a preview that alerted would double-post the real pass."""
    prev = state_get()
    if prev == key:
        log(f"state unchanged ({key}) — not re-posting")
        return
    if not apply:
        log(f"dry-run: state {prev or 'none'} -> {key} (not recorded, not posted)")
        return
    if key == "ok":
        if prev.startswith("blocked:"):
            m.post_discord(
                env_vals,
                f":white_check_mark: **{HOSTNAME_SHORT}** on-box Paperclip backup retention is "
                f"running again — the off-box check passed (was `{prev}`). (GOL-3321)",
            )
    else:
        m.post_discord(env_vals, message)
    state_put(key)


# --- main --------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="delete; default is dry-run")
    mode.add_argument("--dry-run", action="store_true", help="decide and log only (default)")
    args = parser.parse_args()
    apply = bool(args.apply)
    verb = "" if apply else "would "

    if KEEP_NEWEST < 1:
        log("ERROR: KEEP_NEWEST must be >= 1")
        return 2

    try:
        m = load_shipper()
    except Exception as exc:  # noqa: BLE001
        log(f"ERROR: cannot load shipper from {SHIPPER}: {exc}")
        return 2

    env_vals = m.load_env_file(m.ENV_FILE)
    access_key, secret_key = m.resolve_credentials(env_vals)
    if (
        not access_key
        or not secret_key
        or m.is_unresolved_reference(access_key)
        or m.is_unresolved_reference(secret_key)
    ):
        # The shipper pages for this already (offsite-credentials); we just
        # must not delete. Say why and stop.
        log(f"ERROR: SPACES_BACKUP_* missing or unresolved in {m.ENV_FILE}/env — nothing deleted")
        return 2

    mount = m.resolve_mount()
    if not mount:
        log(f"volume '{m.VOLUME}' not found — nothing to do")
        return 0
    dumps = m.find_dumps(mount)
    if not dumps:
        log(f"no completed dumps under {mount} — nothing to do")
        return 0

    now = time.time()
    total = sum(os.path.getsize(p) for p in dumps)
    log(f"mode={'apply' if apply else 'dry-run'} keep_newest={KEEP_NEWEST} "
        f"min_age={MIN_AGE_HOURS:g}h daily_expire={DAILY_EXPIRE_DAYS:g}d")
    log(f"{len(dumps)} dump(s) on-box, {mib(total)}, in {os.path.dirname(dumps[0])}")

    # --- off-box check: fail closed ------------------------------------------
    blocked_key = ""
    blocked_detail = ""
    objects: dict = {}
    try:
        ok, key, detail = read_beacon(m, access_key, secret_key, m.STATUS_MAX_AGE_MIN)
        log(f"beacon: {detail}")
        if not ok:
            blocked_key, blocked_detail = key, detail
        else:
            objects = list_objects(m, access_key, secret_key)
            log(f"off-box: {len(objects)} object(s) under {m.PREFIX}/")
    except Exception as exc:  # noqa: BLE001 — unreachable bucket is a block, not a crash
        blocked_key = "offbox-unreachable"
        blocked_detail = f"{type(exc).__name__}: {exc}"
        log(f"off-box check failed: {blocked_detail}")

    def verified(path: str) -> str | None:
        """The off-box key that matches name AND byte length, if any."""
        name, size = os.path.basename(path), os.path.getsize(path)
        for k in m.tier_keys(name).values():
            if objects.get(k) == size:
                return k
        return None

    # Sorted by filename stamp = chronological (the stamp is the clock, GOL-1632).
    dumps_desc = sorted(dumps, key=os.path.basename, reverse=True)
    keep_set = set(dumps_desc[:KEEP_NEWEST])
    min_age_s = MIN_AGE_HOURS * 3600
    daily_expire_s = DAILY_EXPIRE_DAYS * 86400

    if not blocked_key:
        # Any dump the shipper SHOULD have off-box but does not = shipper not
        # keeping up. Nothing is deleted on a night like that.
        missing = []
        for p in dumps:
            age = now - os.stat(p).st_mtime
            if min_age_s <= age < daily_expire_s and verified(p) is None:
                missing.append(os.path.basename(p))
        if missing:
            blocked_key = "missing-offbox"
            blocked_detail = (
                f"{len(missing)} dump(s) older than {MIN_AGE_HOURS:g}h have no size-matching "
                f"off-box object: {', '.join(missing)}"
            )

    if blocked_key:
        log(f"OFF-BOX CHECK FAILED ({blocked_key}): {blocked_detail}")
        log(f"{verb}delete 0 dump(s) — the cap does nothing until the off-box copy is proven")
        transition(
            m, env_vals, apply, f"blocked:{blocked_key}",
            f":warning: **{HOSTNAME_SHORT}** on-box Paperclip backup retention did NOT prune "
            f"(`{blocked_key}`): {blocked_detail}. The dumps stay on the volume until the "
            "off-box shipper is healthy again — check `--status` of "
            "`paperclip-backup-offsite.py` and `/var/log/agenticos/worktree-reaper.log` "
            "(GOL-3321).",
        )
        return 1

    # --- prune -------------------------------------------------------------
    deleted_n = deleted_b = 0
    kept_single = []
    for p in dumps_desc:
        name, size = os.path.basename(p), os.path.getsize(p)
        age_h = (now - os.stat(p).st_mtime) / 3600
        if p in keep_set:
            log(f"KEEP   {name} ({mib(size)}, {age_h:.1f}h) — within newest {KEEP_NEWEST}")
            continue
        if age_h * 3600 < min_age_s:
            log(f"KEEP   {name} ({mib(size)}, {age_h:.1f}h) — younger than {MIN_AGE_HOURS:g}h")
            continue
        key = verified(p)
        if key is None:
            kept_single.append(name)
            log(f"KEEP   {name} ({mib(size)}, {age_h:.1f}h) — single-copy: no size-matching "
                "off-box object (past the daily lifecycle, not a weekly/monthly representative)")
            continue
        if apply:
            try:
                os.remove(p)
            except OSError as exc:
                log(f"WARN   could not delete {name}: {exc}")
                continue
        log(f"{'DELETE' if apply else 'WOULD DELETE'} {name} ({mib(size)}, {age_h:.1f}h) — "
            f"verified off-box as {key} ({size} B)")
        deleted_n += 1
        deleted_b += size

    log(f"{verb}delete {deleted_n} dump(s), {mib(deleted_b)}; "
        f"{len(dumps) - deleted_n} remain ({mib(total - deleted_b)})"
        + (f"; {len(kept_single)} single-copy dump(s) kept" if kept_single else ""))
    transition(m, env_vals, apply, "ok", "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
