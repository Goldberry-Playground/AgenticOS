// automerge-gate.mjs — decides whether an agent PR may auto-merge.
//
// Extracted from inline bash in .github/workflows/auto-approve.yml so the
// decision is unit-testable (scripts/test-automerge-gate.mjs). The workflow
// still owns "are all checks green"; this owns author, size, and path policy.
//
// CLI: node scripts/automerge-gate.mjs
//   env: PR_AUTHOR, PR_TITLE, PR_FILES (newline-separated), PR_ADDITIONS, PR_DELETIONS,
//        AUTOMERGE_SENSITIVE_GATE (on|off, default ON — only explicit 'off' disables), AUTOMERGE_MAX_LINES, AUTOMERGE_MAX_FILES
//   exit 0 = allow, exit 1 = skip (reason on stdout)
import { pathToFileURL } from "node:url";

/**
 * Resolve the sensitive-path gate posture from the environment.
 * SECURE BY DEFAULT: the gate is ON unless AUTOMERGE_SENSITIVE_GATE is
 * explicitly "off" — an unset repo variable or an unrecognized value must
 * never silently disable the M2 unconditional sensitive-path gate
 * (2026-07-12 security review). Fail-closed, not fail-open.
 */
export function sensitiveGateFromEnv(env = process.env) {
  return (env.AUTOMERGE_SENSITIVE_GATE ?? "on").trim().toLowerCase() !== "off";
}

/** Authors permitted to auto-merge: the Paperclip agent App bot, both spellings. */
const AGENT_AUTHORS = new Set(["agenticos-developer", "app/agenticos-developer", "agenticos-developer[bot]"]);

/** Dependabot, all spellings GitHub uses across REST/GraphQL/`gh`. */
const DEPENDABOT_AUTHORS = new Set(["dependabot", "app/dependabot", "dependabot[bot]"]);

/**
 * Classify a dependabot PR from its title. Dependabot titles are stable and
 * machine-written, so parsing them avoids adding the fetch-metadata action (this
 * script is deliberately zero-dependency).
 *
 *   "chore(deps)(deps-dev): bump jsdom from 29.1.1 to 30.0.1"
 *   "chore(deps)(deps): bump the production-dependencies group with 18 updates"
 *   "chore(deps)(deps): bump actions/checkout from 5 to 7"
 *
 * Returns { isDev, major } where `major` is true/false for a parseable single
 * bump, or null when the title is a grouped update with no single version pair.
 */
export function classifyDependabotTitle(title = "") {
  const isDev = /\(deps-dev\)/.test(title);
  const m =
    /\bfrom\s+v?(\d+)\.\S*\s+to\s+v?(\d+)\./.exec(title) ||
    /\bfrom\s+v?(\d+)\s+to\s+v?(\d+)\b/.exec(title);
  if (!m) return { isDev, major: null };
  return { isDev, major: Number(m[2]) > Number(m[1]) };
}

/**
 * Security finding M2 (PR #359): CI is not an adversarial-code gate. A
 * prompt-injected agent editing these paths could self-ship. Mirrors
 * .github/CODEOWNERS — keep both in sync.
 */
const SENSITIVE = [
  /^\.github\//,
  /^infra\//,
  /^docker-compose/,
  /^scripts\/agent-git\//,
  /^packages\/credential-broker\//,
  /^\.gitleaks\.toml$/,
  /(^|\/)Dockerfile/,
  // GOL-1732 (Tier-0 carve-out): this SENSITIVE set MUST be a superset of the
  // protected-paths guard's PROTECTED_GLOBS (.github/workflows/protected-paths-
  // guard.yml, single-sourced from scripts/ci/gen-protected-paths-guard.py), so
  // an agent PR touching a guard-protected path is NEVER auto-approved before an
  // allowlisted human's SHA-bound review. The guard is not yet a required check,
  // so this operational gate is the defense-in-depth that lands first. The
  // `.github/` and `infra/` entries above already cover the guard's
  // `.github/workflows/**` + `infra/terraform/*.tf` globs; these two close the
  // remaining gaps. test-automerge-gate.mjs asserts the superset invariant.
  /^scripts\/deploy-plugin\.sh$/,                     // guard: scripts/deploy-plugin.sh
  /^packages\/github-sync-plugin\/(?:.*\/)?manifest/, // guard: packages/github-sync-plugin/**/manifest*
];

export function evaluateGate(input) {
  const { authorLogin, changedFiles, additions, deletions, sensitiveGate, maxLines, maxFiles, prTitle = "" } = input;

  const isAgent = AGENT_AUTHORS.has(authorLogin);
  const isDependabot = DEPENDABOT_AUTHORS.has(authorLogin);

  if (!isAgent && !isDependabot) {
    return { allow: false, reason: `author '${authorLogin}' is not the agent App bot or dependabot; human and external PRs keep human review` };
  }

  // Dependency bumps are the archetypal "small, not a feature" change, but not
  // all of them are equal risk. A major bump can change runtime behaviour in
  // ways green CI does not necessarily catch, so those keep a human — EXCEPT
  // for dev dependencies, which cannot affect the shipped artifact (if a dev
  // major breaks anything, it breaks CI itself, which is already required
  // green before this gate runs).
  if (isDependabot) {
    const { isDev, major } = classifyDependabotTitle(prTitle);
    if (!isDev && major === true) {
      return { allow: false, reason: `major version bump of a production dependency — keeps a human reviewer ('${prTitle}')` };
    }
    if (!isDev && major === null) {
      return { allow: false, reason: `grouped production-dependency update with no single version pair — keeps a human reviewer ('${prTitle}')` };
    }
  }

  if (changedFiles.length > maxFiles) {
    return { allow: false, reason: `${changedFiles.length} changed files exceeds AUTOMERGE_MAX_FILES=${maxFiles}` };
  }

  const lines = additions + deletions;
  if (lines > maxLines) {
    return { allow: false, reason: `${lines} changed lines exceeds AUTOMERGE_MAX_LINES=${maxLines}` };
  }

  if (sensitiveGate) {
    const hit = changedFiles.find((f) => SENSITIVE.some((re) => re.test(f)));
    if (hit) {
      return { allow: false, reason: `sensitive path '${hit}' — AUTOMERGE_SENSITIVE_GATE is on` };
    }
  }

  return { allow: true, reason: `${changedFiles.length} files / ${lines} lines within caps` };
}

// CLI entrypoint — only when executed directly, not when imported by the test.
// Uses pathToFileURL (not a naive `file://${path}` string) because a naive
// comparison silently mismatches whenever the script path needs URL-encoding
// (e.g. a space, as in this repo's iCloud-synced checkout path) — that would
// make this whole guard false, so the gate never actually runs and `node
// automerge-gate.mjs` exits 0 with no output, which the workflow reads as an
// (incorrect) "allow".
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const result = evaluateGate({
    authorLogin: (process.env.PR_AUTHOR ?? "").trim(),
    changedFiles: (process.env.PR_FILES ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    additions: num(process.env.PR_ADDITIONS, 0),
    deletions: num(process.env.PR_DELETIONS, 0),
    prTitle: process.env.PR_TITLE ?? "",
    sensitiveGate: sensitiveGateFromEnv(),
    maxLines: num(process.env.AUTOMERGE_MAX_LINES, 800),
    maxFiles: num(process.env.AUTOMERGE_MAX_FILES, 25),
  });
  console.log(result.reason);
  process.exit(result.allow ? 0 : 1);
}
