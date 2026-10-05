#!/usr/bin/env node
/**
 * Per-agent git identity: claim it per worktree, assert it at commit time (GOL-2986).
 *
 * WHY
 * ---
 * Agent runs share one git checkout per repo (/paperclip/work/<repo>) and fan out
 * into linked worktrees. `git config user.email` inside a linked worktree writes to
 * the COMMON `.git/config` -- repo-local config is per-repository, not per-worktree --
 * so whichever run set its identity last owns the identity of every other worktree
 * and of the main checkout. With several agent runs in flight (3 Ada + 2 Terra runs
 * overlapped while this was written) the shared value is a race with no winner.
 *
 * That bleed silently defeats the PR-review self-review skip (GOL-2720/GOL-2976):
 * the guard discriminates on the git AUTHOR facet of the PR's commits
 * (`pulls/{n}/commits` -> `commit.author`, matched against the plugin config field
 * prReviewAuthorIdentities), so a mis-attributed author either hands an agent its own
 * code to review (bleed away from the real author: PR #806) or drops a real,
 * independent reviewer as a false self-review (bleed toward a reviewer).
 *
 * FIX
 * ---
 * Identity lives in PER-WORKTREE config (`git config --worktree`, enabled by
 * `extensions.worktreeConfig`), which outranks the shared `.git/config` that the host
 * checkout step writes -- so a sibling run cannot stomp it -- and a pre-commit hook
 * asserts, at commit time, that the acting agent ($PAPERCLIP_AGENT_ID) really is the
 * commit author. A pre-commit hook CANNOT rewrite the in-flight commit's author
 * (verified: git resolves the author independently of hook-time config writes), so the
 * assertion FAILS CLOSED: it claims the correct identity for the retry and exits 1.
 *
 * Fail-safe by construction -- it exits 0 (never blocks) when:
 *   - $PAPERCLIP_AGENT_ID is unset (humans, CI, the droplet host),
 *   - the agent id is not in agent-identities.json,
 *   - a merge / cherry-pick / rebase / revert sequencer is in progress (a foreign
 *     author is legitimate there),
 *   - AGENT_GIT_IDENTITY_ASSERT=off (documented escape hatch; `--no-verify` also
 *     skips the hook entirely).
 *
 * Node builtins only; no install. Runs from the read-only mount at
 * /paperclip/agent-git/ and from the repo checkout alike.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const MAP_PATH = process.env.AGENT_GIT_IDENTITY_MAP
  ? process.env.AGENT_GIT_IDENTITY_MAP
  : new URL("./agent-identities.json", import.meta.url);

/** Acting agent id. AGENT_GIT_AGENT_ID is a test/override seam. */
function actingAgentId() {
  return (process.env.AGENT_GIT_AGENT_ID || process.env.PAPERCLIP_AGENT_ID || "").trim();
}

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function loadIdentity(agentId) {
  if (!agentId) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(MAP_PATH, "utf8"));
  } catch (e) {
    warn(`identity map unreadable (${MAP_PATH}): ${e.message}`);
    return null;
  }
  const entry = raw?.agents?.[agentId];
  if (!entry?.name || !entry?.email) return null;
  return { id: agentId, name: String(entry.name), email: String(entry.email) };
}

/** Every identity in the map, for "does this value belong to another agent?" checks. */
function allIdentities() {
  try {
    const raw = JSON.parse(readFileSync(MAP_PATH, "utf8"));
    return Object.entries(raw?.agents ?? {}).map(([id, v]) => ({
      id,
      name: String(v?.name ?? ""),
      email: String(v?.email ?? ""),
    }));
  } catch {
    return [];
  }
}

/** The non-agent fallback identity for shared config (the App bot). */
function neutralIdentity() {
  try {
    const raw = JSON.parse(readFileSync(MAP_PATH, "utf8"));
    const n = raw?.neutral;
    return n?.name && n?.email ? { name: String(n.name), email: String(n.email) } : null;
  } catch {
    return null;
  }
}

function warn(msg) {
  process.stderr.write(`agent-git identity: ${msg}\n`);
}

const eq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * The identity git WILL use for the author of the next commit, resolved by git itself
 * (`git var`) so env vars (GIT_AUTHOR_*) and the full config precedence chain --
 * worktree > local > global -- are honoured exactly as at commit time.
 */
function effectiveAuthor() {
  const r = git("var", "GIT_AUTHOR_IDENT");
  if (!r.ok) return null;
  const m = /^(.*?)\s*<([^>]*)>/.exec(r.out);
  return m ? { name: m[1], email: m[2] } : null;
}

/** A sequencer op in progress: a foreign commit author is legitimate, so stand down. */
function sequencerInProgress() {
  // `git rev-parse --git-path` answers relative to the repo top; hooks run there, but
  // resolve explicitly so the command also works from a subdirectory.
  const top = git("rev-parse", "--show-toplevel").out;
  for (const p of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply"]) {
    const r = git("rev-parse", "--git-path", p);
    if (!r.ok || !r.out) continue;
    const abs = isAbsolute(r.out) || !top ? r.out : join(top, r.out);
    if (existsSync(abs)) return p;
  }
  return null;
}

/**
 * Pin `identity` to THIS worktree and stop the shared config from bleeding.
 *
 * 1. per-worktree `user.name`/`user.email` (outranks the shared `.git/config`);
 * 2. unset the shared `--local` identity when it belongs to a DIFFERENT known agent,
 *    so sibling worktrees stop inheriting it. A human's or the App bot's local
 *    identity is left alone (we only clean up our own mess).
 *
 * Idempotent: writes only what is missing or wrong. Returns a list of actions taken.
 */
function claim(identity) {
  const actions = [];
  const wt = (key) => git("config", "--worktree", "--get", key).out;

  const ext = git("config", "--local", "--get", "extensions.worktreeConfig").out;
  if (!eq(ext, "true")) {
    // git's documented caveat: with extensions.worktreeConfig enabled, core.bare /
    // core.worktree must live in the main worktree's config.worktree. Rather than
    // move another tool's settings, stand down on such a repo (env vars still work).
    const bare = git("config", "--local", "--get", "core.bare").out;
    const coreWorktree = git("config", "--local", "--get", "core.worktree").out;
    if (eq(bare, "true") || coreWorktree) {
      warn(
        "repo sets core.bare=true or core.worktree; not enabling extensions.worktreeConfig. " +
          "Use env vars instead: eval \"$(node /paperclip/agent-git/agent-identity.mjs export)\"",
      );
      return actions;
    }
    git("config", "--local", "extensions.worktreeConfig", "true");
    actions.push("enabled extensions.worktreeConfig");
  }

  if (!eq(wt("user.email"), identity.email)) {
    git("config", "--worktree", "user.email", identity.email);
    actions.push(`set worktree user.email=${identity.email}`);
  }
  if (!eq(wt("user.name"), identity.name)) {
    git("config", "--worktree", "user.name", identity.name);
    actions.push(`set worktree user.name=${identity.name}`);
  }

  // De-personalise the shared .git/config so sibling worktrees stop inheriting a real
  // agent. It is REPLACED with the neutral App identity, not unset: a repo with no
  // resolvable identity makes `git commit` die with exit 128 BEFORE any hook runs, so
  // unsetting would trade a mis-attributed commit for a cryptic hard failure. A
  // human's or the App bot's own value is left alone — we only clean up after agents.
  const neutral = neutralIdentity();
  const others = allIdentities().filter((o) => o.id !== identity.id);
  const localEmail = git("config", "--local", "--get", "user.email").out;
  if (neutral && localEmail && others.some((o) => eq(o.email, localEmail))) {
    git("config", "--local", "user.email", neutral.email);
    git("config", "--local", "user.name", neutral.name);
    actions.push(`de-personalised the shared .git/config identity (was ${localEmail}, another agent's)`);
  }
  return actions;
}

function cmdResolve() {
  const identity = loadIdentity(actingAgentId());
  if (!identity) {
    warn(`no identity for agent id ${actingAgentId() || "(unset)"}`);
    return 3;
  }
  process.stdout.write(`${identity.name}\t${identity.email}\n`);
  return 0;
}

function cmdExport() {
  const identity = loadIdentity(actingAgentId());
  if (!identity) {
    warn(`no identity for agent id ${actingAgentId() || "(unset)"}; nothing to export`);
    return 3;
  }
  const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  for (const k of ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"]) {
    process.stdout.write(`export ${k}=${sq(identity.name)}\n`);
  }
  for (const k of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) {
    process.stdout.write(`export ${k}=${sq(identity.email)}\n`);
  }
  return 0;
}

function cmdClaim() {
  const identity = loadIdentity(actingAgentId());
  if (!identity) {
    warn(`no identity for agent id ${actingAgentId() || "(unset)"}; leaving git identity untouched`);
    return 0;
  }
  const actions = claim(identity);
  process.stdout.write(
    actions.length
      ? `claimed ${identity.name} <${identity.email}> for this worktree:\n  - ${actions.join("\n  - ")}\n`
      : `already claimed: ${identity.name} <${identity.email}>\n`,
  );
  return 0;
}

function cmdCheck() {
  const agentId = actingAgentId();
  if (!agentId) return 0; // human / CI / host -- never block
  if (eq(process.env.AGENT_GIT_IDENTITY_ASSERT || "", "off")) {
    warn("AGENT_GIT_IDENTITY_ASSERT=off -- commit-time identity assertion skipped");
    return 0;
  }
  const identity = loadIdentity(agentId);
  if (!identity) {
    warn(`agent id ${agentId} is not in the identity map -- assertion skipped (add it to scripts/agent-git/agent-identities.json)`);
    return 0;
  }
  const seq = sequencerInProgress();
  if (seq) {
    warn(`${seq} in progress -- a foreign commit author is expected here, assertion skipped`);
    return 0;
  }

  const author = effectiveAuthor();
  if (author && eq(author.email, identity.email)) {
    // Right identity, but make it durable: if it only came from the SHARED config a
    // sibling run can flip it mid-session.
    claim(identity);
    return 0;
  }

  const origin = git("config", "--show-origin", "--get", "user.email").out || "(no user.email configured)";
  const actions = claim(identity);
  const pinned = git("config", "--worktree", "--get", "user.email").out;
  const found = author ? `${author.name} <${author.email}>` : "(git could not resolve an author identity)";
  // Three distinct repairs: we fixed it; it was already right but something with
  // higher precedence (env, `git -c`, `--author`) overrode it; or we could not fix it.
  const remedy = actions.length
    ? `Fixed for the retry:\n  - ${actions.join("\n  - ")}\n\nRe-run your commit — it will now be attributed correctly.`
    : eq(pinned, identity.email)
      ? "Nothing to repair: this worktree is already pinned to you. The author above came\n" +
        `from a source that OUTRANKS worktree config (${origin}) — drop that\noverride and re-run your commit.`
      : "Could not repair the identity automatically. Set it for this shell with:\n" +
        '  eval "$(node /paperclip/agent-git/agent-identity.mjs export)"';
  process.stderr.write(
    [
      "",
      "BLOCKED: this commit would be attributed to the wrong agent (GOL-2986).",
      "",
      `  acting agent  : ${identity.name} <${identity.email}>  ($PAPERCLIP_AGENT_ID=${agentId})`,
      `  commit author : ${found}`,
      `  came from     : ${origin}`,
      "",
      "A linked worktree shares the main repo's .git/config, so a sibling agent run's",
      "`git config user.email` becomes yours. A mis-attributed author silently defeats",
      "the PR-review self-review guard (GOL-2720/GOL-2976).",
      "",
      remedy,
      "",
      "Deliberately committing as someone else (replaying a patch)? Set",
      "AGENT_GIT_IDENTITY_ASSERT=off for that one command.",
      "",
    ].join("\n"),
  );
  return 1;
}

/**
 * Stamp `Co-authored-by: <acting agent>` on the message (GOL-2976's bleed-proof
 * signal: a trailer written by the acting agent's own process, not from user.email).
 * Skipped for merge/squash/amend/-C sources, where the message is not ours to extend.
 */
function cmdStamp(msgFile, source) {
  if (!msgFile) return 0;
  if (source && !["message"].includes(source)) return 0; // merge | squash | commit | template | editor
  const identity = loadIdentity(actingAgentId());
  if (!identity) return 0;
  // The read IS the existence check -- no existsSync() first. A check-then-write pair
  // on the same path is a file-system race (CodeQL js/file-system-race) and buys
  // nothing: a missing or unreadable message file simply means "nothing to stamp".
  let text;
  try {
    text = readFileSync(msgFile, "utf8");
  } catch {
    return 0;
  }
  const trailerRe = new RegExp(`^\\s*co-authored-by:.*<${identity.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`, "im");
  if (trailerRe.test(text)) return 0;
  const r = spawnSync(
    "git",
    ["interpret-trailers", "--if-exists", "addIfDifferent", "--trailer", `Co-authored-by: ${identity.name} <${identity.email}>`],
    { encoding: "utf8", input: text },
  );
  if (r.status !== 0 || !r.stdout) return 0; // never fail a commit over a trailer
  try {
    writeFileSync(msgFile, r.stdout);
  } catch {
    /* ignore */
  }
  return 0;
}

function usage() {
  process.stderr.write(
    [
      "usage: agent-identity.mjs <command>",
      "",
      "  resolve                 print the acting agent's canonical git identity",
      "  export                  print `export GIT_AUTHOR_*/GIT_COMMITTER_*` lines (eval me)",
      "  claim                   pin the identity to THIS worktree, un-bleed the shared config",
      "  check                   assert the acting agent is the commit author (pre-commit hook)",
      "  stamp <file> [source]   add the acting agent's Co-authored-by trailer (prepare-commit-msg)",
      "",
    ].join("\n"),
  );
  return 2;
}

const [cmd, ...rest] = process.argv.slice(2);
const exit =
  cmd === "resolve" ? cmdResolve()
  : cmd === "export" ? cmdExport()
  : cmd === "claim" ? cmdClaim()
  : cmd === "check" ? cmdCheck()
  : cmd === "stamp" ? cmdStamp(rest[0], rest[1])
  : usage();
process.exit(exit);
