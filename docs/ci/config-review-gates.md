# P0 CI review gates — config-freeze, `fix:`-touches-a-test, merge_group audit

**GOL-1735 / GOL-1406-D.** Implements the three P0 CI checks from Josh's
"Human Code / Agent Code" proposal (GOL-1406). The theme of that proposal is
*review by blast radius, with checks that test behaviour, not just form* — and
that none of our CI would have caught the failures we actually had (URL/webhook
changes, regressions of fixed behaviour, merge-queue wedges). These three gates
target exactly those classes.

All three are engineered so they can safely become **required** checks: each
reports on `merge_group`, so promoting them will not wedge the merge queue.
Making a check *required* is a branch-protection change and is Josh's UI step
(per the proposal's §9 split — agents do not flip required checks); this PR ships
the checks as **enforcing-but-not-yet-required** and documents the flip below.

---

## 1. Config-freeze lock — `.github/workflows/config-freeze.yml`

A repo-level **hard stop** on config drift, driven by `.github/config-freeze.json`.

```jsonc
{ "frozen": false, "reason": "", "paths": [ ".github/workflows/**", "infra/terraform/**", ... ] }
```

- `frozen: false` (default) → the check always passes. Normal Tier-0 human
  approval still governs those paths via `protected-paths-guard`.
- `frozen: true` → **any** PR that touches a path in `paths` fails the
  `Config freeze` check, overriding approval. This is the incident / deploy-window
  / market-season switch: stop *all* config change, then flip back to false.

**Runbook — engage / lift a freeze**

1. Edit `.github/config-freeze.json`, set `frozen: true` and a `reason`.
2. Open a PR. `.github/config-freeze.json` is itself a protected path, so an
   allowlisted human SHA-bound approval is required to land the freeze (and to
   lift it). The file is deliberately **not** in its own `paths`, so a freeze can
   always be lifted.
3. While frozen, config PRs fail with the reason. Lift by setting
   `frozen: false`.

The check reads the manifest from the **base** branch via the contents API and
never checks out or runs PR code (same self-protecting posture as
`protected-paths-guard`).

## 2. `fix:` touches a test — `.github/workflows/fix-touches-test.yml`

A regression-guard convention: a change that claims to **fix** a bug must also
touch a test, so the fixed behaviour can't silently regress.

- **Trigger**: PR title *or* any commit subject matches the Conventional-Commits
  `fix` type (`fix:`, `fix(scope):`, `fix!:`).
- **Requirement**: at least one added/modified file matches a test glob
  (`**/*.test.*`, `**/*.spec.*`, `**/*_test.*`, `**/__tests__/**`, `**/tests/**`,
  `scripts/tests/**`, …).
- **Escape hatch**: label `fix-no-test` bypasses the check (for fixes with no
  testable surface — pure infra/config/docs). The author must justify it in a
  PR comment.

> **Convention owner:** the exact `fix:` detection, the test globs, and the
> escape-hatch label are the review-lane convention **Ada** owns for the
> app/plugin code. The constants in the workflow are the proposed default and
> are adjustable in review — please confirm on this PR.

## 3. All-required-checks-on-merge_group audit

- `.github/required-checks.json` — the declared list of required status-check
  contexts for `main`.
- `.github/workflows/required-checks-audit.yml` + `.github/scripts/audit-required-merge-group.py`.
  - **Static** (PR touching workflows/manifest, `merge_group`, push): asserts
    every declared required context is produced by a job whose workflow lists
    `merge_group`. A required check that is PR-only would leave the merge queue
    stuck at *"Expected — waiting for status"*; this turns that into a loud
    pre-merge error.
  - **Reconcile** (weekly + manual): compares `required-checks.json` to live
    branch protection and fails on drift, so the declared list can't diverge
    from reality.

**Current audit result (AgenticOS):** PASS. Required contexts are `Lint`,
`Typecheck`, `Unit tests`, `Build` — all produced by `ci.yml`, which triggers on
`merge_group`. No required check is PR-only.

---

## Promoting a gate to *required* (Josh's UI step)

After a gate is green on `main`:

1. Repo → **Settings → Branches → `main`** (or the ruleset) → **Require status
   checks to pass** → add the context (`Config freeze`, `fix touches a test`,
   `Required-checks audit`).
2. Add the same context to `.github/required-checks.json` and let the audit
   confirm it reports on `merge_group` (it does — verified by this PR).

Because every gate here already reports on `merge_group`, adding it to the
required set will **not** wedge the queue.
