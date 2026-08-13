#!/usr/bin/env python3
"""GOL-1406: generate the protected-paths-guard workflow for each repo.

The logic is byte-identical across all four repos; only PROTECTED_GLOBS and a
one-line repo tag differ. Keeping a single generator here means the shared
implementation can't silently drift between repos (the file is itself
self-protecting once merged, so any future edit needs `human-approved`)."""
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

TEMPLATE = r'''# Protected paths guard  —  GOL-1406 / GOL-1402 (org-wide spec, 2026-08-13).
#
# Sync-critical and gate-critical files require a HUMAN-applied `human-approved`
# label to merge. A PR that touches any protected path without that label fails
# this (required) check.
#
# Label-forgery defense: the `human-approved` label only counts if it was
# applied by a HUMAN on the allowlist (reused from auto-approve.yml), verified
# via the timeline API. A label applied by any bot/App identity — including our
# own agenticos-developer App — does NOT count.
#
# Self-protection: `.github/workflows/**` is protected (covers this file and
# auto-approve.yml), and the job runs on `pull_request_target` — i.e. from the
# BASE branch definition with API-only access and no PR checkout — so a PR
# cannot edit this workflow to neuter its own guard. Same philosophy as
# auto-approve.yml's workflow_run trigger.
#
# ONE shared implementation, generated for every repo from
# gen-protected-paths-guard.py; only PROTECTED_GLOBS differs per repo. Repo: {TAG}
name: Protected paths guard

on:
  pull_request_target:
    types: [opened, synchronize, reopened, labeled, unlabeled]

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
      - name: Enforce human-approved label on protected paths
        uses: actions/github-script@v7
        with:
          script: |
            // Human allowlist — a label applied by anyone NOT in this list
            // (including bots/Apps) does not count. Mirrors auto-approve.yml.
            const HUMAN_ALLOWLIST = ['EngineeringMoonBear'];
            const APPROVAL_LABEL = 'human-approved';

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

            // Live label state (the event payload can be stale).
            const liveLabels = await github.paginate(
              github.rest.issues.listLabelsOnIssue,
              { owner, repo, issue_number: number, per_page: 100 }
            );
            const hasLabel = liveLabels.some(l => l.name === APPROVAL_LABEL);

            const ASK = 'Ask Josh to review and apply the `' + APPROVAL_LABEL + '` label.';

            if (!hasLabel) {
              core.setFailed(
                'This PR changes protected paths but is not `' + APPROVAL_LABEL + '`.\n' + ASK
              );
              return;
            }

            // Label-forgery defense: the CURRENT human-approved label must have
            // been applied by an allowlisted human. Walk the timeline in order
            // and keep the last actor to (un)label human-approved.
            const timeline = await github.paginate(
              github.rest.issues.listEventsForTimeline,
              { owner, repo, issue_number: number, per_page: 100 }
            );
            let approvedByHuman = false;
            let lastActor = null;
            for (const ev of timeline) {
              const isLabel = ev.label && ev.label.name === APPROVAL_LABEL;
              if (ev.event === 'labeled' && isLabel) {
                const login = ev.actor && ev.actor.login;
                const type = ev.actor && ev.actor.type;
                lastActor = login;
                approvedByHuman = HUMAN_ALLOWLIST.includes(login) && type !== 'Bot';
              } else if (ev.event === 'unlabeled' && isLabel) {
                lastActor = ev.actor && ev.actor.login;
                approvedByHuman = false;
              }
            }

            if (!approvedByHuman) {
              core.setFailed(
                'The `' + APPROVAL_LABEL + '` label was applied by `' + (lastActor || 'unknown') +
                '`, who is not a human on the allowlist (' + HUMAN_ALLOWLIST.join(', ') + ').\n' +
                'A label applied by a bot/App does not count. ' + ASK
              );
              return;
            }

            core.info('`' + APPROVAL_LABEL + '` applied by allowlisted human `' + lastActor + '` — guard passes.');
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
