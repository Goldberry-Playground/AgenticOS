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


def load_workflows():
    """[(path, has_merge_group, {context_name: templated_bool})]"""
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
        contexts = {}
        for job_id, job in (doc.get("jobs") or {}).items():
            ctx = job_context_names(job_id, job)
            contexts[ctx] = ("${{" in ctx)
        # Commit-status contexts posted via the statuses API (not job names).
        for _q, ctx in STATUS_CTX_RE.findall(raw):
            contexts.setdefault(ctx, ("${{" in ctx))
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
        producers = [(path, mg) for (path, mg, ctxs) in workflows if ctx in ctxs]
        if not producers:
            # Also flag templated names that *might* match, to avoid a false miss.
            templated = [path for (path, _mg, ctxs) in workflows
                         for name, t in ctxs.items() if t]
            hint = (f" (workflows with templated job/status names that may produce "
                    f"it: {sorted(set(templated))})") if templated else ""
            failures.append(f"required check '{ctx}' is produced by NO workflow "
                            f"job or status — renamed or removed?{hint}")
            print(f"  ✗ {ctx!r}: no producing workflow found")
            continue
        on_mg = [p for (p, mg) in producers if mg]
        if not on_mg:
            paths = ", ".join(os.path.basename(p) for (p, _mg) in producers)
            failures.append(f"required check '{ctx}' is PR-only — its workflow(s) "
                            f"[{paths}] do not trigger on `merge_group`; the merge "
                            f"queue will wedge. Add `merge_group:` to `on:`.")
            print(f"  ✗ {ctx!r}: produced by [{paths}] but none trigger on merge_group")
            continue
        print(f"  ✓ {ctx!r}: {os.path.basename(on_mg[0])} triggers on merge_group")

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

    # Soft-skip only when BOTH live reads were unauthorized — i.e. the token
    # genuinely lacks branch-protection/ruleset admin. Otherwise we have a real
    # live picture (possibly empty) to compare against.
    if sources == 0 and auth_failures:
        print(f"::warning::--reconcile skipped: token lacks branch-protection / "
              f"ruleset read admin on {repo}@{branch}. Provision an admin-scoped "
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
