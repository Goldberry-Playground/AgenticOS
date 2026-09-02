#!/usr/bin/env node
// GOL-2043 — Agent-runtime guard: bound recursive filesystem searches.
//
// A PreToolUse hook for the Paperclip/Claude-Code Bash tool. It denies
// recursive filesystem searches rooted at the filesystem root, $HOME, or any
// top-level system directory — the class of command that once ran away as
// `grep -r ... /`, burned ~128 CPU-hours, and starved github-sync inbound.
//
// Design: precision over recall. We only block recursion whose ROOT is a
// dangerous top-level location (depth <= 1 absolute path, `/`, `~`, or
// `$HOME`). Ordinary in-repo searches (`grep -rn foo src/`, `rg bar`,
// `find . -name '*.ts'`) are always allowed. Blast-radius containment for
// commands that slip past string matching (e.g. `cd /; grep -r x .`) is the
// job of the container CPU quota tracked in the sibling infra issue — this
// hook is the cheap first line, not the only line.
//
// Contract (Claude Code PreToolUse hook):
//   stdin  : JSON { tool_name, tool_input: { command }, ... }
//   allow  : exit 0, no stdout
//   deny   : exit 0 with stdout
//     {"hookSpecificOutput":{"hookEventName":"PreToolUse",
//       "permissionDecision":"deny","permissionDecisionReason":"..."}}
//
// Escape hatch: set GROVE_FS_GUARD_DISABLE=1 to bypass (documented, for
// deliberate operator sweeps). Extra allow/deny roots are intentionally NOT
// configurable to keep the guard simple and auditable.

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Commands that walk the tree, and whether they recurse by default. */
const RECURSIVE_BY_DEFAULT = new Set(["find", "rg", "fd", "fdfind", "tree"]);
const GREP_LIKE = new Set(["grep", "egrep", "fgrep"]);
const LS_LIKE = new Set(["ls"]);
// Tools whose first non-flag argument is the search PATTERN, not a path. For
// these the pattern must be excluded from the dangerous-root scan — otherwise a
// route-like pattern (`/login`, `/health`, `/api`) reads as a recursion root and
// blocks a scoped or bare search. `find`/`tree`/`ls` take paths positionally and
// are NOT in this set.
const PATTERN_FIRST = new Set(["grep", "egrep", "fgrep", "rg", "fd", "fdfind"]);

/** Shell operators that separate independent simple-commands. */
const SEGMENT_SPLIT = /(?:&&|\|\||[;\n|])/;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** True if a short-flag cluster (e.g. "-rn", "-Rl") requests recursion. */
function shortFlagHasRecursion(tok) {
  return /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(tok);
}

/**
 * True if a short-flag cluster requests recursion via upper-case `-R` only.
 * For `ls`, `-r` is reverse-sort (not recursive); only `-R` recurses.
 */
function shortFlagHasUppercaseRecursion(tok) {
  return /^-[a-zA-Z]*R[a-zA-Z]*$/.test(tok);
}

/**
 * Normalize a path-ish token and decide whether it is a dangerous recursion
 * root: `/`, a glob at root (`/*`), `~`/`~/…`, a literal `$HOME`/`${HOME}`,
 * or any absolute path whose depth is <= 1 (e.g. `/opt`, `/var`, `/mnt`).
 */
function isDangerousRoot(rawTok) {
  let tok = rawTok.trim();
  if (!tok) return false;
  // Strip surrounding quotes if the whole token is quoted.
  if ((tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'"))) {
    tok = tok.slice(1, -1);
  }
  if (!tok) return false;

  // Home directory in any spelling.
  if (tok === "~" || tok.startsWith("~/") || tok === "$HOME" || tok === "${HOME}") return true;

  // Only absolute paths can be a top-level recursion root.
  if (!tok.startsWith("/")) return false;

  // Depth of the absolute path (a leading "/*" glob counts as depth 1).
  const segments = tok
    .split("/")
    .filter((s) => s.length > 0 && s !== ".");
  // "/", "/*", "/opt", "/var/" → depth <= 1 → dangerous top-level recursion.
  return segments.length <= 1;
}

/** Extract the argument tokens of a simple-command that trigger recursion. */
function dangerousRootsInSegment(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  // Skip leading env-var assignments and transparent wrappers so we land on the
  // real command base. Some wrappers take option args (`nice -n 19`, `ionice
  // -c2`), so once a wrapper is seen we also consume following option flags and
  // their numeric values until the first real token.
  const WRAPPERS = new Set(["sudo", "command", "nice", "ionice", "time", "nohup", "env"]);
  let i = 0;
  let sawWrapper = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i++; // env-var assignment
    } else if (WRAPPERS.has(t)) {
      sawWrapper = true;
      i++;
    } else if (sawWrapper && (t.startsWith("-") || /^\d+$/.test(t))) {
      i++; // a wrapper's option flag or its numeric value
    } else {
      break;
    }
  }
  if (i >= tokens.length) return [];

  const base = tokens[i].split("/").pop(); // handle /usr/bin/grep
  const rest = tokens.slice(i + 1);

  let recursive = false;
  if (RECURSIVE_BY_DEFAULT.has(base)) {
    recursive = true;
  } else if (GREP_LIKE.has(base)) {
    recursive = rest.some(
      (t) => t === "--recursive" || t === "-R" || t === "--dereference-recursive" || shortFlagHasRecursion(t),
    );
  } else if (LS_LIKE.has(base)) {
    recursive = rest.some((t) => t === "--recursive" || shortFlagHasUppercaseRecursion(t));
  }
  if (!recursive) return [];

  // Any non-flag path argument that looks like a dangerous root triggers the
  // guard. For grep/rg/fd the FIRST non-flag token is the search PATTERN, not a
  // path, so we skip it — otherwise a route-like pattern (`rg "/health"`,
  // `grep -rn "/login" ./src`) would falsely read as a recursion root and block
  // a scoped or bare search. This is grammar-correct for the bare-pattern form;
  // the `-e PATTERN` / `-f FILE` forms are a known imperfection, but a real
  // dangerous root (`/`, `/opt`) still appears as a later positional token there
  // and is still caught. `find`/`tree`/`ls` take paths positionally, so every
  // non-flag token is scanned.
  const skipPattern = PATTERN_FIRST.has(base);
  const hits = [];
  let patternSkipped = false;
  for (const t of rest) {
    if (t.startsWith("-")) continue;
    if (skipPattern && !patternSkipped) {
      patternSkipped = true; // drop the search pattern; keep scanning path args
      continue;
    }
    if (isDangerousRoot(t)) hits.push(t);
  }
  return hits;
}

function findDangerousRoots(command) {
  const roots = [];
  for (const segment of command.split(SEGMENT_SPLIT)) {
    roots.push(...dangerousRootsInSegment(segment));
  }
  return roots;
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function main() {
  if (process.env.GROVE_FS_GUARD_DISABLE === "1") process.exit(0);

  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed hook input: fail open (do not block the agent on our own bug).
    process.exit(0);
  }

  if (payload?.tool_name !== "Bash") process.exit(0);
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) process.exit(0);

  const roots = findDangerousRoots(command);
  if (roots.length === 0) process.exit(0);

  const unique = [...new Set(roots)];
  deny(
    `Blocked an unbounded recursive filesystem search rooted at ${unique
      .map((r) => `\`${r}\``)
      .join(", ")}. Recursing from the filesystem root, $HOME, or a top-level ` +
      `system directory can burn enormous CPU and starve other services (see ` +
      `GOL-2043). Scope the search to the project directory instead — e.g. ` +
      `\`grep -rn PATTERN ./src\` or \`find . -name '*.ts'\`. Use the Grep/Glob ` +
      `tools where possible. If a wide sweep is genuinely required, run it under ` +
      `an operator with GROVE_FS_GUARD_DISABLE=1.`,
  );
}

// Only execute the hook when run directly; importing (tests) must not exit.
function isEntryPoint() {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();

export { findDangerousRoots, isDangerousRoot, dangerousRootsInSegment };
