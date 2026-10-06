#!/usr/bin/env node
/**
 * GOL-2994: behavioural test for the degraded-skill-install audit.
 *
 * Fixture 1 is a faithful reconstruction of the install that cost GOL-2963 a
 * cycle: the `github`-sourced `odoo-logistics` skill, trust downgraded to
 * `markdown_only`, inventory `[SKILL.md]`, and a SKILL.md that still tells the
 * agent to run five files that were never written to disk. If a refactor ever
 * stops reding that shape, this test fails.
 */
import assert from "node:assert/strict";
import {
  auditSkill,
  auditSkills,
  extractIgnoredPaths,
  extractReferencedPaths,
  formatReport,
} from "../ops/audit-company-skills.mjs";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const DEGRADED_SKILL_MD = `---
name: odoo-logistics
---
# Odoo Logistics Access

Bootstrap your environment, then use the client:

\`\`\`bash
python3 scripts/provision_logistics_user.py --dry-run
python3 scripts/mint_logistics_key.py
\`\`\`

The wrapper lives in \`scripts/odoo_client.py\`. Model-by-model field notes are
in references/models.md, and the reconciliation contract is in
\`references/reconciliation.md\`.
`;

const degradedSkill = {
  id: "a2b07431-2b45-4793-9bca-fc9dadd51ef3",
  key: "goldberry-playground/odoocker-goldberrygrove/odoo-logistics",
  slug: "odoo-logistics",
  sourceType: "github",
  trustLevel: "markdown_only",
  attachedAgentCount: 0,
  fileInventory: [{ path: "SKILL.md", kind: "skill" }],
  markdown: DEGRADED_SKILL_MD,
};

const healthySkill = {
  id: "f4c5cc76-842a-4411-8567-982d536d2bef",
  key: "company/6a74334e/odoo-logistics",
  slug: "odoo-logistics",
  sourceType: "local_path",
  trustLevel: "scripts_executables",
  attachedAgentCount: 1,
  fileInventory: [
    { path: "SKILL.md", kind: "skill" },
    { path: "scripts/provision_logistics_user.py", kind: "script" },
    { path: "scripts/mint_logistics_key.py", kind: "script" },
    { path: "scripts/odoo_client.py", kind: "script" },
    { path: "references/models.md", kind: "reference" },
    { path: "references/reconciliation.md", kind: "reference" },
  ],
  markdown: DEGRADED_SKILL_MD,
};

console.log("extractReferencedPaths");

test("finds paths in fenced commands, backticks, and bare prose", () => {
  const paths = extractReferencedPaths(DEGRADED_SKILL_MD);
  for (const expected of [
    "scripts/provision_logistics_user.py",
    "scripts/mint_logistics_key.py",
    "scripts/odoo_client.py",
    "references/models.md",
    "references/reconciliation.md",
  ]) {
    assert.ok(paths.has(expected), `missing ${expected}`);
  }
  assert.equal(paths.size, 5);
});

test("a URL that merely contains scripts/ is not a skill file", () => {
  // Otherwise every SKILL.md linking to a repo tree reds itself.
  const paths = extractReferencedPaths("See https://github.com/o/r/tree/main/scripts/odoo_client.py");
  assert.equal(paths.size, 0);
});

test("a bare directory and an extensionless heading are not files", () => {
  assert.equal(extractReferencedPaths("everything under scripts/ is wired").size, 0);
  assert.equal(extractReferencedPaths("see references/models for fields").size, 0);
});

test("trailing prose punctuation is stripped", () => {
  assert.ok(extractReferencedPaths("run `scripts/odoo_client.py`.").has("scripts/odoo_client.py"));
  assert.ok(extractReferencedPaths("(see references/models.md),").has("references/models.md"));
});

test("a path outside the known skill subdirectories is ignored", () => {
  assert.equal(extractReferencedPaths("patch src/odoo_client.py in the repo").size, 0);
});

console.log("auditSkill");

test("reconstructs the GOL-2963 degraded install", () => {
  const finding = auditSkill(degradedSkill);
  assert.equal(finding.degraded, true);
  assert.equal(finding.installedCount, 1);
  assert.deepEqual(finding.droppedPaths, [
    "references/models.md",
    "references/reconciliation.md",
    "scripts/mint_logistics_key.py",
    "scripts/odoo_client.py",
    "scripts/provision_logistics_user.py",
  ]);
  const codes = finding.reasons.map((r) => r.code);
  assert.deepEqual(codes, ["documented_files_missing", "scripts_executables_blocked"]);
});

test("the re-homed local_path twin is clean", () => {
  const finding = auditSkill(healthySkill);
  assert.equal(finding.degraded, false);
  assert.deepEqual(finding.droppedPaths, []);
});

test("a markdown-only skill that documents no files is clean", () => {
  // Most platform skills are legitimately SKILL.md-only — they must not red.
  const finding = auditSkill({
    key: "paperclipai/paperclip/paperclip-board",
    slug: "paperclip-board",
    sourceType: "local_path",
    trustLevel: "markdown_only",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    markdown: "# Board\n\nUse the board API.",
  });
  assert.equal(finding.degraded, false);
});

test("a local_path skill missing a documented file still reds, without the trust reason", () => {
  // Same user-visible failure (agent runs a file that is not there), different
  // cause: a packaging mistake rather than the external-source trust gate.
  const finding = auditSkill({ ...degradedSkill, sourceType: "local_path", trustLevel: "scripts_executables" });
  assert.equal(finding.degraded, true);
  assert.deepEqual(finding.reasons.map((r) => r.code), ["documented_files_missing"]);
});

console.log("auditSkills");

test("separates degraded from healthy and reports the slug collision", () => {
  const audit = auditSkills([degradedSkill, healthySkill]);
  assert.equal(audit.checked, 2);
  assert.equal(audit.degraded.length, 1);
  assert.equal(audit.degraded[0].sourceType, "github");
  assert.equal(audit.healthy.length, 1);
  assert.deepEqual(audit.slugCollisions, [
    {
      slug: "odoo-logistics",
      keys: ["company/6a74334e/odoo-logistics", "goldberry-playground/odoocker-goldberrygrove/odoo-logistics"],
    },
  ]);
});

test("a clean library produces no findings", () => {
  const audit = auditSkills([healthySkill]);
  assert.equal(audit.degraded.length, 0);
  assert.equal(audit.slugCollisions.length, 0);
  assert.match(formatReport(audit), /no degraded installs/);
});

test("the report names the dropped entrypoint, not just a count", () => {
  // The whole point is that the next agent reads *which* file is missing
  // instead of re-diagnosing it as a credential problem.
  const report = formatReport(auditSkills([degradedSkill]));
  assert.match(report, /scripts\/odoo_client\.py/);
  assert.match(report, /scripts_executables_blocked/);
});

console.log("skill-audit-ignore");

// Regression: the live 2026-10-05 run reded `paperclip-board-writes` for
// `scripts/paperclip-upload-artifact.sh` — a path its SKILL.md quotes as
// *evidence about the bundled `paperclip` skill's inventory*, not as its own
// entrypoint. A control that wrongly reds a skill attached to all 7 agents is
// a control people learn to ignore.
const QUOTING_SKILL_MD = `---
name: paperclip-board-writes
---
<!-- skill-audit-ignore: scripts/paperclip-upload-artifact.sh -->

The bundled skill's \`fileInventory\` contains exactly one script,
\`scripts/paperclip-upload-artifact.sh\`, which is why the helper it documents
path-404s. Use \`scripts/set_blockers.py\` from *this* skill instead.
`;

const quotingSkill = {
  id: "87d032ee",
  key: "company/6a74334e/paperclip-board-writes",
  slug: "paperclip-board-writes",
  sourceType: "local_path",
  trustLevel: "scripts_executables",
  attachedAgentCount: 7,
  fileInventory: ["SKILL.md", "scripts/set_blockers.py"],
  markdown: QUOTING_SKILL_MD,
};

test("parses one or many ignore markers, tolerating backticks and commas", () => {
  const ignored = extractIgnoredPaths(
    "a <!-- skill-audit-ignore: scripts/a.sh, references/b.md -->\n" +
      "b <!--skill-audit-ignore:  `scripts/c.py` -->",
  );
  assert.deepEqual([...ignored].sort(), ["references/b.md", "scripts/a.sh", "scripts/c.py"]);
});

test("a quoted foreign path declared ignored does not red the skill", () => {
  const finding = auditSkill(quotingSkill);
  assert.equal(finding.degraded, false, "declared-ignored path must not count as dropped");
  assert.deepEqual(finding.droppedPaths, []);
  assert.deepEqual(finding.ignoredPaths, ["scripts/paperclip-upload-artifact.sh"]);
});

test("the suppression is printed, never silent", () => {
  const report = formatReport(auditSkills([quotingSkill]));
  assert.match(report, /SUPPRESSED/);
  assert.match(report, /scripts\/paperclip-upload-artifact\.sh/);
});

test("an undeclared missing path still reds, so the marker cannot be forgotten into silence", () => {
  const noMarker = { ...quotingSkill, markdown: QUOTING_SKILL_MD.replace(/<!-- skill-audit-ignore:[^>]*-->/, "") };
  assert.equal(auditSkill(noMarker).degraded, true);
});

test("a marker cannot hide a path the skill genuinely invokes elsewhere -- it is per-path, not a blanket mute", () => {
  // Declaring one path ignored must not excuse a second, undeclared one.
  const twoMissing = {
    ...quotingSkill,
    markdown: QUOTING_SKILL_MD + "\nThen run `scripts/really-missing.sh` to finish.\n",
  };
  const finding = auditSkill(twoMissing);
  assert.equal(finding.degraded, true);
  assert.deepEqual(finding.droppedPaths, ["scripts/really-missing.sh"]);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall audit-company-skills tests passed");
