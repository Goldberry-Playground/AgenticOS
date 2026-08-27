#!/usr/bin/env node
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
  '.github/workflows/**',
  'infra/terraform/cloudflare-qa-webhook.tf',
  'packages/github-sync-plugin/**/manifest*',
  'scripts/deploy-plugin.sh',
  'infra/terraform/github-*.tf',
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
