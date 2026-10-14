#!/usr/bin/env python3
"""Unit tests for audit-required-merge-group.py (static mode).

Run:  python3 .github/scripts/audit-required-merge-group.test.py

Each case builds a throwaway repo root (`.github/workflows/*.yml` +
`.github/required-checks.json`) and runs `static_audit(root=...)` against it,
so the suite needs only PyYAML — the same dependency the audit itself has — and
no network. The needs-closure cases are the GOL-3360 contract: a `needs:` edge
from a required job to a NON-required job must fail the audit with the exact
upstream job named, and the real odoocker shape (smoke test gated behind five
cheap jobs that are all required) must pass.
"""
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "audit_required_merge_group", os.path.join(HERE, "audit-required-merge-group.py"))
audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit)


def run_audit(workflows, required):
    """workflows: {filename: yaml text}. Returns (rc, stdout)."""
    root = tempfile.mkdtemp(prefix="rc-audit-")
    wf_dir = os.path.join(root, ".github", "workflows")
    os.makedirs(wf_dir)
    for name, text in workflows.items():
        with open(os.path.join(wf_dir, name), "w") as f:
            f.write(text)
    with open(os.path.join(root, ".github", "required-checks.json"), "w") as f:
        json.dump({"branch": "main", "required_contexts": required}, f)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = audit.static_audit(root=root)
    return rc, buf.getvalue()


# The odoocker-goldberrygrove ci.yml shape (GOL-1953 2026-10-06 finding): the
# 20-minute smoke test is `needs:`-gated behind five cheap fail-fast jobs.
ODOOCKER_CI = """
name: CI
on:
  pull_request:
    branches: [main]
  merge_group:
  push:
    branches: [main]
jobs:
  actionlint:
    name: actionlint (all workflows)
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  shellcheck:
    name: shellcheck (scripts/)
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  no-tracked-env-files:
    name: Reject tracked .env files
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  lint-python:
    name: Lint Python (Odoo Modules)
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  validate-compose:
    name: Validate Docker Compose (Grove)
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  ssh-payload-escaping:
    name: ssh payload render guard
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  stack-smoke-test:
    name: Backend stack smoke test
    runs-on: ubuntu-latest
    needs: [actionlint, shellcheck, no-tracked-env-files, lint-python, validate-compose]
    steps: [{run: "true"}]
"""

ODOOCKER_REQUIRED = [
    "Validate Docker Compose (Grove)",
    "Lint Python (Odoo Modules)",
    "actionlint (all workflows)",
    "shellcheck (scripts/)",
    "Reject tracked .env files",
    "Backend stack smoke test",
]


class NeedsClosure(unittest.TestCase):
    def test_odoocker_shape_passes_when_every_upstream_is_required(self):
        rc, out = run_audit({"ci.yml": ODOOCKER_CI}, ODOOCKER_REQUIRED)
        self.assertEqual(rc, 0, out)
        self.assertIn("'Backend stack smoke test': needs ['Lint Python (Odoo Modules)', "
                      "'Reject tracked .env files', 'Validate Docker Compose (Grove)', "
                      "'actionlint (all workflows)', 'shellcheck (scripts/)'], all required", out)
        self.assertIn("PASS", out)

    def test_synthetic_needs_on_non_required_job_fails_naming_it(self):
        # The next job someone appends to `needs:` without promoting it. The
        # audit must fail and name the exact upstream job (id AND context).
        ci = ODOOCKER_CI.replace(
            "needs: [actionlint, shellcheck, no-tracked-env-files, lint-python, validate-compose]",
            "needs: [actionlint, shellcheck, no-tracked-env-files, lint-python, validate-compose, ssh-payload-escaping]")
        rc, out = run_audit({"ci.yml": ci}, ODOOCKER_REQUIRED)
        self.assertEqual(rc, 1, out)
        self.assertIn("needs `ssh-payload-escaping` = 'ssh payload render guard', which is not required", out)
        self.assertIn("::error::required check 'Backend stack smoke test' (ci.yml job `stack-smoke-test`) "
                      "transitively needs job `ssh-payload-escaping` = 'ssh payload render guard', "
                      "which is NOT a required check", out)
        # Promoting the upstream closes the gap — the fix the message prescribes.
        rc2, out2 = run_audit({"ci.yml": ci}, ODOOCKER_REQUIRED + ["ssh payload render guard"])
        self.assertEqual(rc2, 0, out2)

    def test_transitive_needs_gap_is_found_and_named(self):
        # required A -> required B -> NON-required C: the gap is C, two hops up.
        ci = """
on: [pull_request, merge_group]
jobs:
  c:
    name: Detect something
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  b:
    name: Build
    runs-on: ubuntu-latest
    needs: c
    steps: [{run: "true"}]
  a:
    name: Integration
    runs-on: ubuntu-latest
    needs: [b]
    steps: [{run: "true"}]
"""
        rc, out = run_audit({"ci.yml": ci}, ["Integration", "Build"])
        self.assertEqual(rc, 1, out)
        self.assertIn("'Integration' (ci.yml job `a`) transitively needs job `c` = 'Detect something'", out)
        self.assertIn("'Build' (ci.yml job `b`) transitively needs job `c` = 'Detect something'", out)
        # Required jobs are NOT flagged as gaps of each other.
        self.assertNotIn("needs job `b` = 'Build', which is NOT", out)

    def test_needs_string_form_and_unknown_job_id(self):
        ci = """
on: [pull_request, merge_group]
jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  build:
    name: Build
    runs-on: ubuntu-latest
    needs: lint
    steps: [{run: "true"}]
  deploy-check:
    name: Deploy check
    runs-on: ubuntu-latest
    needs: [build, does-not-exist]
    steps: [{run: "true"}]
"""
        rc, out = run_audit({"ci.yml": ci}, ["Lint", "Build"])
        self.assertEqual(rc, 0, out)                      # string-form needs, closed
        rc, out = run_audit({"ci.yml": ci}, ["Lint", "Build", "Deploy check"])
        self.assertEqual(rc, 1, out)
        self.assertIn("has `needs: does-not-exist` but no job with id `does-not-exist` exists in ci.yml", out)

    def test_always_gate_job_is_exempt_but_plain_dependent_is_not(self):
        # odoocker prod-plan-guard shape: the required context is an aggregator
        # with `if: ${{ always() }}` that evaluates needs.*.result itself. It
        # is never skipped by a failing upstream, so the edge is safe.
        gate = """
on: [pull_request, merge_group]
jobs:
  detect:
    name: detect prod TF changes
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  prod-plan:
    name: Prod plan must not destroy or replace a live resource
    runs-on: ubuntu-latest
    needs: detect
    if: needs.detect.outputs.changed == 'true'
    steps: [{run: "true"}]
  prod-plan-guard:
    runs-on: ubuntu-latest
    needs: [detect, prod-plan]
    if: GATE_IF
    steps:
      - run: test "${{ needs.prod-plan.result }}" != failure
"""
        rc, out = run_audit({"g.yml": gate.replace("GATE_IF", "${{ always() }}")}, ["prod-plan-guard"])
        self.assertEqual(rc, 0, out)
        self.assertIn("gate job `prod-plan-guard` runs with always()/!cancelled()", out)
        rc, out = run_audit({"g.yml": gate.replace("GATE_IF", "${{ !cancelled() }}")}, ["prod-plan-guard"])
        self.assertEqual(rc, 0, out)
        # Same graph, but the dependent is an ordinary job (skipped on upstream
        # failure): BOTH non-required upstreams are gaps.
        rc, out = run_audit({"g.yml": gate.replace("GATE_IF", "github.event_name != 'push'")}, ["prod-plan-guard"])
        self.assertEqual(rc, 1, out)
        self.assertIn("needs `detect` = 'detect prod TF changes', which is not required", out)
        self.assertIn("needs `prod-plan` = 'Prod plan must not destroy or replace a live resource', which is not required", out)

    def test_walk_stops_at_required_always_job(self):
        # A (required, plain) -> B (required, always()) -> C (non-required).
        # C failing makes B run and fail (observed); A skipping is then moot.
        ci = """
on: [merge_group]
jobs:
  c:
    name: Scan
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  b:
    name: Scan gate
    runs-on: ubuntu-latest
    needs: c
    if: always()
    steps: [{run: "true"}]
  a:
    name: Publish check
    runs-on: ubuntu-latest
    needs: b
    steps: [{run: "true"}]
"""
        rc, out = run_audit({"ci.yml": ci}, ["Publish check", "Scan gate"])
        self.assertEqual(rc, 0, out)
        # ...but if B is NOT required, A's walk must still surface B (and C).
        rc, out = run_audit({"ci.yml": ci}, ["Publish check"])
        self.assertEqual(rc, 1, out)
        self.assertIn("needs `b` = 'Scan gate', which is not required", out)

    def test_status_api_context_has_no_needs_edges(self):
        # A commit status posted via the statuses API is not a job; it has no
        # `needs:` and must not trip the closure check (grove-sites Lighthouse CI).
        ci = """
on: [pull_request, merge_group]
jobs:
  lh:
    name: lighthouse-runner
    runs-on: ubuntu-latest
    needs: prep
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            await github.rest.repos.createCommitStatus({context: 'Lighthouse CI', state: 'success'})
  prep:
    name: Prepare
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
"""
        rc, out = run_audit({"ci.yml": ci}, ["Lighthouse CI"])
        self.assertEqual(rc, 0, out)


class MergeGroupReporting(unittest.TestCase):
    """Regression cover for the pre-existing assertions."""

    def test_pr_only_workflow_fails(self):
        ci = """
on: [pull_request]
jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
"""
        rc, out = run_audit({"ci.yml": ci}, ["Lint"])
        self.assertEqual(rc, 1, out)
        self.assertIn("is PR-only", out)

    def test_job_skipped_on_merge_group_by_if_fails(self):
        ci = """
on: [pull_request, merge_group]
jobs:
  preflight:
    name: Preflight
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps: [{run: "true"}]
  review:
    name: Dependency review
    runs-on: ubuntu-latest
    needs: preflight
    steps: [{run: "true"}]
"""
        rc, out = run_audit({"ci.yml": ci}, ["Dependency review", "Preflight"])
        self.assertEqual(rc, 1, out)
        self.assertIn("is skipped on `merge_group`", out)

    def test_missing_producer_fails(self):
        rc, out = run_audit({"ci.yml": "on: [merge_group]\njobs: {}\n"}, ["Ghost"])
        self.assertEqual(rc, 1, out)
        self.assertIn("produced by NO workflow", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
