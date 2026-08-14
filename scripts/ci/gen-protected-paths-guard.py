#!/usr/bin/env python3
"""GOL-1406: generate the protected-paths-guard workflow for each repo.

The logic is byte-identical across all four repos; only PROTECTED_GLOBS and a
one-line repo tag differ. Keeping a single generator here means the shared
implementation can't silently drift between repos (the file is itself
self-protecting once merged, so any future edit needs a SHA-bound human
approval).

GOL-1478: the emitted guard binds approval to the head SHA (a review's
server-set `commit_id`), not to a `human-approved` label. A label survives
later pushes, so an approved PR could take follow-on — even backdated —
protected-path commits and still pass; a review's commit_id cannot be forged
that way. Regenerating from an older copy of this file would silently restore
the bypass, which is why the fix belongs HERE and not in one repo's artifact."""
import os

# repo dir -> (repo tag, extra protected globs beyond the shared workflow one)
REPOS = {
    "AgenticOS": (
        "AgenticOS",
        [
            "infra/terraform/cloudflare-qa-webhook.tf",
            "packages/github-sync-plugin/**/manifest*",
            "scripts/deploy-plugin.sh",
            "infra/terraform/github-*.tf",
        ],
    ),
    "odoocker": (
        "odoocker-goldberrygrove",
        [
            "infra/terraform/environments/production/**",
        ],
    ),
    "grove-sites": (
        "grove-sites",
        [
            "ownership.yml",
        ],
    ),
    "grove-odoo-modules": (
        "grove-odoo-modules",
        [
            "ownership.yml",
        ],
    ),
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
# ONE shared implementation, generated for every repo from
# gen-protected-paths-guard.py; only PROTECTED_GLOBS differs per repo. Repo: {TAG}
name: Protected paths guard

on:
  pull_request_target:
    types: [opened, synchronize, reopened, labeled, unlabeled]
  pull_request_review:
    types: [submitted, dismissed, edited]

permissions:
  contents: read
  pull-requests: read
  issues: read

concurrency:
  group: protected-paths-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  guard:
    name: Protected paths guard
    runs-on: ubuntu-latest
    steps:
      - name: Enforce human SHA-bound approval on protected paths
        uses: actions/github-script@v7
        with:
          script: |
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


def render(tag, extra_globs):
    globs = ["                '.github/workflows/**',"]
    for g in extra_globs:
        globs.append("                '%s'," % g)
    return TEMPLATE.replace("{TAG}", tag).replace("{GLOBS}", "\n".join(globs))


# Base dir holding sibling repo checkouts (…/AgenticOS, …/grove-sites, …).
# Override with $PPG_BASE or argv[1]; defaults to this repo's parent so a fresh
# checkout can regenerate all four workflows from one source.
import sys

BASE = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get("PPG_BASE")
    or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
for repo_dir, (tag, extra) in REPOS.items():
    out = os.path.join(BASE, repo_dir, ".github", "workflows", "protected-paths-guard.yml")
    if not os.path.isdir(os.path.dirname(out)):
        print("skip (no checkout):", out)
        continue
    with open(out, "w") as f:
        f.write(render(tag, extra))
    print("wrote", out)
