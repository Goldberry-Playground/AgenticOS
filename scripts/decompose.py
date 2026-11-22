#!/usr/bin/env python3
"""Decompose one change spec into D2-partitioned, owned, reviewable child issues.

This is the build partner of the CEO "Group-coding decomposition" routine
(GOL-154). It intersects a **spec** (one intended change set) with each repo's
`ownership.yml` (GOL-152) and emits exactly one child issue per touched
partition, carrying acceptance criteria, an owner (assignee), reviewer(s), and a
`wave` number for sequencing. Every touched path lands in exactly one owned
partition — **no path is double-assigned** — and any path that matches no
partition is surfaced (never dropped) in an ``UNMAPPED`` bucket.

Zero-dependency (Python 3.8+ stdlib only), same style as
``scripts/lint-ownership.py`` so it runs identically in CI regardless of the
repo's language toolchain. The strict-YAML-subset parser is shared with the
linter grammar.

Dry-run is the default: it renders the partition table + wave DAG + UNMAPPED
list and creates nothing. ``--apply`` performs the creates/updates against the
Paperclip issues API, and re-running the same spec is idempotent (it updates the
issue that carries the matching ``decompose:{specId}:{repo}:{partition}`` marker
instead of duplicating).

Usage (dry-run preview):
  python3 scripts/decompose.py --spec spec.yml \
      --ownership grove-sites=/path/grove-sites/ownership.yml \
      --ownership odoocker=/path/odoocker/ownership.yml \
      --ownership grove-odoo-modules=/path/grove-odoo-modules/ownership.yml \
      --agents-file agents.json

  # or point at a directory of checkouts (looks for <root>/<repo>/ownership.yml):
  python3 scripts/decompose.py --spec spec.yml --repos-root /path/checkouts

Apply (create/update issues via the Paperclip API):
  python3 scripts/decompose.py --spec spec.yml --repos-root /path/checkouts \
      --apply --company-id "$PAPERCLIP_COMPANY_ID"

Owner/reviewer resolution: ownership slug **==** agent ``urlKey``. Resolved from
``--agents-file`` (JSON: ``[{"urlKey":"engineering-ada","id":"..."}]``) when
given, else live via ``GET /api/companies/{id}/agents``. An unknown slug is a
hard error (never a silent drop).

Exit codes: 0 = ok, 1 = decomposition error (unmapped without
``--allow-unmapped``, unknown slug, API failure), 2 = usage/parse error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

# --------------------------------------------------------------------------- #
# Minimal YAML-subset parser — identical grammar to scripts/lint-ownership.py
# (block maps, block/flow sequences, scalars). Strict 2-space indentation.
# Good enough for both ownership.yml and the constrained spec format; fails
# loudly on anything unexpected.
# --------------------------------------------------------------------------- #
class YamlError(Exception):
    pass


def _strip_comment(line: str) -> str:
    out, in_s, in_d = [], False, False
    i = 0
    while i < len(line):
        c = line[i]
        if c == "'" and not in_d:
            in_s = not in_s
        elif c == '"' and not in_s:
            in_d = not in_d
        elif c == "#" and not in_s and not in_d:
            if i == 0 or line[i - 1] in " \t":
                break
        out.append(c)
        i += 1
    return "".join(out)


def _scalar(tok: str):
    tok = tok.strip()
    if tok == "" or tok == "~" or tok.lower() == "null":
        return None
    if (tok[0] == '"' and tok[-1] == '"') or (tok[0] == "'" and tok[-1] == "'"):
        return tok[1:-1]
    if tok.startswith("[") and tok.endswith("]"):
        inner = tok[1:-1].strip()
        if inner == "":
            return []
        return [_scalar(p) for p in _split_flow(inner)]
    if re.fullmatch(r"-?\d+", tok):
        return int(tok)
    if tok.lower() in ("true", "false"):
        return tok.lower() == "true"
    return tok


def _split_flow(inner: str):
    parts, depth, cur = [], 0, []
    in_s = in_d = False
    for c in inner:
        if c == "'" and not in_d:
            in_s = not in_s
        elif c == '"' and not in_s:
            in_d = not in_d
        if c == "[" and not in_s and not in_d:
            depth += 1
        elif c == "]" and not in_s and not in_d:
            depth -= 1
        if c == "," and depth == 0 and not in_s and not in_d:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    if cur:
        parts.append("".join(cur))
    return [p for p in parts]


class _Line:
    __slots__ = ("indent", "text", "no")

    def __init__(self, indent, text, no):
        self.indent = indent
        self.text = text
        self.no = no


def _tokenize(src: str):
    lines = []
    for i, raw in enumerate(src.splitlines(), 1):
        if "\t" in raw[: len(raw) - len(raw.lstrip(" \t"))]:
            raise YamlError(f"line {i}: tab in indentation (use spaces)")
        stripped = _strip_comment(raw).rstrip()
        if stripped.strip() == "":
            continue
        indent = len(stripped) - len(stripped.lstrip(" "))
        lines.append(_Line(indent, stripped.strip(), i))
    return lines


def _parse_block(lines, idx, indent):
    if idx >= len(lines):
        return None, idx
    first = lines[idx]
    if first.indent < indent:
        return None, idx
    if first.text.startswith("- "):
        return _parse_seq(lines, idx, first.indent)
    return _parse_map(lines, idx, first.indent)


def _parse_map(lines, idx, indent):
    result = {}
    while idx < len(lines):
        ln = lines[idx]
        if ln.indent < indent:
            break
        if ln.indent > indent:
            raise YamlError(f"line {ln.no}: unexpected indentation")
        if ln.text.startswith("- "):
            raise YamlError(f"line {ln.no}: sequence item inside mapping")
        if ":" not in ln.text:
            raise YamlError(f"line {ln.no}: expected 'key: value'")
        key, _, val = ln.text.partition(":")
        key = key.strip()
        val = val.strip()
        if val == "":
            child, idx = _parse_block(lines, idx + 1, indent + 1)
            result[key] = child
        else:
            result[key] = _scalar(val)
            idx += 1
    return result, idx


def _parse_seq(lines, idx, indent):
    result = []
    while idx < len(lines):
        ln = lines[idx]
        if ln.indent < indent:
            break
        if ln.indent > indent:
            raise YamlError(f"line {ln.no}: unexpected indentation")
        if not ln.text.startswith("- "):
            break
        rest = ln.text[2:].strip()
        if rest == "":
            child, idx = _parse_block(lines, idx + 1, indent + 1)
            result.append(child)
        elif ":" in rest and not (rest.startswith("[") or rest.startswith('"') or rest.startswith("'")):
            lines[idx] = _Line(indent + 2, rest, ln.no)
            child, idx = _parse_map(lines, idx, indent + 2)
            result.append(child)
        else:
            result.append(_scalar(rest))
            idx += 1
    return result, idx


def parse_yaml(src: str):
    lines = _tokenize(src)
    if not lines:
        return {}
    value, idx = _parse_block(lines, 0, 0)
    if idx != len(lines):
        raise YamlError(f"line {lines[idx].no}: could not parse (indentation?)")
    return value


# --------------------------------------------------------------------------- #
# Glob matching (spec §3) — gitignore-ish globs with `**` globstar support.
# --------------------------------------------------------------------------- #
_WILD = "*?["


def _glob_to_regex(glob: str) -> "re.Pattern":
    """Translate an ownership glob into an anchored regex.

    Semantics:
      **/   → zero or more leading path segments  (any chars incl. '/')
      /**   → the dir itself or anything beneath it
      **    → any chars incl. '/'
      *     → any chars except '/'
      ?     → one char except '/'
      [..]  → character class (literal, non-'/')
    """
    i, n, out = 0, len(glob), []
    while i < n:
        c = glob[i]
        if c == "*":
            if i + 1 < n and glob[i + 1] == "*":
                # globstar; consume a following '/' so "a/**/b" allows "a/b"
                j = i + 2
                if j < n and glob[j] == "/":
                    out.append("(?:.*/)?")
                    i = j + 1
                    continue
                # trailing or bare "**"
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c == "[":
            j = i + 1
            if j < n and glob[j] in "!^":
                j += 1
            if j < n and glob[j] == "]":
                j += 1
            while j < n and glob[j] != "]":
                j += 1
            if j >= n:  # unterminated class -> literal '['
                out.append(re.escape("["))
                i += 1
                continue
            cls = glob[i + 1 : j]
            if cls.startswith("!"):
                cls = "^" + cls[1:]
            out.append("[" + cls.replace("/", "") + "]")
            i = j + 1
        elif c == "/":
            # "foo/**" should also match the bare "foo" directory itself.
            if glob[i + 1 : i + 3] == "**" and (i + 3 == n):
                out.append("(?:/.*)?")
                i = n
                break
            out.append("/")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def glob_match(glob: str, path: str) -> bool:
    """Does ownership `glob` match the (possibly glob-containing) spec `path`?"""
    return _glob_to_regex(glob).match(path) is not None


def literal_prefix_len(glob: str) -> int:
    """Chars of `glob` before the first wildcard metacharacter."""
    for i, c in enumerate(glob):
        if c in _WILD:
            return i
    return len(glob)


def wildcard_segment_count(glob: str) -> int:
    return sum(1 for seg in glob.split("/") if any(ch in seg for ch in _WILD))


# --------------------------------------------------------------------------- #
# Ownership model
# --------------------------------------------------------------------------- #
class Partition:
    def __init__(self, repo, name, paths, owners, reviewers, wave, order):
        self.repo = repo
        self.name = name
        self.paths = paths
        self.owners = owners
        self.reviewers = reviewers
        self.wave = wave
        self.order = order

    def best_glob_for(self, path):
        """Return (glob, sort_key) for the most-specific glob that matches path,
        or None if this partition does not match. Lower sort_key == more specific
        (spec §3.2: longest literal prefix → fewest wildcard segments → order)."""
        best = None
        for g in self.paths:
            if glob_match(g, path):
                key = (-literal_prefix_len(g), wildcard_segment_count(g), self.order)
                if best is None or key < best[1]:
                    best = (g, key)
        return best


def load_ownership(repo_key, path):
    with open(path, encoding="utf-8") as fh:
        doc = parse_yaml(fh.read())
    if not isinstance(doc, dict):
        raise YamlError(f"{path}: top level must be a mapping")
    default_review = []
    d = doc.get("defaults")
    if isinstance(d, dict):
        default_review = _as_list(d.get("review"))
    declared_repo = doc.get("repo")
    parts = []
    raw = doc.get("partitions") or []
    if not isinstance(raw, list) or not raw:
        raise YamlError(f"{path}: partitions must be a non-empty list")
    for order, p in enumerate(raw):
        if not isinstance(p, dict):
            raise YamlError(f"{path}: partition #{order} is not a mapping")
        name = p.get("name")
        paths = _as_list(p.get("paths"))
        owners = _as_list(p.get("owner"))
        reviewers = _as_list(p.get("review")) or list(default_review)
        wave = p.get("wave")
        wave = wave if isinstance(wave, int) else 1
        if not name or not paths or not owners:
            raise YamlError(f"{path}: partition '{name}' missing name/paths/owner")
        parts.append(Partition(repo_key, name, paths, owners, reviewers, wave, order))
    return parts, declared_repo


def _as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


# --------------------------------------------------------------------------- #
# Spec model
# --------------------------------------------------------------------------- #
class Spec:
    def __init__(self, doc, spec_id=None):
        if not isinstance(doc, dict):
            raise ValueError("spec must be a mapping")
        self.title = doc.get("title")
        self.umbrella = doc.get("umbrella")
        self.goal = doc.get("goal")
        self.summary = doc.get("summary") or ""
        self.priority = doc.get("priority")
        self.acceptance = _as_list(doc.get("acceptance"))
        self.changes = []
        for ch in _as_list(doc.get("changes")):
            if not isinstance(ch, dict):
                raise ValueError("each change must be a mapping")
            self.changes.append(
                {
                    "repo": ch.get("repo"),
                    "paths": _as_list(ch.get("paths")),
                    "acceptance": _as_list(ch.get("acceptance")),
                }
            )
        if not self.title:
            raise ValueError("spec.title is required")
        if not self.umbrella:
            raise ValueError("spec.umbrella is required")
        if not self.changes:
            raise ValueError("spec.changes must have at least one entry")
        for ch in self.changes:
            if not ch["repo"] or not ch["paths"]:
                raise ValueError("each change needs a repo and at least one path")
        self.id = doc.get("id") or spec_id or _hash_spec(doc)


def _hash_spec(doc) -> str:
    canon = json.dumps(doc, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(canon.encode("utf-8")).hexdigest()[:8]


# --------------------------------------------------------------------------- #
# Partitioning (spec §3)
# --------------------------------------------------------------------------- #
class Emission:
    """One resolved partition-issue to be created/updated."""

    def __init__(self, repo, partition):
        self.repo = repo
        self.partition = partition
        self.paths = []                 # matched spec paths
        self.change_acceptance = []     # partition-scoped acceptance, deduped

    @property
    def wave(self):
        return self.partition.wave

    def marker(self, spec_id):
        return f"decompose:{spec_id}:{self.repo}:{self.partition.name}"


def partition_spec(spec, ownership):
    """Return (emissions_by_key, unmapped).

    emissions_by_key: dict "{repo}/{partition}" -> Emission (paths grouped).
    unmapped: list of (repo, path) not claimed by any partition.
    """
    emissions = {}
    unmapped = []
    for ch in spec.changes:
        repo = ch["repo"]
        parts = ownership.get(repo)
        if parts is None:
            raise ValueError(
                f"spec change references repo '{repo}' with no ownership.yml provided "
                f"(pass --ownership {repo}=<path> or --repos-root)"
            )
        for path in ch["paths"]:
            winner = _pick_partition(parts, path)
            if winner is None:
                unmapped.append((repo, path))
                continue
            key = f"{repo}/{winner.name}"
            em = emissions.get(key)
            if em is None:
                em = Emission(repo, winner)
                emissions[key] = em
            if path not in em.paths:
                em.paths.append(path)
            for a in ch["acceptance"]:
                if a not in em.change_acceptance:
                    em.change_acceptance.append(a)
    return emissions, unmapped


def _pick_partition(parts, path):
    """Most-specific-wins; exactly one partition or None."""
    best_part, best_key = None, None
    for p in parts:
        cand = p.best_glob_for(path)
        if cand is None:
            continue
        _, key = cand
        if best_key is None or key < best_key:
            best_key, best_part = key, p
    return best_part


# --------------------------------------------------------------------------- #
# Owner / reviewer resolution (spec §5) — slug == agent urlKey
# --------------------------------------------------------------------------- #
class AgentResolver:
    def __init__(self, by_urlkey):
        self._by = by_urlkey  # urlKey -> {id, name, urlKey}

    @classmethod
    def from_list(cls, agents):
        by = {}
        for a in agents:
            uk = a.get("urlKey") or a.get("urlkey")
            if uk:
                by[uk] = a
        return cls(by)

    def id_for(self, slug):
        a = self._by.get(slug)
        if a is None:
            raise ValueError(
                f"ownership slug '{slug}' does not match any agent urlKey "
                f"(known: {', '.join(sorted(self._by)) or '<none>'})"
            )
        return a["id"]

    def name_for(self, slug):
        a = self._by.get(slug)
        return a.get("name", slug) if a else slug


# --------------------------------------------------------------------------- #
# Emitted-issue body (spec §4)
# --------------------------------------------------------------------------- #
def issue_title(em, spec):
    return f"[W{em.wave}][{em.repo}/{em.partition.name}] {spec.title}"


def issue_body(em, spec, resolver):
    p = em.partition
    owner_slugs = p.owners
    reviewer_slugs = p.reviewers
    acceptance = list(spec.acceptance) + [a for a in em.change_acceptance if a not in spec.acceptance]
    lines = []
    if spec.summary:
        lines += [spec.summary, ""]
    lines.append(f"**Repo / partition:** `{em.repo}` / `{p.name}`  ")
    lines.append(f"**Wave:** {em.wave}  ")
    owners_fmt = ", ".join(f"`{s}` ({resolver.name_for(s)})" for s in owner_slugs)
    revs_fmt = ", ".join(f"`{s}` ({resolver.name_for(s)})" for s in reviewer_slugs)
    lines.append(f"**Owner:** {owners_fmt}  ")
    lines.append(f"**Reviewer(s):** {revs_fmt}")
    lines.append("")
    lines.append("### Matched paths")
    for path in em.paths:
        lines.append(f"- `{path}`")
    lines.append("")
    lines.append("### Acceptance")
    if acceptance:
        for a in acceptance:
            lines.append(f"- {a}")
    else:
        lines.append("- _(none specified in spec)_")
    lines.append("")
    lines.append(f"Spec: `{spec.title}` (id `{spec.id}`, umbrella {spec.umbrella})")
    lines.append("")
    lines.append(f"<!-- {em.marker(spec.id)} -->")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Paperclip API client (used only for --apply and live agent/umbrella lookup)
# --------------------------------------------------------------------------- #
class Api:
    def __init__(self, base, key, run_id=None):
        self.base = base.rstrip("/")
        self.key = key
        self.run_id = run_id

    def _req(self, method, path, body=None):
        url = self.base + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(url, data=data, method=method)
        r.add_header("Authorization", "Bearer " + self.key)
        if self.run_id:
            r.add_header("X-Paperclip-Run-Id", self.run_id)
        if data is not None:
            r.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(r) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode('utf-8')[:300]}")
        return json.loads(raw) if raw else None

    def get(self, path):
        return self._req("GET", path)

    def post(self, path, body):
        return self._req("POST", path, body)

    def patch(self, path, body):
        return self._req("PATCH", path, body)


def _items(resp):
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        for k in ("items", "issues", "agents", "results", "data"):
            if isinstance(resp.get(k), list):
                return resp[k]
    return []


def fetch_agents(api, company_id):
    return _items(api.get(f"/api/companies/{company_id}/agents"))


def resolve_umbrella_id(api, company_id, umbrella):
    """Accept a raw id or a GOL-XXX identifier; return the internal issue id."""
    if re.fullmatch(r"[0-9a-fA-F-]{8,}", umbrella) and "-" in umbrella and umbrella.count("-") >= 4:
        return umbrella  # already a uuid
    for it in _items(api.get(f"/api/companies/{company_id}/issues?q={umbrella}")):
        if it.get("identifier") == umbrella:
            return it["id"]
    raise ValueError(f"could not resolve umbrella issue '{umbrella}' to an id")


def find_existing_by_marker(api, umbrella_id, marker):
    """Look up an already-emitted child issue carrying this idempotency marker."""
    issue = api.get(f"/api/issues/{umbrella_id}")
    children = issue.get("children") or issue.get("childIssues") or []
    for c in children:
        cid = c.get("id")
        if not cid:
            continue
        full = api.get(f"/api/issues/{cid}")
        if marker in (full.get("description") or ""):
            return cid
    return None


# --------------------------------------------------------------------------- #
# Rendering (spec §6 dry-run)
# --------------------------------------------------------------------------- #
def render_table(emissions, spec, resolver):
    rows = [("repo", "partition", "paths", "owner", "reviewer", "wave", "#acc", "action")]
    for em in _ordered(emissions):
        acc = len(spec.acceptance) + len([a for a in em.change_acceptance if a not in spec.acceptance])
        rows.append(
            (
                em.repo,
                em.partition.name,
                str(len(em.paths)),
                ",".join(em.partition.owners),
                ",".join(em.partition.reviewers),
                str(em.wave),
                str(acc),
                em.action if hasattr(em, "action") else "create",
            )
        )
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    out = []
    for ri, r in enumerate(rows):
        out.append("  ".join(c.ljust(widths[i]) for i, c in enumerate(r)).rstrip())
        if ri == 0:
            out.append("  ".join("-" * widths[i] for i in range(len(r))))
    return "\n".join(out)


def render_wave_dag(emissions):
    waves = {}
    for em in _ordered(emissions):
        waves.setdefault(em.wave, []).append(f"{em.repo}/{em.partition.name}")
    out = []
    prev = []
    for w in sorted(waves):
        blocked = f"  (blocked by all of wave(s) {', '.join(map(str, prev))})" if prev else "  (runs first)"
        out.append(f"wave {w}{blocked}:")
        for k in waves[w]:
            out.append(f"    - {k}")
        prev.append(w)
    return "\n".join(out)


def _ordered(emissions):
    return sorted(emissions.values(), key=lambda e: (e.wave, e.repo, e.partition.order))


# --------------------------------------------------------------------------- #
# Apply (spec §4 wave gate + §6 idempotency)
# --------------------------------------------------------------------------- #
def apply(api, company_id, spec, emissions, resolver):
    umbrella_id = resolve_umbrella_id(api, company_id, spec.umbrella)
    goal_id = None
    if spec.goal:
        try:
            goal_id = resolve_umbrella_id(api, company_id, spec.goal)
        except ValueError:
            goal_id = spec.goal  # allow a raw goalId
    ordered = _ordered(emissions)

    # Pass 1: create or update every issue (no blockers yet), record their ids
    # and waves so pass 2 can wire the wave gate deterministically.
    for em in ordered:
        assignee = resolver.id_for(em.partition.owners[0])
        body = {
            "title": issue_title(em, spec),
            "description": issue_body(em, spec, resolver),
            "assigneeAgentId": assignee,
            "parentId": umbrella_id,
        }
        if goal_id:
            body["goalId"] = goal_id
        if spec.priority:
            body["priority"] = spec.priority
        existing = find_existing_by_marker(api, umbrella_id, em.marker(spec.id))
        if existing:
            api.patch(f"/api/issues/{existing}", body)
            em.issue_id, em.action = existing, "update"
        else:
            created = api.post(f"/api/companies/{company_id}/issues", body)
            em.issue_id, em.action = created["id"], "create"

    # Pass 2: wave gate — an issue in wave N is blocked by every emitted issue in
    # waves < N.
    for em in ordered:
        blockers = [o.issue_id for o in ordered if o.wave < em.wave]
        api.patch(f"/api/issues/{em.issue_id}", {"blockedByIssueIds": blockers})
    return umbrella_id


# --------------------------------------------------------------------------- #
# Ownership discovery
# --------------------------------------------------------------------------- #
def discover_ownership(ownership_args, repos_root, repos_needed):
    """Build repo_key -> parts. `ownership_args` is a list of 'repo=path'."""
    explicit = {}
    for spec_arg in ownership_args or []:
        if "=" not in spec_arg:
            raise ValueError(f"--ownership expects repo=path, got '{spec_arg}'")
        k, _, v = spec_arg.partition("=")
        explicit[k.strip()] = v.strip()
    out = {}
    declared = {}
    for repo in repos_needed:
        path = explicit.get(repo)
        if path is None and repos_root:
            cand = os.path.join(repos_root, repo, "ownership.yml")
            if os.path.exists(cand):
                path = cand
            else:
                # dir name may differ from the spec repo key (e.g. spec 'odoocker'
                # vs checkout 'odoocker-goldberrygrove'): match a subdir whose name
                # starts with the repo key and holds an ownership.yml.
                try:
                    subs = sorted(os.listdir(repos_root))
                except OSError:
                    subs = []
                for sub in subs:
                    if sub.startswith(repo) and os.path.exists(
                        os.path.join(repos_root, sub, "ownership.yml")
                    ):
                        path = os.path.join(repos_root, sub, "ownership.yml")
                        break
        if path is None:
            raise ValueError(
                f"no ownership.yml for repo '{repo}' "
                f"(pass --ownership {repo}=<path> or --repos-root with {repo}/ownership.yml)"
            )
        if not os.path.exists(path):
            raise ValueError(f"ownership.yml not found: {path}")
        parts, declared_repo = load_ownership(repo, path)
        out[repo] = parts
        declared[repo] = declared_repo
    return out, declared


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv=None):
    ap = argparse.ArgumentParser(description="Decompose a spec into partitioned issues")
    ap.add_argument("--spec", required=True, help="path to the spec YAML/JSON")
    ap.add_argument("--ownership", action="append", default=[],
                    help="repo=path/to/ownership.yml (repeatable)")
    ap.add_argument("--repos-root", default=None,
                    help="dir of checkouts; falls back to <root>/<repo>/ownership.yml")
    ap.add_argument("--agents-file", default=None,
                    help="JSON list of {urlKey,id,name} for offline owner resolution")
    ap.add_argument("--api-url", default=os.environ.get("PAPERCLIP_API_URL"),
                    help="Paperclip API base (default $PAPERCLIP_API_URL)")
    ap.add_argument("--company-id", default=os.environ.get("PAPERCLIP_COMPANY_ID"))
    ap.add_argument("--apply", action="store_true", help="create/update issues (default: dry-run)")
    ap.add_argument("--allow-unmapped", action="store_true",
                    help="proceed with --apply even if paths are UNMAPPED")
    args = ap.parse_args(argv)

    # Load spec.
    try:
        with open(args.spec, encoding="utf-8") as fh:
            raw = fh.read()
        doc = json.loads(raw) if args.spec.endswith(".json") else parse_yaml(raw)
        spec = Spec(doc)
    except (OSError, YamlError, ValueError, json.JSONDecodeError) as e:
        print(f"decompose: spec error: {e}", file=sys.stderr)
        return 2

    repos_needed = sorted({ch["repo"] for ch in spec.changes})
    try:
        ownership, declared = discover_ownership(args.ownership, args.repos_root, repos_needed)
    except (ValueError, YamlError) as e:
        print(f"decompose: ownership error: {e}", file=sys.stderr)
        return 2
    for repo, decl in declared.items():
        if decl and decl != repo:
            print(f"decompose: note: repo key '{repo}' maps to ownership.yml declaring "
                  f"repo: '{decl}' (using key '{repo}')", file=sys.stderr)

    # Partition.
    try:
        emissions, unmapped = partition_spec(spec, ownership)
    except ValueError as e:
        print(f"decompose: {e}", file=sys.stderr)
        return 1

    # Resolve owners/reviewers.
    api = None
    try:
        if args.agents_file:
            with open(args.agents_file, encoding="utf-8") as fh:
                resolver = AgentResolver.from_list(json.load(fh))
        else:
            if not args.api_url or not args.company_id:
                print("decompose: need --agents-file or --api-url + --company-id to resolve owners",
                      file=sys.stderr)
                return 2
            api = Api(args.api_url, os.environ.get("PAPERCLIP_API_KEY", ""),
                      os.environ.get("PAPERCLIP_RUN_ID"))
            resolver = AgentResolver.from_list(fetch_agents(api, args.company_id))
        # Validate every owner/reviewer slug up front (hard error on unknown).
        for em in emissions.values():
            for slug in list(em.partition.owners) + list(em.partition.reviewers):
                resolver.id_for(slug)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as e:
        print(f"decompose: resolution error: {e}", file=sys.stderr)
        return 1

    # Default action label for the preview (refined during apply).
    for em in emissions.values():
        em.action = "create"

    # Render preview (always).
    print(f"# Decomposition preview — spec '{spec.title}' (id {spec.id})")
    print(f"# umbrella: {spec.umbrella}" + (f"  goal: {spec.goal}" if spec.goal else ""))
    print(f"# {len(emissions)} partition-issue(s), {len(unmapped)} unmapped path(s)\n")
    if emissions:
        print(render_table(emissions, spec, resolver))
        print("\n## Wave DAG")
        print(render_wave_dag(emissions))
    else:
        print("(no partitions matched)")
    if unmapped:
        print("\n## UNMAPPED paths (matched no partition — NOT dropped)")
        for repo, path in unmapped:
            print(f"  ! {repo}: {path}")

    if not args.apply:
        print("\n(dry-run — no issues created. Re-run with --apply to create/update.)")
        return 0

    if unmapped and not args.allow_unmapped:
        print(f"\ndecompose: refusing --apply with {len(unmapped)} UNMAPPED path(s); "
              f"fix the spec/ownership or pass --allow-unmapped", file=sys.stderr)
        return 1

    if api is None:
        if not args.api_url or not args.company_id:
            print("decompose: --apply needs --api-url + --company-id", file=sys.stderr)
            return 2
        api = Api(args.api_url, os.environ.get("PAPERCLIP_API_KEY", ""),
                  os.environ.get("PAPERCLIP_RUN_ID"))
    try:
        umbrella_id = apply(api, args.company_id, spec, emissions, resolver)
    except (ValueError, RuntimeError) as e:
        print(f"decompose: apply failed: {e}", file=sys.stderr)
        return 1

    print(f"\n## Applied under umbrella {spec.umbrella} ({umbrella_id})")
    for em in _ordered(emissions):
        print(f"  {em.action}: {issue_title(em, spec)} -> {em.issue_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
