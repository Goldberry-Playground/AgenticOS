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
 *   node scripts/ops/audit-company-skills.mjs --no-ack            # ignore the ack file
 *
 * Findings on a skill installed `editable:false` cannot be silenced in the
 * skill's own body, so they are acknowledged out of band and with an expiry in
 * scripts/ops/skill-audit-acknowledged.json — see the comment block in that
 * file for the rules.
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

/** Default location of the expiring-acknowledgement file, next to this tool. */
export const ACKNOWLEDGEMENT_FILE = "skill-audit-acknowledged.json";

/**
 * Parse the acknowledgement file into usable entries plus per-entry errors.
 *
 * Fail-closed and noisy: a malformed entry is never honoured and is reported,
 * so a typo'd `expires` or a missing `reason` cannot quietly turn into a
 * permanent mute. Errors do not abort the audit — the finding the bad entry
 * meant to cover simply reds, which is the safe direction.
 */
export function parseAcknowledgements(raw) {
  const entries = [];
  const errors = [];
  let doc;
  try {
    doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return { entries, errors: [`acknowledgement file is not valid JSON: ${err.message}`] };
  }
  const list = doc?.acknowledgements;
  if (!Array.isArray(list)) {
    return { entries, errors: ['acknowledgement file has no "acknowledgements" array'] };
  }
  list.forEach((entry, index) => {
    const where = `acknowledgements[${index}]`;
    for (const field of ["skillKey", "path", "expires", "issue", "reason"]) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        errors.push(`${where}: missing or empty "${field}"`);
        return;
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      errors.push(`${where}: "expires" must be ISO YYYY-MM-DD, got "${entry.expires}"`);
      return;
    }
    // End of the named UTC day, so an entry expiring "today" is still live today.
    const expiresAt = new Date(`${entry.expires}T23:59:59.999Z`);
    if (Number.isNaN(expiresAt.getTime())) {
      errors.push(`${where}: "expires" is not a real date ("${entry.expires}")`);
      return;
    }
    entries.push({
      skillKey: entry.skillKey.trim(),
      path: entry.path.trim(),
      expires: entry.expires,
      expiresAt,
      issue: entry.issue.trim(),
      reason: entry.reason.trim(),
    });
  });
  return { entries, errors };
}

const DAY_MS = 86_400_000;

/**
 * Classify one missing path against the acknowledgements for its skill.
 *
 * Returns null when nothing covers it (so it stays a plain dropped path).
 * The three non-null verdicts all keep the path dropped *except*
 * `acknowledged`: an entry only suppresses while it is in date and the skill
 * is genuinely un-annotatable.
 */
function classifyAcknowledgement(skill, path, acks, now) {
  const ack = acks.find((entry) => entry.path === path);
  if (!ack) return null;
  // `editable !== false` covers both an editable skill and a payload that
  // omits the field: without proof the body cannot be annotated, insist on the
  // in-body marker, which keeps the opt-out next to what it describes.
  if (skill.editable !== false) {
    return { ...ack, verdict: "rejected", daysLeft: null };
  }
  const daysLeft = Math.ceil((ack.expiresAt.getTime() - now.getTime()) / DAY_MS);
  if (ack.expiresAt.getTime() < now.getTime()) {
    return { ...ack, verdict: "expired", daysLeft };
  }
  return { ...ack, verdict: "acknowledged", daysLeft };
}

function inventoryPaths(skill) {
  return new Set((skill.fileInventory ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.path)).filter(Boolean));
}

/**
 * Audit one skill payload (the shape returned by
 * GET /api/companies/:id/skills/:skillId).
 */
export function auditSkill(skill, { acknowledgements = [], now = new Date() } = {}) {
  const installed = inventoryPaths(skill);
  const referenced = extractReferencedPaths(skill.markdown);
  const ignored = extractIgnoredPaths(skill.markdown);
  const missing = [...referenced]
    .filter((path) => !installed.has(path) && !ignored.has(path))
    .sort();
  const ignoredPaths = [...referenced].filter((path) => ignored.has(path)).sort();

  // Expiring, out-of-band acknowledgements for skills whose body we cannot
  // annotate. Only an in-date entry on an `editable:false` skill suppresses;
  // every other verdict leaves the path dropped so the finding still reds.
  const acks = acknowledgements.filter((entry) => entry.skillKey === skill.key);
  const dropped = [];
  const acknowledgedPaths = [];
  const expiredAcknowledgements = [];
  const rejectedAcknowledgements = [];
  for (const path of missing) {
    const verdict = classifyAcknowledgement(skill, path, acks, now);
    if (verdict?.verdict === "acknowledged") {
      acknowledgedPaths.push(verdict);
      continue;
    }
    if (verdict?.verdict === "expired") expiredAcknowledgements.push(verdict);
    if (verdict?.verdict === "rejected") rejectedAcknowledgements.push(verdict);
    dropped.push(path);
  }
  // An entry whose finding is gone is cruft, not a failure: report it so it
  // gets deleted, but do not red a clean library over a tidy-up.
  const staleAcknowledgements = acks.filter((entry) => !missing.includes(entry.path));

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
    acknowledgedPaths,
    expiredAcknowledgements,
    rejectedAcknowledgements,
    staleAcknowledgements,
    degraded: reasons.length > 0,
    reasons,
  };
}

/**
 * Audit the whole library. Returns per-skill results plus slug collisions —
 * two installs sharing a slug is how a degraded skill keeps shadowing its
 * healthy replacement after someone re-homes it.
 */
export function auditSkills(skills, options = {}) {
  const { acknowledgementErrors = [] } = options;
  const results = skills.map((skill) => auditSkill(skill, options));
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
    acknowledgementErrors,
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
  for (const skill of audit.results) {
    for (const ack of skill.acknowledgedPaths ?? []) {
      lines.push("");
      lines.push(`ℹ️  ACKNOWLEDGED  ${skill.key} → ${ack.path}`);
      lines.push(`   ${ack.issue} · expires ${ack.expires} (${ack.daysLeft} day(s) left)`);
      lines.push(`   ${ack.reason}`);
      if (ack.daysLeft <= 14) {
        lines.push("   → expiring soon: re-review and either delete or renew this entry");
      }
    }
    for (const ack of skill.expiredAcknowledgements ?? []) {
      lines.push("");
      lines.push(`⚠️  ACKNOWLEDGEMENT EXPIRED  ${skill.key} → ${ack.path}`);
      lines.push(`   expired ${ack.expires} (${ack.issue}) — no longer suppressing; this finding is red again`);
      lines.push("   re-review it: fix the skill, delete the entry, or renew it with a new expiry");
    }
    for (const ack of skill.rejectedAcknowledgements ?? []) {
      lines.push("");
      lines.push(`⚠️  ACKNOWLEDGEMENT REJECTED  ${skill.key} → ${ack.path}`);
      lines.push("   this skill is editable, so the acknowledgement file does not apply to it");
      lines.push("   use an in-body `<!-- skill-audit-ignore: … -->` marker, or install the file");
    }
    for (const ack of skill.staleAcknowledgements ?? []) {
      lines.push("");
      lines.push(`⚠️  STALE ACKNOWLEDGEMENT  ${skill.key} → ${ack.path}`);
      lines.push("   nothing is missing at this path any more — delete the entry");
    }
  }
  for (const err of audit.acknowledgementErrors ?? []) {
    lines.push("");
    lines.push(`⚠️  BAD ACKNOWLEDGEMENT  ${err}`);
    lines.push("   not honoured — any finding it meant to cover is red");
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

/**
 * Read + parse the acknowledgement file. A missing file is normal (nothing is
 * acknowledged); an unreadable one is an error we report rather than swallow.
 */
export async function loadAcknowledgements(filePath) {
  const { readFile } = await import("node:fs/promises");
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { entries: [], errors: [] };
    return { entries: [], errors: [`cannot read ${filePath}: ${err.message}`] };
  }
  return parseAcknowledgements(raw);
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

  let acknowledgements = [];
  let acknowledgementErrors = [];
  if (!argv.includes("--no-ack")) {
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    ({ entries: acknowledgements, errors: acknowledgementErrors } = await loadAcknowledgements(
      join(here, ACKNOWLEDGEMENT_FILE),
    ));
  }

  const audit = auditSkills(skills, { acknowledgements, acknowledgementErrors });
  console.log(asJson ? JSON.stringify(audit, null, 2) : formatReport(audit));
  return audit.degraded.length > 0 || audit.slugCollisions.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2)));
}
