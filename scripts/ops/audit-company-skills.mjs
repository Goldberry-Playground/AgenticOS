#!/usr/bin/env node
/**
 * GOL-2994: catch company skills that installed *degraded*.
 *
 * The trap: importing a `github` / `skills_sh` / `url` skill that ships a
 * `scripts/` directory succeeds, reports no error, and installs **only
 * SKILL.md**. The platform's trust gate (`assertImportedSkillSourceAllowed`
 * → `scripts_executables_blocked`) is doing its job — pulling executables
 * straight from an external git ref into an agent runtime is a real
 * supply-chain risk — but the import then falls back to the markdown-only
 * path and surfaces nothing. The agent reads SKILL.md, runs
 * `scripts/<entrypoint>`, and gets a missing-file error that looks exactly
 * like a dropped credential or a broken environment.
 *
 * That cost GOL-2963 a full cycle and produced a false regression report
 * against three correctly-closed tickets.
 *
 * Fixing the install path is upstream Paperclip code we do not own. What we
 * own is noticing. This audit reads the company skill library over the API and
 * reds any skill whose own SKILL.md documents files that were never installed.
 *
 * Usage:
 *   node scripts/ops/audit-company-skills.mjs            # human report
 *   node scripts/ops/audit-company-skills.mjs --json     # machine report
 *   node scripts/ops/audit-company-skills.mjs --fixture f.json   # offline
 *
 * Env: PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_COMPANY_ID.
 *      PAPERCLIP_API_HOST sets a Host header when talking to the container
 *      directly (http://paperclip-server:3100).
 *
 * Exit: 0 clean · 1 findings · 2 could not complete the audit.
 */

/** Source types whose executables the platform refuses to install. */
export const EXTERNAL_SOURCE_TYPES = new Set(["github", "skills_sh", "url"]);

/** Directory prefixes a SKILL.md can legitimately point at. */
const REFERENCE_PREFIXES = ["scripts", "references", "assets", "templates", "reference"];

const PATH_PATTERN = new RegExp(
  String.raw`(?:^|[^\w./-])((?:${REFERENCE_PREFIXES.join("|")})/[A-Za-z0-9_][A-Za-z0-9_./-]*)`,
  "g",
);

/**
 * Pull the in-skill file paths a SKILL.md tells the agent to use.
 *
 * Deliberately permissive about *where* the path appears (prose, fenced block,
 * backticks, a bare command line) and strict about what counts as a path: it
 * must start with a known skill subdirectory, so `src/foo.py` from a quoted
 * example or `https://…/scripts/x` from a URL does not register.
 */
export function extractReferencedPaths(markdown) {
  const found = new Set();
  if (!markdown) return found;
  for (const match of markdown.matchAll(PATH_PATTERN)) {
    let path = match[1];
    // Strip trailing prose/markup punctuation: `scripts/x.py`, (scripts/x.py),
    // "see scripts/x.py." and friends.
    path = path.replace(/[.,;:)\]}"'`]+$/, "");
    // A bare directory reference ("everything under scripts/") is not a file.
    if (path.endsWith("/")) continue;
    // Require an extension — `references/models` in a sentence is a heading,
    // `references/models.md` is a file the agent will try to open.
    if (!/\.[A-Za-z0-9]{1,5}$/.test(path)) continue;
    found.add(path);
  }
  return found;
}

/**
 * `<!-- skill-audit-ignore: scripts/a.sh, references/b.md -->`
 *
 * A SKILL.md sometimes quotes a path that belongs to a *different* skill — the
 * `paperclip-board-writes` skill cites the bundled `paperclip` skill's
 * inventory as evidence, and `extractReferencedPaths` is deliberately
 * permissive about where a path appears, so that citation read as a dropped
 * entrypoint. That is a false positive on a skill attached to every agent,
 * which is the fastest way to teach people to ignore a control.
 *
 * The fix is an explicit, reviewable opt-out rather than a heuristic about
 * invocation position: tightening the extractor to "command position only"
 * would also stop catching `odoo-logistics`, the GOL-2963 founding case, whose
 * dropped `scripts/*.py` are documented in prose. Suppression has to be a
 * visible edit to the skill's own body, and the report always prints the count
 * so a silenced path is never invisible.
 */
export function extractIgnoredPaths(markdown) {
  const ignored = new Set();
  if (!markdown) return ignored;
  for (const match of markdown.matchAll(/<!--\s*skill-audit-ignore:\s*([^>]*?)\s*-->/g)) {
    for (const raw of match[1].split(/[,\s]+/)) {
      const path = raw.replace(/^[`'"]+|[`'".,;]+$/g, "").trim();
      if (path) ignored.add(path);
    }
  }
  return ignored;
}

function inventoryPaths(skill) {
  return new Set((skill.fileInventory ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.path)).filter(Boolean));
}

/**
 * Audit one skill payload (the shape returned by
 * GET /api/companies/:id/skills/:skillId).
 */
export function auditSkill(skill) {
  const installed = inventoryPaths(skill);
  const referenced = extractReferencedPaths(skill.markdown);
  const ignored = extractIgnoredPaths(skill.markdown);
  const dropped = [...referenced]
    .filter((path) => !installed.has(path) && !ignored.has(path))
    .sort();
  const ignoredPaths = [...referenced].filter((path) => ignored.has(path)).sort();
  const droppedScripts = dropped.filter((path) => path.startsWith("scripts/"));
  const reasons = [];

  if (dropped.length > 0) {
    reasons.push({
      code: "documented_files_missing",
      // The headline: the skill's own instructions point at files that are not
      // on disk, so following SKILL.md fails with a misleading error.
      detail: `SKILL.md documents ${dropped.length} file(s) that were not installed`,
    });
  }

  if (
    droppedScripts.length > 0 &&
    EXTERNAL_SOURCE_TYPES.has(skill.sourceType) &&
    skill.trustLevel === "markdown_only"
  ) {
    reasons.push({
      code: "scripts_executables_blocked",
      detail:
        `external source \`${skill.sourceType}\` cannot install executables; ` +
        "re-home the skill as a `local_path` or `catalog` skill to ship scripts/",
    });
  }

  return {
    skillId: skill.id,
    key: skill.key,
    slug: skill.slug,
    sourceType: skill.sourceType,
    trustLevel: skill.trustLevel,
    attachedAgentCount: skill.attachedAgentCount ?? null,
    installedCount: installed.size,
    droppedPaths: dropped,
    // Printed in the report even on a clean skill: a suppression nobody can
    // see is a suppression nobody will revisit.
    ignoredPaths,
    degraded: reasons.length > 0,
    reasons,
  };
}

/**
 * Audit the whole library. Returns per-skill results plus slug collisions —
 * two installs sharing a slug is how a degraded skill keeps shadowing its
 * healthy replacement after someone re-homes it.
 */
export function auditSkills(skills) {
  const results = skills.map(auditSkill);
  const bySlug = new Map();
  for (const skill of skills) {
    if (!bySlug.has(skill.slug)) bySlug.set(skill.slug, []);
    bySlug.get(skill.slug).push(skill.key);
  }
  const slugCollisions = [...bySlug.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([slug, keys]) => ({ slug, keys: [...keys].sort() }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    checked: results.length,
    degraded: results.filter((r) => r.degraded),
    healthy: results.filter((r) => !r.degraded),
    slugCollisions,
    results,
  };
}

export function formatReport(audit) {
  const lines = [`checked ${audit.checked} company skill(s)`];
  if (audit.degraded.length === 0) {
    lines.push("✅ no degraded installs — every documented file is on disk");
  }
  for (const finding of audit.degraded) {
    lines.push("");
    lines.push(`❌ DEGRADED  ${finding.key}`);
    lines.push(`   source=${finding.sourceType} trust=${finding.trustLevel} attached_agents=${finding.attachedAgentCount ?? "?"}`);
    for (const reason of finding.reasons) lines.push(`   • ${reason.code}: ${reason.detail}`);
    lines.push("   dropped:");
    for (const path of finding.droppedPaths) lines.push(`     - ${path}`);
  }
  const suppressed = audit.results.filter((r) => (r.ignoredPaths ?? []).length > 0);
  for (const skill of suppressed) {
    lines.push("");
    lines.push(`ℹ️  SUPPRESSED  ${skill.key} declares skill-audit-ignore for:`);
    for (const path of skill.ignoredPaths) lines.push(`     - ${path}`);
    lines.push("   these are quoted from another skill, not this skill's entrypoints");
  }
  for (const collision of audit.slugCollisions) {
    lines.push("");
    lines.push(`⚠️  SLUG COLLISION  "${collision.slug}" is installed ${collision.keys.length}×`);
    for (const key of collision.keys) lines.push(`     - ${key}`);
    lines.push("   an agent asking for this slug can get either one — uninstall the stale install");
  }
  return lines.join("\n");
}

function apiHeaders() {
  const key = process.env.PAPERCLIP_API_KEY;
  if (!key) throw new Error("PAPERCLIP_API_KEY is not set");
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  if (process.env.PAPERCLIP_API_HOST) headers.Host = process.env.PAPERCLIP_API_HOST;
  return headers;
}

/**
 * Plain node:http(s) rather than fetch on purpose: `Host` is a forbidden
 * header for fetch, so it is silently dropped — and talking to the container
 * directly (http://paperclip-server:3100) without the public Host header is a
 * 403. The core client honours it.
 */
async function getJson(url) {
  const target = new URL(url);
  const transport = await import(target.protocol === "https:" ? "node:https" : "node:http");
  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      { method: "GET", headers: apiHeaders() },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GET ${url} → HTTP ${res.statusCode} ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`GET ${url} → unparseable JSON: ${err.message}`));
          }
        });
      },
    );
    req.setTimeout(60_000, () => req.destroy(new Error(`GET ${url} → timed out`)));
    req.on("error", reject);
    req.end();
  });
}

/** Fetch every company skill *with* its markdown (the list payload omits it). */
export async function fetchSkills() {
  const base = (process.env.PAPERCLIP_API_URL ?? "").replace(/\/$/, "");
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  if (!base) throw new Error("PAPERCLIP_API_URL is not set");
  if (!companyId) throw new Error("PAPERCLIP_COMPANY_ID is not set");
  const listed = await getJson(`${base}/api/companies/${companyId}/skills`);
  const skills = Array.isArray(listed) ? listed : (listed.skills ?? []);
  return Promise.all(
    skills.map((skill) => getJson(`${base}/api/companies/${companyId}/skills/${skill.id}`)),
  );
}

async function main(argv) {
  const asJson = argv.includes("--json");
  const fixtureIndex = argv.indexOf("--fixture");
  let skills;
  try {
    if (fixtureIndex !== -1) {
      const { readFile } = await import("node:fs/promises");
      skills = JSON.parse(await readFile(argv[fixtureIndex + 1], "utf8"));
    } else {
      skills = await fetchSkills();
    }
  } catch (err) {
    console.error(`audit-company-skills: ${err.message}`);
    return 2;
  }

  const audit = auditSkills(skills);
  console.log(asJson ? JSON.stringify(audit, null, 2) : formatReport(audit));
  return audit.degraded.length > 0 || audit.slugCollisions.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2)));
}
