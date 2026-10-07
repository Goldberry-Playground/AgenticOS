#!/usr/bin/env python3
"""AgenticOS vendor-status guard — observability for the things we do NOT run.

GOL-3021. We have decent observability of our own boxes (RUM, otel, beyla, DO
monitors, the disk/volume guards) and *zero* of our vendors. On 2026-10-05 the
`githubstatus` component `Actions` went `degraded_performance` at 19:11:58Z, 13
workflow runs queued up on grove-odoo-modules alone, jobs were cancelled without
ever getting a runner, and the auto-approve workflow was itself queued — so even
fully green agent PRs could not self-merge. Several agents each re-diagnosed it
from scratch, a heartbeat apiece, and the board heard about it third-hand.

This script is the fix. Two subcommands:

  poll   Scheduled (agenticos-vendor-status.timer, every 5 min). Reads the public
         status APIs, writes the snapshot, and posts to the Discord ops webhook
         ONLY on a transition — into degradation, out of it, or between
         degradation levels. No credentials beyond the webhook; all reads are
         unauthenticated public endpoints.

  read   Agent-facing. Answers "is this me or is this GitHub?" in one call.
         Prints the snapshot. If the snapshot is older than --max-age it
         re-polls live first (4 cheap HTTP gets, ~1s) so the answer is never a
         stale lie, with or without the timer installed. NEVER alerts.

Both are idempotent and safe to run twice; `poll` converges the state file.

WHY A HOST TIMER AND NOT A GITHUB ACTIONS SCHEDULE: the single most important
thing this watches is GitHub Actions. A poller that runs *on* GitHub Actions
stops reporting at exactly the moment it matters, and the 2026-10-05 incident is
the proof — scheduled runs were among the ones that never got a runner. So this
lives beside disk-guard.sh as a systemd timer on the Droplet, on a dependency
path that shares nothing with what it monitors.

ALERT CHANNEL. The Discord ops webhook is read from the environment
(DISCORD_OPS_WEBHOOK_URL), falling back to /opt/agenticos/.env — the same
contract disk-guard.sh and paperclip-volume-guard.sh already use. If it is
unset the script still writes the snapshot and exits 0, so a box without the
secret degrades to "no alerts" rather than to "no data".

SEE ALSO docs/runbooks/vendor-status.md for the install path, the component
allowlist rationale, and the CI incident-debris triage rule.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import socket
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone

UA = "GoldberryGrove-vendor-status-guard/1 (+https://github.com/Goldberry-Playground/AgenticOS)"

# ---------------------------------------------------------------------------
# Vendor registry
# ---------------------------------------------------------------------------
# COMPONENT ALLOWLISTS ARE LOAD-BEARING, NOT TIDINESS. Cloudflare publishes 479
# components and DigitalOcean 256. At the moment this was written Cloudflare had
# four unresolved incidents and eight degraded components — Durable Objects, R2,
# API Shield, WARP, Containers, Workers Assets, Workflows, Cloudflare One Client
# — and we use *none* of them. An "alert on any degraded component" poller would
# have paged on all eight, trained everyone to ignore it, and been worse than no
# monitoring at all. So each vendor declares only the components we actually
# depend on, by their exact upstream `name`.
#
# A name that disappears upstream is reported as `unknown` for that component
# (see `missing` handling in probe_statuspage) rather than silently dropped —
# a renamed component must fail loudly, or the allowlist rots into a no-op.
VENDORS: dict[str, dict] = {
    "github": {
        "kind": "statuspage",
        "base": "https://www.githubstatus.com",
        "label": "GitHub",
        # CI/CD, the agent push+PR path, and github-sync's webhook ingress.
        # Deliberately NOT: Copilot, Codespaces, Pages, Packages — we don't use
        # them on any revenue or deploy path.
        "components": [
            "Actions",
            "API Requests",
            "Git Operations",
            "Pull Requests",
            "Webhooks",
            "Issues",
        ],
    },
    "digitalocean": {
        "kind": "statuspage",
        "base": "https://status.digitalocean.com",
        "label": "DigitalOcean",
        # Droplets (agenticos + prod Odoo + per-PR previews), App Platform (the
        # storefronts), Spaces/Spaces CDN (grove-assets + backups), Managed
        # Databases, and the control planes we provision through.
        # NOT "DNS": our DNS is Cloudflare, so DO DNS degradation is not ours.
        "components": [
            "API",
            "Droplets",
            "App Platform",
            "Spaces",
            "Spaces CDN",
            "Managed Databases",
            "Networking",
            "Cloud Firewall",
            "Volumes",
            "Container Registry",
        ],
    },
    "cloudflare": {
        "kind": "statuspage",
        "base": "https://www.cloudflarestatus.com",
        "label": "Cloudflare",
        # The edge we actually sit behind. The regional PoP groups (North
        # America, Europe, …) are excluded on purpose: they sit at
        # major_outage/degraded for routine re-routing and are permanent noise.
        "components": [
            "API",
            "Dashboard",
            "Authoritative DNS",
            "DNS Updates",
            "CDN/Cache",
            "CDN Cache Purge",
            "Access",
            "Tunnel",
            "Zones",
            "Rules",
            "Firewall",
            "SSL Certificate Provisioning",
            "Challenge Platform",
        ],
    },
    "1password": {
        "kind": "statuspage",
        "base": "https://status.1password.com",
        "label": "1Password",
        # Every secret in CI and on the boxes comes through the service account
        # and the CLI, so a 1Password outage reads as "all deploys broken".
        # 1Password repeats the same component `name` once per region, so these
        # match several rows each; probe_statuspage takes the WORST per name.
        "components": [
            "Service Accounts",
            "Command Line Interface (CLI)",
            "1Password Connect",
            "Sign in",
        ],
    },
    "stripe": {
        "kind": "http_probe",
        "label": "Stripe",
        "status_page": "https://status.stripe.com/",
        # STRIPE HAS NO LIVE PUBLIC STATUS API — DO NOT "FIX" THIS BACK TO ONE.
        # status.stripe.com is a React shell with no /api/v2/*. The one JSON
        # endpoint that answers, https://status.stripe.com/current, is a FROZEN
        # ARTIFACT: it returns `largestatus: "up"`, "All services are online."
        # and `time: "February 09, 2024 @ 06:08PM +00:00"`, served from
        # CloudFront with `last-modified: Fri, 09 Feb 2024 18:08:57 GMT`. Wiring
        # it up would hard-code a permanent green lie about the one vendor that
        # touches money. Verified 2026-10-05.
        #
        # So Stripe gets a synthetic probe instead: unauthenticated requests to
        # live Stripe endpoints whose healthy response code is known and stable.
        # A 401 from the API means "Stripe is up and rejected me", which is
        # exactly the liveness signal we want and needs no credential.
        "probes": [
            {"name": "API", "url": "https://api.stripe.com/v1/charges", "expect": [401]},
            {"name": "Stripe.js", "url": "https://js.stripe.com/v3/", "expect": [200]},
        ],
    },
}

# Statuspage component status -> our severity class.
STATUSPAGE_CLASS = {
    "operational": "ok",
    "degraded_performance": "degraded",
    "partial_outage": "degraded",
    "major_outage": "down",
    "under_maintenance": "maintenance",
}
# Only these two classes page anyone. `maintenance` is recorded and shown but
# never alerted: planned work is not an incident, and DO/CF schedule it often.
BAD = ("degraded", "down")
# Worst-first, for collapsing several rows (or several components) into one.
SEVERITY_ORDER = ["ok", "maintenance", "unknown", "degraded", "down"]

# Appended to the snapshot when GitHub Actions is in a bad class. This is the
# classification rule that made the GOL-2988 diagnosis a two-API-call job, and
# the re-trigger lever that actually works for an agent. Encoded here so the
# next agent gets it from the same call that tells them Actions is degraded,
# instead of re-deriving it.
GITHUB_ACTIONS_HINT = (
    "Triage: a check with conclusion=cancelled, an EMPTY runner_name, and a "
    "BlobNotFound 404 on the job logs never executed a step — that is incident "
    "debris, not a test failure. started_at->completed_at exceeding the job's own "
    "timeout-minutes is the tell that the span is queue time. An agent App "
    "installation token has NO actions:write, so /actions/runs/<id>/cancel and "
    "the rerun endpoints are 403; the only re-trigger lever is close + reopen the "
    "PR, which re-fires on:pull_request (default types include reopened) on the "
    "same SHA. Do not 'fix' the code — wait for recovery, then re-trigger."
)


# Name of the synthetic component row that stands in for a status page we could
# not read at all (see probe_statuspage's error branch).
STATUS_PAGE_COMPONENT = "(status page)"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def worst(classes) -> str:
    out = "ok"
    for c in classes:
        if SEVERITY_ORDER.index(c) > SEVERITY_ORDER.index(out):
            out = c
    return out


# TEST SEAM. With VENDOR_STATUS_FIXTURES=<dir> set, both fetchers read from
# disk instead of the network: `<dir>/<url with non-alphanumerics -> _>.json`
# for http_json, and `<dir>/codes.json` ({url: int}) for http_code. This exists
# so infra/scripts/vendor-status-guard.test.sh can pin the classification and
# transition rules offline and deterministically — the alerting logic is the
# part that must not regress, and it is untestable against a live vendor whose
# real status we do not control. Never set in production; a missing fixture
# raises, so a stray setting fails loudly rather than reporting false health.
def _fixture_path(url: str) -> str:
    return os.path.join(os.environ["VENDOR_STATUS_FIXTURES"],
                        re.sub(r"[^A-Za-z0-9]+", "_", url) + ".json")


def http_json(url: str, timeout: float):
    if os.environ.get("VENDOR_STATUS_FIXTURES"):
        with open(_fixture_path(url)) as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def http_code(url: str, timeout: float) -> int:
    """Status code for an unauthenticated GET; 0 on transport failure.

    A 4xx is a perfectly good answer here (see the Stripe probe), so an
    HTTPError is a result, not an error.
    """
    if os.environ.get("VENDOR_STATUS_FIXTURES"):
        with open(os.path.join(os.environ["VENDOR_STATUS_FIXTURES"], "codes.json")) as f:
            return int(json.load(f)[url])
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode()
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, socket.timeout, OSError):
        return 0


# ---------------------------------------------------------------------------
# Probes
# ---------------------------------------------------------------------------
def probe_statuspage(key: str, cfg: dict, timeout: float) -> dict:
    base = cfg["base"].rstrip("/")
    try:
        comps = http_json(f"{base}/api/v2/components.json", timeout)["components"]
    except Exception as e:  # noqa: BLE001 - any failure here is "we can't tell"
        # Synthesize ONE component row for the page itself. Returning an empty
        # components list here looks tidier and is a silent monitoring hole: the
        # transition tracker is keyed per component, so a vendor we cannot read
        # at all would contribute no keys, never build an unknown streak, and
        # never alert — the precise blind spot this guard exists to close.
        # Caught by infra/scripts/vendor-status-guard.test.sh.
        return {
            "label": cfg["label"],
            "severity": "unknown",
            "error": f"{type(e).__name__}: {e}",
            "status_page": base,
            "components": [
                {
                    "name": STATUS_PAGE_COMPONENT,
                    "status": None,
                    "class": "unknown",
                    "since": None,
                    "note": f"status page unreadable: {type(e).__name__}: {e}",
                }
            ],
            "incidents": [],
        }

    # 1Password repeats a component `name` once per region. Collapse by name and
    # keep the WORST status across the duplicates, so a Europe-only outage still
    # surfaces instead of being overwritten by a healthy USA row.
    by_name: dict[str, dict] = {}
    for c in comps:
        name = c.get("name")
        if name not in cfg["components"]:
            continue
        cls = STATUSPAGE_CLASS.get(c.get("status", ""), "unknown")
        prev = by_name.get(name)
        if prev is None or SEVERITY_ORDER.index(cls) > SEVERITY_ORDER.index(prev["class"]):
            by_name[name] = {
                "name": name,
                "status": c.get("status"),
                "class": cls,
                "since": c.get("updated_at"),
            }

    out_components = []
    for name in cfg["components"]:
        if name in by_name:
            out_components.append(by_name[name])
        else:
            # An allowlisted name that no longer exists upstream. Fail loudly:
            # a silent drop turns the allowlist into a no-op over time.
            out_components.append(
                {
                    "name": name,
                    "status": None,
                    "class": "unknown",
                    "since": None,
                    "note": "component name not present upstream — allowlist may be stale",
                }
            )

    incidents = []
    try:
        for i in http_json(f"{base}/api/v2/incidents/unresolved.json", timeout)["incidents"]:
            touched = [c["name"] for c in i.get("components", []) if c.get("name") in cfg["components"]]
            if touched:
                incidents.append(
                    {
                        "id": i.get("id"),
                        "name": i.get("name"),
                        "impact": i.get("impact"),
                        "status": i.get("status"),
                        "created_at": i.get("created_at"),
                        "url": i.get("shortlink"),
                        "components": touched,
                    }
                )
    except Exception as e:  # noqa: BLE001 - components already answered; don't lose them
        incidents = [{"error": f"{type(e).__name__}: {e}"}]

    return {
        "label": cfg["label"],
        "severity": worst(c["class"] for c in out_components),
        "status_page": base,
        "components": out_components,
        "incidents": incidents,
    }


def probe_http(key: str, cfg: dict, timeout: float) -> dict:
    components = []
    for p in cfg["probes"]:
        code = http_code(p["url"], timeout)
        if code in p["expect"]:
            cls, status = "ok", f"HTTP {code} (expected)"
        elif code == 0:
            cls, status = "unknown", "no response (transport failure)"
        elif 500 <= code <= 599:
            cls, status = "down", f"HTTP {code}"
        else:
            # Reachable and serving, but not the contract we expect. Could be a
            # vendor change rather than an outage, so: degraded, not down.
            cls, status = "degraded", f"HTTP {code} (expected {p['expect']})"
        components.append({"name": p["name"], "status": status, "class": cls, "since": None,
                           "probe": p["url"]})
    return {
        "label": cfg["label"],
        "severity": worst(c["class"] for c in components),
        "status_page": cfg.get("status_page"),
        "components": components,
        "incidents": [],
        "note": "synthetic probe — Stripe publishes no live public status API "
                "(status.stripe.com/current is frozen at 2024-02-09)",
    }


def collect(timeout: float, vendors=None) -> dict:
    keys = vendors or list(VENDORS)
    out: dict[str, dict] = {}
    for key in keys:
        cfg = VENDORS[key]
        out[key] = probe_statuspage(key, cfg, timeout) if cfg["kind"] == "statuspage" \
            else probe_http(key, cfg, timeout)
        out[key]["checked_at"] = now_iso()
    return out


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------
def build_snapshot(vendors: dict, source: str) -> dict:
    bad = []
    for vkey, v in vendors.items():
        for c in v["components"]:
            if c["class"] in BAD:
                inc = next(
                    (i for i in v.get("incidents", []) if c["name"] in i.get("components", [])),
                    None,
                )
                bad.append(
                    {
                        "vendor": vkey,
                        "label": v["label"],
                        "component": c["name"],
                        "class": c["class"],
                        "status": c["status"],
                        "since": c.get("since"),
                        "incident": (inc or {}).get("name"),
                        "incident_url": (inc or {}).get("url"),
                        "incident_created_at": (inc or {}).get("created_at"),
                    }
                )
    bad.sort(key=lambda b: (-SEVERITY_ORDER.index(b["class"]), b["vendor"], b["component"]))

    overall = worst(v["severity"] for v in vendors.values()) if vendors else "unknown"
    if bad:
        headline = "; ".join(f"{b['label']} {b['component']} {b['class']}" for b in bad[:4])
        if len(bad) > 4:
            headline += f" (+{len(bad) - 4} more)"
    else:
        unk = [v["label"] for v in vendors.values() if v["severity"] == "unknown"]
        headline = (
            "all watched vendor components operational"
            if not unk
            else f"could not read: {', '.join(unk)} — everything else operational"
        )

    snap = {
        "schema": 1,
        "generated_at": now_iso(),
        "generated_by": f"infra/scripts/vendor-status-guard.py {source}",
        "issue": "GOL-3021",
        "overall": overall,
        "headline": headline,
        "degraded": bad,
        "vendors": vendors,
        "hints": {},
    }
    gh = vendors.get("github")
    if gh and any(c["name"] == "Actions" and c["class"] in BAD for c in gh["components"]):
        snap["hints"]["github_actions"] = GITHUB_ACTIONS_HINT
    return snap


def write_json(path: str, payload: dict) -> str | None:
    """Atomically write `payload`; return the path written, or None if we couldn't.

    `read` may run as the in-container `node` user against a snapshot the host
    timer wrote as root. Refreshing the shared cache is a nice-to-have, never a
    reason to fail the answer the caller actually asked for.
    """
    try:
        d = os.path.dirname(path) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".vendor-status.", suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f, indent=2, sort_keys=False)
            f.write("\n")
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
        return path
    except OSError:
        return None


def snapshot_age_seconds(path: str) -> float | None:
    try:
        with open(path) as f:
            gen = json.load(f).get("generated_at")
        t = datetime.strptime(gen, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds()
    except Exception:  # noqa: BLE001 - missing/corrupt/unparseable all mean "repoll"
        return None


# ---------------------------------------------------------------------------
# Transition detection (the dedupe that makes this alert on the EDGE)
# ---------------------------------------------------------------------------
def diff_transitions(prev: dict, vendors: dict, unknown_streak_alert: int) -> tuple[list, dict]:
    """Return (transitions, new_state).

    State is keyed `vendor/component` -> {class, status, since, unknown_streak}.
    We alert on three edges and nothing else:
      ok|maintenance -> degraded|down   DEGRADED
      degraded|down  -> ok|maintenance  RECOVERED
      degraded <-> down                 ESCALATED / EASED
    `unknown` never alerts on its own until it has persisted
    `unknown_streak_alert` consecutive polls — otherwise one flaky DNS lookup
    from our own box pages the channel and pins the blame on the vendor.
    A first run with no prior state alerts for anything already bad, which is
    correct: nobody has been told yet.
    """
    prev_c = prev.get("components", {}) if isinstance(prev, dict) else {}
    transitions: list[dict] = []
    new_c: dict[str, dict] = {}

    for vkey, v in vendors.items():
        for c in v["components"]:
            k = f"{vkey}/{c['name']}"
            old = prev_c.get(k, {})
            old_cls = old.get("class")
            cls = c["class"]
            streak = (old.get("unknown_streak", 0) + 1) if cls == "unknown" else 0
            new_c[k] = {
                "class": cls,
                "status": c["status"],
                "since": c.get("since"),
                "unknown_streak": streak,
                "last_seen": now_iso(),
            }

            inc = next((i for i in v.get("incidents", []) if c["name"] in i.get("components", [])), None)
            base = {
                "vendor": vkey,
                "label": v["label"],
                "component": c["name"],
                "from": old_cls,
                "to": cls,
                "status": c["status"],
                "since": c.get("since"),
                "incident": (inc or {}).get("name"),
                "incident_url": (inc or {}).get("url"),
                "status_page": v.get("status_page"),
            }

            if cls == "unknown":
                # Only speak up once, when the blind spot stops looking transient.
                if streak == unknown_streak_alert:
                    transitions.append({**base, "kind": "UNKNOWN"})
                continue

            was_bad = old_cls in BAD
            is_bad = cls in BAD
            if not was_bad and is_bad:
                transitions.append({**base, "kind": "DEGRADED"})
            elif was_bad and not is_bad:
                transitions.append({**base, "kind": "RECOVERED"})
            elif was_bad and is_bad and old_cls != cls:
                kind = "ESCALATED" if SEVERITY_ORDER.index(cls) > SEVERITY_ORDER.index(old_cls) else "EASED"
                transitions.append({**base, "kind": kind})

    return transitions, {"schema": 1, "updated_at": now_iso(), "components": new_c}


# ---------------------------------------------------------------------------
# Discord
# ---------------------------------------------------------------------------
EMOJI = {
    "DEGRADED": ":warning:",
    "ESCALATED": ":rotating_light:",
    "EASED": ":arrow_down:",
    "RECOVERED": ":white_check_mark:",
    "UNKNOWN": ":grey_question:",
}


def webhook_url(env_file: str) -> str:
    url = os.environ.get("DISCORD_OPS_WEBHOOK_URL", "").strip()
    if url:
        return url
    try:
        with open(env_file) as f:
            for line in f:
                if line.startswith("DISCORD_OPS_WEBHOOK_URL="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def render(transitions: list[dict], snap: dict) -> str:
    """One message per poll, one line per transition.

    Batching is deliberate: a vendor-wide event hits several allowlisted
    components in the same poll, and six separate pings for one outage is how an
    ops channel gets muted. Each transition still appears exactly once, ever.
    """
    lines = ["**Vendor status** (GOL-3021)"]
    for t in transitions:
        bits = [f"{EMOJI[t['kind']]} **{t['label']} / {t['component']}** {t['kind'].lower()}"]
        if t["kind"] == "RECOVERED":
            bits.append("— back to `operational`")
        else:
            bits.append(f"— `{t['status']}`")
            if t.get("from"):
                bits.append(f"(was `{t['from']}`)")
        if t.get("incident"):
            bits.append(f'· incident: "{t["incident"]}"')
            if t.get("incident_url"):
                bits.append(f"<{t['incident_url']}>")
        elif t.get("status_page"):
            bits.append(f"<{t['status_page']}>")
        lines.append(" ".join(bits))

    if snap["hints"].get("github_actions"):
        lines.append("")
        lines.append(f"> {snap['hints']['github_actions']}")
    lines.append("")
    lines.append("Agents: `vendor-status-guard.py read` or `cat /paperclip/ops/vendor-status.json`")
    msg = "\n".join(lines)
    return msg[:1900] + "\n…(truncated)" if len(msg) > 1950 else msg


def post_discord(url: str, content: str, timeout: float) -> bool:
    data = json.dumps({"content": content, "flags": 4}).encode()  # flags 4 = suppress embeds
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json", "User-Agent": UA}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.getcode() < 300
    except Exception as e:  # noqa: BLE001
        print(f"vendor-status: WARN Discord post failed: {type(e).__name__}: {e}", file=sys.stderr)
        return False


# ---------------------------------------------------------------------------
# Snapshot path resolution
# ---------------------------------------------------------------------------
def default_snapshot_path() -> str:
    """Where the snapshot lives, resolved for whichever side is calling.

    Agents run INSIDE paperclip-server, where the `paperclip-data` volume is
    mounted at /paperclip — so the snapshot has to land on that volume for the
    "one call, no vault" read to be possible at all. From the host the same file
    is under /var/lib/docker/volumes/<project>_paperclip-data/_data, which is
    globbed exactly the way /etc/logrotate.d/agenticos already globs it.
    """
    if os.path.isdir("/paperclip"):
        return "/paperclip/ops/vendor-status.json"
    hits = sorted(glob.glob("/var/lib/docker/volumes/*paperclip-data/_data"))
    if hits:
        return os.path.join(hits[-1], "ops", "vendor-status.json")
    return "/var/lib/agenticos/vendor-status/vendor-status.json"


def summarize(snap: dict) -> str:
    icon = {"ok": "OK", "maintenance": "MAINT", "unknown": "UNKNOWN", "degraded": "DEGRADED",
            "down": "DOWN"}[snap["overall"]]
    out = [f"[{icon}] {snap['headline']}  (as of {snap['generated_at']})"]
    for b in snap["degraded"]:
        line = f"  - {b['label']} / {b['component']}: {b['status']}"
        if b.get("since"):
            line += f" since {b['since']}"
        if b.get("incident"):
            line += f'  incident: "{b["incident"]}" {b.get("incident_url") or ""}'
        out.append(line)
    if snap["hints"].get("github_actions"):
        out += ["", "  GitHub Actions triage:", "    " + snap["hints"]["github_actions"]]
    return "\n".join(out)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", choices=["poll", "read"], nargs="?", default="read")
    ap.add_argument("--state", default=os.environ.get("VENDOR_STATUS_STATE") or None)
    ap.add_argument("--snapshot", default=os.environ.get("VENDOR_STATUS_SNAPSHOT") or None)
    ap.add_argument("--env-file", default=os.environ.get("ENV_FILE", "/opt/agenticos/.env"))
    ap.add_argument("--timeout", type=float, default=12.0)
    ap.add_argument("--max-age", type=float, default=600.0,
                    help="read: re-poll if the snapshot is older than this many seconds")
    ap.add_argument("--unknown-streak", type=int, default=3,
                    help="poll: consecutive unreadable polls before alerting UNKNOWN")
    ap.add_argument("--vendor", action="append", help="limit to this vendor key (repeatable)")
    ap.add_argument("--dry-run", action="store_true",
                    help="poll: print the alert and the next state, write nothing, post nothing")
    ap.add_argument("--json", action="store_true", help="print the raw snapshot JSON")
    args = ap.parse_args(argv)

    snapshot_path = args.snapshot or default_snapshot_path()
    # State sits NEXT TO the snapshot by default, deliberately: both the host
    # timer (root, via the /var/lib/docker/volumes glob) and an in-container
    # agent run resolve the same file, so there is exactly ONE dedupe stream.
    # Parking state in /var/lib/agenticos instead would give the host and the
    # container independent histories and double every alert.
    state_path = args.state or os.path.join(os.path.dirname(snapshot_path),
                                            "vendor-status.state.json")
    bad_keys = [k for k in (args.vendor or []) if k not in VENDORS]
    if bad_keys:
        print(f"vendor-status: unknown vendor(s): {', '.join(bad_keys)}; "
              f"known: {', '.join(VENDORS)}", file=sys.stderr)
        return 2

    if args.command == "read":
        age = snapshot_age_seconds(snapshot_path)
        if age is not None and age <= args.max_age:
            with open(snapshot_path) as f:
                snap = json.load(f)
            snap["snapshot_age_seconds"] = int(age)
        else:
            # Stale or missing: answer live rather than hand back a stale lie.
            snap = build_snapshot(collect(args.timeout, args.vendor), "read (live)")
            snap["snapshot_age_seconds"] = 0
            snap["snapshot_written"] = write_json(snapshot_path, snap) is not None
        print(json.dumps(snap, indent=2) if args.json else summarize(snap))
        return 0

    # ---- poll ----
    vendors = collect(args.timeout, args.vendor)
    snap = build_snapshot(vendors, "poll")

    prev = {}
    try:
        with open(state_path) as f:
            prev = json.load(f)
    except Exception:  # noqa: BLE001 - no/corrupt state == first run
        pass

    transitions, state = diff_transitions(prev, vendors, args.unknown_streak)
    print(f"vendor-status: {snap['overall']} — {snap['headline']}")
    print(f"vendor-status: {len(transitions)} transition(s) since last poll")

    if args.dry_run:
        if transitions:
            print("--- would post ---")
            print(render(transitions, snap))
        print(f"--- would write snapshot -> {snapshot_path}")
        print(f"--- would write state    -> {state_path}")
        return 0

    if write_json(snapshot_path, snap) is None:
        print(f"vendor-status: WARN could not write snapshot {snapshot_path}", file=sys.stderr)
    if write_json(state_path, state) is None:
        # Without state every poll re-alerts, so this is louder than a warning
        # on the snapshot: say it plainly and keep going.
        print(f"vendor-status: ERROR could not write state {state_path} — "
              f"dedupe is disabled until this is fixed", file=sys.stderr)

    if not transitions:
        return 0
    url = webhook_url(args.env_file)
    if not url:
        print("vendor-status: DISCORD_OPS_WEBHOOK_URL unset — snapshot written, alert skipped",
              file=sys.stderr)
        return 0
    return 0 if post_discord(url, render(transitions, snap), args.timeout) else 1


if __name__ == "__main__":
    sys.exit(main())
