#!/usr/bin/env python3
"""Audit: every required status check must report on `merge_group`.

GOL-1735 / GOL-1406-D (ported org-wide by GOL-1824). GitHub's merge queue builds
a synthetic `merge_group` commit and waits for every *required* status check to
report on it. A required check whose workflow does not trigger on `merge_group`
never reports there, so the queue entry sits at "Expected — waiting for status"
until it times out and is dropped — the whole queue wedges. This audit makes
that failure mode a loud, pre-merge error instead of a silent production wedge.

Two modes:

  static (default)  Parse .github/workflows/*.y[a]ml and .github/required-checks.json.
                    For each declared required context, find the workflow(s) that
                    produce it — either a job whose `name:` (or id) equals the
                    context, OR a commit status posted via the statuses API with
                    that exact `context: '...'` literal (e.g. github-script
                    repos.createCommitStatus) — and assert at least one such
                    workflow lists `merge_group` in `on:`. No network, no token,
                    safe on PRs and on `merge_group` itself.

  --reconcile       Additionally call the GitHub API (needs GH_TOKEN + GH_REPO=
                    owner/repo) and fail if the live *required* contexts differ
                    from required-checks.json. Required checks may live in classic
                    branch protection OR in a repo ruleset (both are read and
                    unioned), so this works whichever mechanism a repo uses.
                    Reading either needs a repo-admin token — the default Actions
                    GITHUB_TOKEN cannot — so if BOTH reads come back
                    unauthorized (401/403) this leg soft-skips with a warning
                    instead of hard-failing. Run on a schedule / workflow_dispatch,
                    where an elevated REQUIRED_CHECKS_ADMIN_TOKEN is available.

Exit non-zero on any failure.
"""
import glob
import json
import os
import re
import sys

try:
    import yaml
except ImportError:
    print("::error::PyYAML not available; `pip install pyyaml` before running the audit.")
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WF_DIR = os.path.join(ROOT, ".github", "workflows")
MANIFEST = os.path.join(ROOT, ".github", "required-checks.json")

# A quoted string literal following a `context:` key — how a commit status is
# named when posted via the statuses API (github-script
# repos.createCommitStatus({context: 'X'}) or createStatus). These become
# required-check contexts too, but they are NOT job names, so the job-name map
# alone would miss them. The quote requirement excludes unquoted YAML keys such
# as docker/build-push-action's `context: .` build path.
STATUS_CTX_RE = re.compile(r"""context:\s*(['"])((?:(?!\1).)+)\1""")


def on_has_merge_group(on):
    """True if a workflow `on:` (str | list | dict) includes merge_group."""
    if on is None:
        return False
    if isinstance(on, str):
        return on == "merge_group"
    if isinstance(on, list):
        return "merge_group" in on
    if isinstance(on, dict):
        return "merge_group" in on
    return False


def job_context_names(job_id, job):
    """The check-run context name(s) a job produces: its `name:` or the job id."""
    name = job.get("name") if isinstance(job, dict) else None
    return name if name else job_id


# A workflow may list `merge_group` in `on:` yet still fail to report a given
# check there, because the *job* is conditionally skipped on merge_group. GitHub
# treats a skipped required check as never-reporting, so the merge queue wedges
# exactly as if the workflow were PR-only (GOL-1735 / GOL-1953). The audit must
# therefore look past `on:` to per-job `if:` and `needs:`.
_EVENT_NAME_RE = re.compile(r"github\.event_name")


def if_excludes_merge_group(cond):
    """Heuristic: does this job `if:` deterministically skip on `merge_group`?

    Conservative — only True when the condition keys on `github.event_name` and
    never mentions `merge_group` (e.g. `if: github.event_name == 'pull_request'`,
    the exact gate on dependency-review / codeql preflights that makes them skip
    on the queue). We deliberately do NOT try to evaluate arbitrary expressions;
    a false negative just falls back to the old on:-only behaviour, while a false
    positive would wrongly fail a healthy required check.
    """
    if not cond or not isinstance(cond, str):
        return False
    if "merge_group" in cond:
        return False
    return bool(_EVENT_NAME_RE.search(cond))


def _needs_of(job):
    n = (job or {}).get("needs") if isinstance(job, dict) else None
    if n is None:
        return []
    return [n] if isinstance(n, str) else list(n)


def merge_group_unsafe_jobs(jobs):
    """Set of job ids that will NOT report on merge_group: their own `if:`
    excludes it, OR they `needs:` a job that is itself skipped on merge_group
    (a skipped dependency skips the dependent). Computed to a fixpoint."""
    unsafe = {jid for jid, j in jobs.items()
              if if_excludes_merge_group((j or {}).get("if") if isinstance(j, dict) else None)}
    changed = True
    while changed:
        changed = False
        for jid, j in jobs.items():
            if jid in unsafe:
                continue
            if any(dep in unsafe for dep in _needs_of(j)):
                unsafe.add(jid)
                changed = True
    return unsafe


def load_workflows():
    """[(path, has_merge_group, {context_name: {"templated": bool, "mg_safe": bool}})]

    mg_safe is False when the producing job is skipped on merge_group (its `if:`
    excludes it, or it `needs:` a job that is). A context is only a valid
    merge_group producer when the workflow triggers on merge_group AND the job is
    mg_safe."""
    out = []
    paths = sorted(glob.glob(os.path.join(WF_DIR, "*.yml")) +
                   glob.glob(os.path.join(WF_DIR, "*.yaml")))
    for path in paths:
        with open(path) as f:
            raw = f.read()
        try:
            doc = yaml.safe_load(raw)
        except yaml.YAMLError as e:
            print(f"::error file={path}::unparseable workflow YAML: {e}")
            out.append((path, False, {}))
            continue
        if not isinstance(doc, dict):
            continue
        # PyYAML parses the bare key `on:` as the boolean True.
        on = doc.get("on", doc.get(True))
        mg = on_has_merge_group(on)
        jobs = doc.get("jobs") or {}
        unsafe = merge_group_unsafe_jobs(jobs)
        contexts = {}
        for job_id, job in jobs.items():
            ctx = job_context_names(job_id, job)
            contexts[ctx] = {"templated": ("${{" in ctx),
                             "mg_safe": job_id not in unsafe}
        # Commit-status contexts posted via the statuses API (not job names). We
        # cannot tie these to a job, so assume mg_safe (conservative — avoids a
        # false failure on a status that does report).
        for _q, ctx in STATUS_CTX_RE.findall(raw):
            contexts.setdefault(ctx, {"templated": ("${{" in ctx), "mg_safe": True})
        out.append((path, mg, contexts))
    return out


def static_audit():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    required = manifest.get("required_contexts", [])
    workflows = load_workflows()

    failures = []
    print(f"Auditing {len(required)} required context(s) against "
          f"{len(workflows)} workflow(s):\n")
    for ctx in required:
        producers = [(path, mg, ctxs[ctx]) for (path, mg, ctxs) in workflows if ctx in ctxs]
        if not producers:
            # Also flag templated names that *might* match, to avoid a false miss.
            templated = [path for (path, _mg, ctxs) in workflows
                         for name, meta in ctxs.items() if meta["templated"]]
            hint = (f" (workflows with templated job/status names that may produce "
                    f"it: {sorted(set(templated))})") if templated else ""
            failures.append(f"required check '{ctx}' is produced by NO workflow "
                            f"job or status — renamed or removed?{hint}")
            print(f"  ✗ {ctx!r}: no producing workflow found")
            continue
        on_mg = [p for (p, mg, _m) in producers if mg]
        if not on_mg:
            paths = ", ".join(os.path.basename(p) for (p, _mg, _m) in producers)
            failures.append(f"required check '{ctx}' is PR-only — its workflow(s) "
                            f"[{paths}] do not trigger on `merge_group`; the merge "
                            f"queue will wedge. Add `merge_group:` to `on:`.")
            print(f"  ✗ {ctx!r}: produced by [{paths}] but none trigger on merge_group")
            continue
        # Workflow triggers on merge_group — but is the producing JOB actually
        # reached there, or is it skipped by an `if:`/`needs:` gate (GOL-1953)?
        safe_mg = [p for (p, mg, meta) in producers if mg and meta["mg_safe"]]
        if not safe_mg:
            paths = ", ".join(os.path.basename(p) for (p, mg, _m) in producers if mg)
            failures.append(f"required check '{ctx}' is skipped on `merge_group` — "
                            f"its job in [{paths}] is gated by an `if:` that excludes "
                            f"merge_group (or `needs:` a job that is), so it never "
                            f"reports and the merge queue will wedge. Make the job "
                            f"run unconditionally on merge_group before requiring it.")
            print(f"  ✗ {ctx!r}: produced by [{paths}] on merge_group but the job is skipped there")
            continue
        print(f"  ✓ {ctx!r}: {os.path.basename(safe_mg[0])} triggers on merge_group")

    print()
    if failures:
        for msg in failures:
            print(f"::error::{msg}")
        print(f"\nFAIL: {len(failures)} required check(s) would not report on the "
              f"merge queue.")
        return 1
    print("PASS: every required check reports on `merge_group`.")
    return 0


def _api_get(url, token):
    """GET a GitHub API URL. Returns (data, None) or (None, http_status)."""
    import urllib.error
    import urllib.request
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp), None
    except urllib.error.HTTPError as e:
        return None, e.code


def reconcile():
    token = os.environ.get("GH_TOKEN")
    repo = os.environ.get("GH_REPO")
    if not token or not repo:
        print("::error::--reconcile needs GH_TOKEN and GH_REPO=owner/repo.")
        return 2
    with open(MANIFEST) as f:
        manifest = json.load(f)
    branch = manifest.get("branch", "main")
    declared = sorted(manifest.get("required_contexts", []))

    live = set()
    auth_failures = 0
    sources = 0

    # 1) Classic branch protection required status checks.
    prot, err = _api_get(
        f"https://api.github.com/repos/{repo}/branches/{branch}"
        f"/protection/required_status_checks", token)
    if prot is not None:
        sources += 1
        for c in prot.get("checks", []):
            live.add(c["context"])
    elif err in (401, 403):
        auth_failures += 1
    # 404 == branch simply has no classic protection (config lives in a ruleset);
    # that is a legitimate empty source, not an auth failure.

    # 2) Ruleset-based required status checks effective on the branch.
    rules, err = _api_get(
        f"https://api.github.com/repos/{repo}/rules/branches/{branch}", token)
    if rules is not None:
        sources += 1
        if isinstance(rules, list):
            for r in rules:
                if r.get("type") == "required_status_checks":
                    for c in r.get("parameters", {}).get("required_status_checks", []):
                        ctx = c.get("context")
                        if ctx:
                            live.add(ctx)
    elif err in (401, 403):
        auth_failures += 1

    # We can only trust `live` if BOTH admin-gated reads completed without an
    # authorization rejection. If ANY read returned 401/403 the live picture is
    # partial, and comparing it against `declared` would emit a *phantom* drift:
    # the ruleset endpoint (/rules/branches) needs only metadata:read and happily
    # answers 200 for the default GITHUB_TOKEN, while the classic-protection
    # endpoint 403s — so a classic-protection repo read without an admin token
    # yields sources>=1 with live=[] and false-reports "drift" (GOL-1907: this is
    # exactly the phantom `live=[]` the pre-token weekly cron produced). So on any
    # auth failure we never compare; we decide skip-vs-fail purely on whether an
    # admin token was provisioned.
    if auth_failures:
        # An admin token that is present but rejected is a hard error — a silent
        # skip is how the reconcile leg stayed invisible fleet-wide, and how an
        # expired fine-grained PAT (capped at 1yr) would silently revert every
        # repo on a one-year timer. Absence of the token is the legitimate
        # opt-out: the default GITHUB_TOKEN provably cannot read classic branch
        # protection, so soft-skip with a notice.
        if os.environ.get("REQUIRED_CHECKS_ADMIN_TOKEN_SET") == "true":
            print(f"::error::--reconcile FAILED: REQUIRED_CHECKS_ADMIN_TOKEN is set "
                  f"but was rejected (401/403) reading branch-protection / rulesets "
                  f"on {repo}@{branch}. The credential is present but under-scoped or "
                  f"expired — grant it fine-grained Administration: read (or a classic "
                  f"token with `repo` scope + admin) so the live drift check can run. "
                  f"Refusing to soft-skip a present-but-insufficient token.")
            return 1
        print(f"::warning::--reconcile skipped: no REQUIRED_CHECKS_ADMIN_TOKEN "
              f"provisioned; the default GITHUB_TOKEN cannot read branch-protection "
              f"on {repo}@{branch}. Provision an admin-scoped "
              f"REQUIRED_CHECKS_ADMIN_TOKEN secret (fine-grained: Administration "
              f"read) to enable the live drift check; the static audit above still "
              f"gates.")
        return 0

    live = sorted(live)
    if live == declared:
        print(f"PASS: required-checks.json matches live required checks: {live}")
        return 0
    print(f"::error::required-checks.json drift — declared={declared} live={live}")
    print("Update .github/required-checks.json to match, then re-run the static "
          "audit so the new checks are verified against merge_group.")
    return 1


def main():
    mode_reconcile = "--reconcile" in sys.argv[1:]
    rc = static_audit()
    if mode_reconcile:
        rc = reconcile() or rc
    return rc


if __name__ == "__main__":
    sys.exit(main())
