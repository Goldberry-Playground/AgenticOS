#!/usr/bin/env node
// Tests for bound-recursive-fs-search.mjs (GOL-2043).
// Run: node scripts/guards/bound-recursive-fs-search.test.mjs
// No test framework — plain assertions + a subprocess check of the hook contract.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findDangerousRoots } from "./bound-recursive-fs-search.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "bound-recursive-fs-search.mjs");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Commands that MUST be blocked (recursion rooted at a dangerous location) ---
const BLOCK = [
  "grep -r pattern /",
  "grep -R foo /",
  "grep -rn TODO /opt",
  "grep --recursive x /var",
  "egrep -rl needle ~",
  "grep -ri secret $HOME",
  "find / -name '*.log'",
  "find /opt -type f",
  "rg pattern /",
  "rg needle /mnt",
  "fd . /",
  "tree /",
  "ls -R /",
  "sudo grep -r x /",
  "FOO=bar grep -rn x /usr",
  "nice -n 19 find / -name core",
  "cat a.txt && grep -r x /",
  "true; find / -name y",
  "ls | grep -r z /proc",
  "grep -rn foo ./src /", // one safe root + one dangerous root → block
  // GOL-2045: a real dangerous PATH after the pattern is still caught for
  // pattern-first tools (only the pattern token is skipped, not path args).
  "rg foo /", // pattern "foo", path "/" → block
  "rg /login /", // pattern "/login" skipped, path "/" → still block
  "fd pattern /opt", // pattern "pattern", path "/opt" → block
  "grep -rn /login ./src /var", // pattern "/login" skipped, "/var" → block
  "ls -lR /var", // ls recurses only via -R (clustered) → block
];

// --- Commands that MUST be allowed (scoped, non-recursive, or unrelated) ---
const ALLOW = [
  "grep -rn pattern ./src",
  "grep -r foo packages/openviking-plugin",
  "grep -rn TODO /paperclip/instances/x/y/_default/AgenticOS",
  "rg pattern",
  "rg needle src/",
  "find . -name '*.ts'",
  "find ./apps -type f",
  "grep foo bar.txt", // no recursion flag
  "grep -n foo /etc/hosts", // no recursion flag, single file
  "ls -la /",
  "ls /opt",
  "cat /etc/passwd",
  "echo grep -r x /", // echo, not a real search (base is echo)
  "npm run build",
  "find /home/node/project/src -name '*.js'",
  // GOL-2045: route-like search patterns are the pattern, not a recursion root.
  'rg "/health"', // bare rg, pattern is a route string → allowed
  "rg /login", // bare rg, pattern is a route string → allowed
  'grep -rn "/login" ./src', // scoped grep, pattern is a route → allowed
  'grep -rn "/metrics" ./src', // scoped grep, pattern is a route → allowed
  'fd "/tmp"', // fd pattern is a route/path string, search root is cwd → allowed
  "egrep -r /api packages/api", // scoped egrep, pattern "/api" → allowed
  // GOL-2045: `ls -r` is reverse-sort, not recursive.
  "ls -lr /var", // -r = reverse order, not recursion → allowed
  "ls -r /", // reverse-sort listing of / (non-recursive) → allowed
];

for (const cmd of BLOCK) {
  check(`BLOCK: ${cmd}`, findDangerousRoots(cmd).length > 0);
}
for (const cmd of ALLOW) {
  check(`ALLOW: ${cmd}`, findDangerousRoots(cmd).length === 0);
}

// --- Full hook contract via subprocess (stdin JSON → deny stdout / silent allow) ---
function runHook(payload, env = {}) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return out;
}

// Dangerous Bash command → deny JSON on stdout.
{
  const out = runHook({ tool_name: "Bash", tool_input: { command: "grep -r x /" } });
  let parsed = null;
  try {
    parsed = JSON.parse(out);
  } catch {
    /* leave null */
  }
  check("hook denies grep -r /", parsed?.hookSpecificOutput?.permissionDecision === "deny");
  check(
    "hook deny reason mentions GOL-2043",
    typeof parsed?.hookSpecificOutput?.permissionDecisionReason === "string" &&
      parsed.hookSpecificOutput.permissionDecisionReason.includes("GOL-2043"),
  );
}

// Safe Bash command → allow (empty stdout).
check(
  "hook allows scoped grep",
  runHook({ tool_name: "Bash", tool_input: { command: "grep -rn x ./src" } }).trim() === "",
);

// Non-Bash tool → allow (empty stdout).
check(
  "hook ignores non-Bash tools",
  runHook({ tool_name: "Read", tool_input: { file_path: "/" } }).trim() === "",
);

// Escape hatch disables the guard.
check(
  "GROVE_FS_GUARD_DISABLE=1 bypasses",
  runHook({ tool_name: "Bash", tool_input: { command: "grep -r x /" } }, { GROVE_FS_GUARD_DISABLE: "1" }).trim() === "",
);

// Malformed input → fail open (empty stdout, no crash).
check("malformed stdin fails open", (() => {
  const out = execFileSync("node", [HOOK], { input: "not json", encoding: "utf8" });
  return out.trim() === "";
})());

console.log(`\n${pass} passed, ${fail} failed`);
// Use exitCode (not process.exit) so piped stdout flushes before the process ends.
process.exitCode = fail === 0 ? 0 : 1;
