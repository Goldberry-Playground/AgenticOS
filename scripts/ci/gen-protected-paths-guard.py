#!/usr/bin/env python3
"""GOL-1406 / GOL-1478 / GOL-1733: generate the per-repo protected-paths
artifacts — the protected-paths-guard workflow AND .github/CODEOWNERS.

The workflow logic is byte-identical across all four repos; only PROTECTED_GLOBS
and a one-line repo tag differ. CODEOWNERS mirrors the same protected surface
(GOL-1733). Keeping a single generator here means neither list can silently
drift between repos (the workflow is itself self-protecting once merged, so any
future edit needs an allowlisted human's SHA-bound approving review).

GOL-1478 replaces the earlier `human-approved`-label gate (and its spoofable
commit-date recency check) with a SHA-bound approving review: an allowlisted
human must submit an APPROVED review whose server-set `commit_id` equals the
CURRENT head SHA. `commit_id` is assigned by GitHub to the exact reviewed
commit, so — unlike a git author/committer date — it cannot be forged by
backdating a commit. Any new commit changes the head SHA and invalidates every
prior approval. Read-only, no new permissions."""
import os

# Single source of truth for BOTH per-repo artifacts (GOL-1733):
#   * `.github/workflows/protected-paths-guard.yml`  (PROTECTED_GLOBS = "globs")
#   * `.github/CODEOWNERS`                            ("codeowners" entries)
# The guard is the ACTIVE enforcement (a required check); CODEOWNERS mirrors the
# same protected surface for GitHub-native code-owner review once a ruleset with
# "Require review from Code Owners" is enabled. Generating both here keeps the
# two lists from silently drifting apart.
#
# The "globs" are the narrow tier-0 (money/gate/infra) surface enforced by the
# guard. `.github/workflows/**` is prepended to every repo's guard list (the
# workflow is self-protecting). Every glob below was confirmed to match >=1 real
# file on origin/main (GOL-1733 verify-list report d5ba1ea3); zero-match globs
# were dropped.
#
# CODEOWNERS is allowed to be slightly coarser than the guard (whole-dir
# ownership) — it is a review-routing hint, not the merge gate.
OWNER = "@EngineeringMoonBear"

REPOS = {
    "AgenticOS": {
        "tag": "AgenticOS",
        "globs": [
            "infra/terraform/cloudflare-qa-webhook.tf",
            "packages/github-sync-plugin/**/manifest*",
            "scripts/deploy-plugin.sh",
            "infra/terraform/github-*.tf",
        ],
        # Preserves the hand-curated CODEOWNERS from the 2026-07-12 security
        # review (finding M2) verbatim; broader than the guard by design.
        "codeowners_header": (
            "# CODEOWNERS — sensitive paths that must not merge on agent auto-approval\n"
            "# alone (security review 2026-07-12, finding M2).\n"
            "#\n"
            "# ENFORCEMENT NOTE: CODEOWNERS review-requirement only binds when a branch\n"
            "# protection ruleset with \"Require review from Code Owners\" is enabled. Until\n"
            "# that ruleset exists, the auto-approve workflow enforces the SAME list\n"
            "# operationally: agent PRs touching these paths are never auto-approved or\n"
            "# auto-merged (see .github/workflows/auto-approve.yml). Keep the two lists in\n"
            "# sync.\n"
            "#\n"
            "# Rationale per path:\n"
            "#   .github/           — workflows are the merge/deploy gates themselves\n"
            "#   infra/             — terraform + cloud-init: infra takeover surface\n"
            "#   docker-compose.yml — service topology, port bindings, secret mounts\n"
            "#   scripts/agent-git/ — GitHub App token broker (credential surface)\n"
            "#   packages/credential-broker/ — 1Password secret broker (credential surface)\n"
            "#   .gitleaks.toml     — weakening secret-scanning from a PR\n"
            "#   Dockerfile*        — image provenance"
        ),
        "codeowners": [
            "/.github/",
            "/infra/",
            "/docker-compose.yml",
            "/docker-compose.override.example.yml",
            "/scripts/agent-git/",
            "/packages/credential-broker/",
            "/.gitleaks.toml",
            "Dockerfile*",
        ],
        # AgenticOS aligns owners at column 32 (pad 31 + one space); the single
        # over-length pattern overflows with one space. Preserve that width so
        # regeneration is a byte-for-byte round-trip (no spurious diff).
        "codeowners_pad": 31,
    },
    "odoocker": {
        "tag": "odoocker-goldberrygrove",
        # There is NO top-level `terraform/` dir; the real IaC lives under
        # `infra/terraform/**` (128 files). `nginx/**` (6 files) is edge routing
        # + CORS/security-header config = gate-critical.
        "globs": [
            "infra/terraform/**",
            "nginx/**",
        ],
        "codeowners": [
            "/.github/",
            "/infra/terraform/",
            "/nginx/",
        ],
    },
    "grove-sites": {
        "tag": "grove-sites",
        # Checkout / publish-webhook money path (all present on origin/main).
        # `.github/config-freeze.json` is the config-freeze lock manifest
        # (GOL-1735 / GOL-1812): engaging OR lifting a freeze edits this file,
        # and that must take the same EngineeringMoonBear SHA-bound approval as
        # any protected path — otherwise an agent can self-lift its own freeze
        # (frozen:true -> false) with 0 humans. It is deliberately NOT one of
        # the freeze's own `paths`, so a freeze can always be lifted; the guard
        # is what makes that lift require a human.
        "globs": [
            ".github/config-freeze.json",
            "apps/*/app/api/checkout/route.ts",
            "apps/*/app/api/checkout/session/route.ts",
            "apps/*/app/api/webhooks/publish/route.ts",
            "packages/checkout/**",
            "apps/*/tenant.config.ts",
            "apps/hub/data/marketplace.ts",
        ],
        # `ownership.yml` moves from the guard list to CODEOWNERS: governance
        # metadata belongs to code-owner review, not the money-path merge gate.
        "codeowners": [
            "/.github/",
            "/ownership.yml",
            "apps/*/app/api/checkout/route.ts",
            "apps/*/app/api/checkout/session/route.ts",
            "apps/*/app/api/webhooks/publish/route.ts",
            "/packages/checkout/",
            "apps/*/tenant.config.ts",
            "/apps/hub/data/marketplace.ts",
        ],
    },
    "grove-odoo-modules": {
        "tag": "grove-odoo-modules",
        # Payment/Stripe/webhook boundary. `**/*webhook*` (not `*.py`) so it
        # covers the existing `publish-webhook-contract.md` boundary doc AND any
        # future webhook handler; the `.py`-suffixed form matched zero files.
        # Dropped the zero-match `grove_headless/**/auth*.py` and
        # `grove_headless/controllers/order*` proposals.
        "globs": [
            "**/*payment*.py",
            "**/*stripe*",
            "**/*webhook*",
        ],
        "codeowners": [
            "/.github/",
            "**/*payment*.py",
            "**/*stripe*",
            "**/*webhook*",
        ],
    },
}

TEMPLATE = r'''# Protected paths guard  —  GOL-1406 / GOL-1402 / GOL-1478 (org-wide spec).
#
# Sync-critical and gate-critical files require a HUMAN SHA-bound approving
# review to merge. A PR that touches any protected path fails this (required)
# check unless an allowlisted human has submitted an APPROVED review on the
# CURRENT head commit.
#
# SHA-binding (GOL-1478): the gate checks that an allowlisted human's APPROVED
# review has `commit_id === headSha`. `commit_id` is server-assigned by GitHub
# to the exact reviewed commit, so it cannot be forged by backdating a commit
# (`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` are pusher-controlled; a review's
# `commit_id` is not). Any new commit changes the head SHA and drops every
# prior approval, so a follow-on (even backdated) protected-path commit fails
# the guard until it is re-reviewed.
#
# The `human-approved` label is NO LONGER a gate — it is retained only as an
# optional manual re-run nudge (its `labeled` event re-triggers this workflow
# in case the review event does not refresh the check). Approving the PR is the
# single action that satisfies the guard.
#
# Self-protection: `.github/workflows/**` is protected (covers this file and
# auto-approve.yml), and the job runs on `pull_request_target` /
# `pull_request_review` — i.e. from the BASE branch definition with API-only
# access and no PR checkout — so a PR cannot edit this workflow to neuter its
# own guard. Same philosophy as auto-approve.yml's workflow_run trigger.
#
# Merge queue (GOL-1406): this check is REQUIRED, and a required check must
# report on the merge group or the queue wedges ("Expected — waiting for
# status"). We therefore also trigger on `merge_group` and report success
# there: the PR-level `pull_request_target` gate is what a PR must satisfy to
# be enqueued, so a protected-path PR can only enter the queue AFTER an
# allowlisted human's SHA-bound approval. The merge-group commit is synthetic
# (approved PR head + base), introduces no new protected-path content, and has
# no PR/review context to bind to — so enforcement stays at the PR gate and the
# merge group passes. Mirrors ci.yml, which already runs on `merge_group`.
#
# ONE shared implementation, generated for every repo from
# gen-protected-paths-guard.py; only PROTECTED_GLOBS differs per repo. Repo: {TAG}
name: Protected paths guard

on:
  pull_request_target:
    types: [opened, synchronize, reopened, labeled, unlabeled]
  pull_request_review:
    types: [submitted, dismissed, edited]
  merge_group:

permissions:
  contents: read
  pull-requests: read
  issues: read

concurrency:
  group: protected-paths-${{ github.event.pull_request.number || github.event.merge_group.head_sha || github.run_id }}
  cancel-in-progress: true

jobs:
  guard:
    name: Protected paths guard
    runs-on: ubuntu-latest
    steps:
      - name: Enforce human SHA-bound approval on protected paths
        uses: actions/github-script@v9
        with:
          script: |
            // Merge-queue pass-through (GOL-1406). On `merge_group` there is no
            // PR/review context and the commit is a synthetic merge of an
            // already-approved PR head with the base. Enforcement happened at
            // the required `pull_request_target` gate the PR had to pass to be
            // enqueued, so report success here to satisfy the required check for
            // the merge group instead of throwing on the missing PR payload.
            if (context.eventName === 'merge_group') {
              core.info('merge_group event — protected-path enforcement happens ' +
                'at the PR gate (required to enqueue); passing for the merge group.');
              return;
            }

            // Human allowlist — an approving review from anyone NOT in this
            // list (including bots/Apps) does not count. Mirrors
            // auto-approve.yml.
            const HUMAN_ALLOWLIST = ['EngineeringMoonBear'];

            // Protected globs for THIS repo. `.github/workflows/**` is shared
            // across all repos and is self-protecting.
            const PROTECTED_GLOBS = [
{GLOBS}
            ];

            const { owner, repo } = context.repo;
            const number = context.payload.pull_request.number;

            // glob -> RegExp (supports **, *, and literals; '/' is literal)
            function globToRe(g) {
              let re = '^';
              for (let i = 0; i < g.length; i++) {
                const c = g[i];
                if (c === '*') {
                  if (g[i + 1] === '*') {
                    i++;
                    if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; }
                    else { re += '.*'; }
                  } else {
                    re += '[^/]*';
                  }
                } else if ('\\^$.|?+()[]{}/'.includes(c)) {
                  re += '\\' + c;
                } else {
                  re += c;
                }
              }
              return new RegExp(re + '$');
            }
            const matchers = PROTECTED_GLOBS.map(globToRe);

            // Re-fetch the PR so head.sha is authoritative: the event payload
            // can be stale on labeled/review activity, and the head SHA is the
            // value the whole gate binds to.
            const { data: pr } = await github.rest.pulls.get({
              owner, repo, pull_number: number,
            });
            const headSha = pr.head.sha;

            // Changed files (paginated).
            const files = await github.paginate(github.rest.pulls.listFiles, {
              owner, repo, pull_number: number, per_page: 100,
            });
            const hits = files
              .map(f => f.filename)
              .filter(fn => matchers.some(re => re.test(fn)));

            if (hits.length === 0) {
              core.info('No protected paths touched by this PR — guard passes.');
              return;
            }
            core.warning('Protected paths touched:\n  ' + hits.join('\n  '));

            const ASK =
              'Have an allowlisted human (' + HUMAN_ALLOWLIST.join(', ') +
              ') submit an APPROVING review on the current commit ' +
              headSha.slice(0, 7) + '.';

            // SHA-bound approval. Walk reviews (ascending submission order) and
            // resolve each allowlisted human's EFFECTIVE state = their latest
            // APPROVED / CHANGES_REQUESTED / DISMISSED review (COMMENTED and
            // PENDING reviews do not set a state), mirroring GitHub's own
            // review-state resolution. A bot/App identity never counts.
            const reviews = await github.paginate(github.rest.pulls.listReviews, {
              owner, repo, pull_number: number, per_page: 100,
            });
            const effective = new Map(); // login -> { state, commit_id }
            for (const rv of reviews) {
              const login = rv.user && rv.user.login;
              const type = rv.user && rv.user.type;
              if (!login || type === 'Bot' || !HUMAN_ALLOWLIST.includes(login)) continue;
              if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(rv.state)) {
                effective.set(login, { state: rv.state, commit_id: rv.commit_id });
              }
            }

            let approver = null;
            for (const [login, r] of effective) {
              if (r.state === 'APPROVED' && r.commit_id === headSha) { approver = login; break; }
            }

            if (!approver) {
              // Distinguish "approved, but a newer commit landed" for a clear
              // message — this is exactly the (possibly backdated) follow-on
              // commit that the SHA binding rejects.
              const stale = [...effective].find(([, r]) => r.state === 'APPROVED');
              if (stale) {
                core.setFailed(
                  'Allowlisted human `' + stale[0] + '` approved commit ' +
                  String(stale[1].commit_id || 'unknown').slice(0, 7) +
                  ', but the current head is ' + headSha.slice(0, 7) +
                  '. A new commit invalidates prior approvals (backdating cannot ' +
                  'forge a review\'s commit_id). Re-review the current commit.\n' + ASK
                );
              } else {
                core.setFailed(
                  'This PR changes protected paths but has no APPROVED review from ' +
                  'an allowlisted human bound to the current commit ' +
                  headSha.slice(0, 7) + '.\n' + ASK
                );
              }
              return;
            }

            core.info(
              'Protected paths approved by allowlisted human `' + approver +
              '` on head ' + headSha.slice(0, 7) + ' — guard passes.'
            );
'''


def render_workflow(tag, extra_globs):
    globs = ["                '.github/workflows/**',"]
    for g in extra_globs:
        globs.append("                '%s'," % g)
    return TEMPLATE.replace("{TAG}", tag).replace("{GLOBS}", "\n".join(globs))


DEFAULT_CODEOWNERS_HEADER = (
    "# CODEOWNERS — protected paths for {TAG} (GOL-1406 / GOL-1733).\n"
    "#\n"
    "# Mirrors PROTECTED_GLOBS in .github/workflows/protected-paths-guard.yml.\n"
    "# The guard workflow is the ACTIVE required check; this file additionally\n"
    "# routes GitHub-native code-owner review once a branch-protection ruleset\n"
    "# with \"Require review from Code Owners\" is enabled. Keep the two in sync\n"
    "# via scripts/ci/gen-protected-paths-guard.py in the AgenticOS repo."
)


def render_codeowners(cfg):
    header = cfg.get("codeowners_header") or DEFAULT_CODEOWNERS_HEADER.replace(
        "{TAG}", cfg["tag"]
    )
    entries = cfg["codeowners"]
    pad = cfg.get("codeowners_pad") or max(len(p) for p in entries)
    lines = [header, ""]
    for pat in entries:
        lines.append("%-*s %s" % (pad, pat, OWNER))
    return "\n".join(lines) + "\n"


# ─── GOL-1406-A: Tier-0 carve-out consumed by each repo's auto-approve.yml ───
#
# The protected-paths-guard above is the merge gate, but it is not (yet) a
# REQUIRED branch-protection check — Josh's flip (step 8) hasn't happened. Until
# it does, an agent-authored PR touching a protected path would still be
# auto-approved + auto-merged, because none of the four auto-approve.yml
# workflows check `changed files ∩ PROTECTED_GLOBS = ∅`. This standalone script,
# invoked from each auto-approve.yml before it stamps its approval, closes that
# hole: it WITHHOLDS auto-approval whenever the change set intersects the SAME
# PROTECTED_GLOBS the guard uses. Strictly one-way-tighter — it never loosens
# any existing author/size gate.
#
# It is generated from the SAME REPOS table as the guard, so the carve-out and
# the guard can never disagree about what "protected" means, and a later glob
# correction (item B) flows to both from one edit. `globToRe` is kept
# byte-for-byte identical to the guard's matcher (asserted by
# scripts/ci/protected-paths-carveout.test.mjs).
CARVEOUT_TEMPLATE = r'''#!/usr/bin/env node
// protected-paths-carveout.mjs — Tier-0 carve-out for auto-approve (GOL-1406-A).
//
// GENERATED from scripts/ci/gen-protected-paths-guard.py — do not edit by hand;
// edit the generator and regenerate. Only PROTECTED_GLOBS differs per repo.
//
// Why this exists: the protected-paths-guard.yml merge gate is not yet a
// REQUIRED branch-protection check. Until it is, an agent PR touching a
// protected path would still be auto-approved + merged. This script, called by
// auto-approve.yml before it stamps its approval, WITHHOLDS approval whenever
// the PR's changed files intersect PROTECTED_GLOBS — the SAME list the guard
// enforces, so the two can never disagree. Defense-in-depth, strictly
// one-way-tighter: it only ever withholds, never loosens author/size gates.
//
// Contract (CLI):
//   env PR_FILES = newline-separated changed paths (`gh pr view --json files
//                  -q '.files[].path'`).
//   exit 0 -> no protected path touched; caller may proceed to approve.
//   exit 1 -> a protected path is touched; reason on stdout; caller WITHHOLDS.
// Fail-closed: the workflow runs this inside an `if` whose false branch
// withholds, so a throw / missing file / nonzero exit all withhold approval.
import { pathToFileURL } from "node:url";

// PROTECTED_GLOBS for THIS repo — the only thing that differs between repos.
// `.github/workflows/**` is shared and self-protecting (covers this file, the
// guard, and auto-approve.yml).
export const PROTECTED_GLOBS = [
{GLOBS}
];

// glob -> RegExp (supports **, *, and literals; '/' is literal). MUST stay
// byte-for-byte equivalent to the guard's globToRe in protected-paths-guard.yml
// — both are generated from this one source and the test asserts they match.
export function globToRe(g) {
  let re = '^';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; }
        else { re += '.*'; }
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}/'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(re + '$');
}

// The protected paths a change set touches (empty => safe to auto-approve).
export function protectedHits(files, globs = PROTECTED_GLOBS) {
  const matchers = globs.map(globToRe);
  return files
    .map((f) => (f || "").trim())
    .filter(Boolean)
    .filter((fn) => matchers.some((re) => re.test(fn)));
}

// CLI entrypoint — only when executed directly, not when imported by the test.
// pathToFileURL (not a naive `file://${path}`) so a script path needing
// URL-encoding still matches, mirroring automerge-gate.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = (process.env.PR_FILES || "").split("\n");
  const hits = protectedHits(files);
  if (hits.length === 0) {
    process.stdout.write("no protected path touched — carve-out clear");
    process.exit(0);
  }
  process.stdout.write(
    "protected path(s) touched, withholding auto-approval (GOL-1406-A carve-out): " +
      hits.join(", ") +
      " — needs an allowlisted human's SHA-bound approving review (protected-paths-guard)."
  );
  process.exit(1);
}
'''


def render_carveout(extra_globs):
    globs = ["  '.github/workflows/**',"]
    for g in extra_globs:
        globs.append("  '%s'," % g)
    return CARVEOUT_TEMPLATE.replace("{GLOBS}", "\n".join(globs))


# ─── GOL-1920: wire the carve-out ≡ guard invariant into required CI ─────────
#
# The carve-out (protected-paths-carveout.mjs) and the guard
# (protected-paths-guard.yml) are both generated from this file, and
# scripts/ci/protected-paths-carveout.test.mjs asserts they stay identical
# (same PROTECTED_GLOBS + same glob→RegExp matcher). But that test was never
# RUN in CI on any repo, so the two silently drifted on odoocker &
# grove-odoo-modules (GOL-1912) — the carve-out grew LOOSER than the guard, so
# auto-approve could have stamped a PR the human-approval gate blocks. This
# workflow runs that invariant on every PR / push / merge_group so drift can
# never reach main unnoticed again. Byte-identical across all carve-out repos:
# the test path and the guard/carve-out filenames are the same everywhere, so
# there is nothing per-repo to template. Lives under .github/workflows/** →
# self-protected by the guard, and reads no secrets (pure Node built-in test
# runner: no install, no network).
INVARIANT_TEMPLATE = r'''# Protected paths carve-out ≡ guard invariant  —  GOL-1920 (org-wide).
#
# Runs scripts/ci/protected-paths-carveout.test.mjs, which asserts that the
# Tier-0 list in scripts/ci/protected-paths-carveout.mjs (what auto-approve.yml
# uses to WITHHOLD auto-approval) stays byte-for-byte in sync with the
# PROTECTED_GLOBS and glob→RegExp matcher in
# .github/workflows/protected-paths-guard.yml (the human-approval merge gate).
# If the two drift, auto-approve could stamp a PR the guard blocks — the exact
# hole GOL-1406-A closed and GOL-1912 found reopened by drift. This makes the
# invariant a CI check so that can never silently reach main again.
#
# Pure Node built-in test runner: no dependency install, no secrets, no
# network. Runs on `pull_request` (validates the PR's merged tree at head),
# `push` to main, and `merge_group` — a REQUIRED check must report on the merge
# group or the queue wedges ("Expected — waiting for status"), and the merge
# commit contains the same files, so the invariant is checked there too.
#
# GENERATED for every carve-out repo from gen-protected-paths-guard.py in the
# AgenticOS repo — byte-identical across repos; edit the generator, not this
# file. This workflow is under .github/workflows/**, so it is itself covered by
# the protected-paths guard and cannot be neutered without an allowlisted
# human's SHA-bound approving review.
name: Protected paths invariant

on:
  pull_request:
  push:
    branches: [main]
  merge_group:

permissions:
  contents: read

concurrency:
  group: protected-paths-invariant-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  invariant:
    name: carve-out matches guard
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
      - name: Assert carve-out is identical to the protected-paths guard
        run: node --test scripts/ci/protected-paths-carveout.test.mjs
'''


# Base dir holding sibling repo checkouts (…/AgenticOS, …/grove-sites, …).
# Override with $PPG_BASE or argv[1]; defaults to this repo's parent so a fresh
# checkout can regenerate all four repos' artifacts from one source.
import sys

BASE = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get("PPG_BASE")
    or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
for repo_dir, cfg in REPOS.items():
    repo_root = os.path.join(BASE, repo_dir)
    if not os.path.isdir(os.path.join(repo_root, ".github")):
        print("skip (no checkout):", repo_root)
        continue
    wf = os.path.join(repo_root, ".github", "workflows", "protected-paths-guard.yml")
    os.makedirs(os.path.dirname(wf), exist_ok=True)
    with open(wf, "w") as f:
        f.write(render_workflow(cfg["tag"], cfg["globs"]))
    print("wrote", wf)
    co = os.path.join(repo_root, ".github", "CODEOWNERS")
    with open(co, "w") as f:
        f.write(render_codeowners(cfg))
    print("wrote", co)
    # GOL-1406-A: the Tier-0 carve-out that auto-approve.yml calls. Generated
    # from the SAME REPOS row as the guard + CODEOWNERS, so the three can never
    # disagree about what "protected" means. Ported to main's dict-shaped REPOS
    # (cfg["globs"]); it previously read the old (tag, extra) tuple.
    cv = os.path.join(repo_root, "scripts", "ci", "protected-paths-carveout.mjs")
    os.makedirs(os.path.dirname(cv), exist_ok=True)
    with open(cv, "w") as f:
        f.write(render_carveout(cfg["globs"]))
    print("wrote", cv)
    # GOL-1920: CI check that runs the carve-out ≡ guard invariant test on every
    # PR / push / merge_group, so the drift GOL-1912 found can never silently
    # reach main again. Byte-identical across all carve-out repos.
    iv = os.path.join(repo_root, ".github", "workflows", "protected-paths-invariant.yml")
    with open(iv, "w") as f:
        f.write(INVARIANT_TEMPLATE)
    print("wrote", iv)