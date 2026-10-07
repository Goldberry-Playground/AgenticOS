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
import { readFile } from "node:fs/promises";
import {
  ACKNOWLEDGEMENT_FILE,
  auditSkill,
  auditSkills,
  extractIgnoredPaths,
  extractReferencedPaths,
  formatReport,
  parseAcknowledgements,
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

console.log("\nexpiring acknowledgements (editable:false skills)");

// The real shape this lane exists for: the bundled `paperclip` skill documents
// a script the package does not ship, and is installed `editable:false` so its
// body cannot be annotated honest. Without an ack lane the weekly audit reds on
// this forever, which is how a control gets muted.
const VENDORED_SKILL_MD = `---
name: paperclip
---
For a multiline comment body, run \`scripts/paperclip-issue-update.sh\`.
`;

const vendoredSkill = {
  id: "22758459-6c0a-4e5a-9b4f-2a4b7f0c9d11",
  key: "paperclipai/paperclip/paperclip",
  slug: "paperclip",
  sourceType: "local_path",
  trustLevel: "scripts_executables",
  editable: false,
  attachedAgentCount: 1,
  fileInventory: [{ path: "SKILL.md" }, { path: "scripts/paperclip-upload-artifact.sh" }],
  markdown: VENDORED_SKILL_MD,
};

const NOW = new Date("2026-10-06T06:00:00Z");
const ackFor = (overrides = {}) => [
  {
    skillKey: "paperclipai/paperclip/paperclip",
    path: "scripts/paperclip-issue-update.sh",
    expires: "2027-01-06",
    expiresAt: new Date("2027-01-06T23:59:59.999Z"),
    issue: "GOL-3030",
    reason: "upstream package drift; mitigated by paperclip-board-writes",
    ...overrides,
  },
];

test("with no acknowledgement the vendored skill reds", () => {
  const finding = auditSkill(vendoredSkill, { now: NOW });
  assert.equal(finding.degraded, true);
  assert.deepEqual(finding.droppedPaths, ["scripts/paperclip-issue-update.sh"]);
});

test("an in-date acknowledgement on an editable:false skill suppresses the finding", () => {
  const finding = auditSkill(vendoredSkill, { acknowledgements: ackFor(), now: NOW });
  assert.equal(finding.degraded, false);
  assert.deepEqual(finding.droppedPaths, []);
  assert.equal(finding.acknowledgedPaths.length, 1);
  assert.equal(finding.acknowledgedPaths[0].issue, "GOL-3030");
});

test("the acknowledgement is printed with its issue and expiry, never silent", () => {
  const report = formatReport(auditSkills([vendoredSkill], { acknowledgements: ackFor(), now: NOW }));
  assert.match(report, /ACKNOWLEDGED/);
  assert.match(report, /GOL-3030/);
  assert.match(report, /expires 2027-01-06/);
});

test("an EXPIRED acknowledgement stops suppressing and the finding reds again", () => {
  const stale = ackFor({ expires: "2026-10-01", expiresAt: new Date("2026-10-01T23:59:59.999Z") });
  const finding = auditSkill(vendoredSkill, { acknowledgements: stale, now: NOW });
  assert.equal(finding.degraded, true, "an expired entry must not suppress");
  assert.deepEqual(finding.droppedPaths, ["scripts/paperclip-issue-update.sh"]);
  assert.equal(finding.expiredAcknowledgements.length, 1);
  const report = formatReport(auditSkills([vendoredSkill], { acknowledgements: stale, now: NOW }));
  assert.match(report, /ACKNOWLEDGEMENT EXPIRED/);
});

test("an entry expiring today is still in date (end-of-day, not start)", () => {
  const today = ackFor({ expires: "2026-10-06", expiresAt: new Date("2026-10-06T23:59:59.999Z") });
  assert.equal(auditSkill(vendoredSkill, { acknowledgements: today, now: NOW }).degraded, false);
});

test("an acknowledgement expiring within 14 days says so, so renewal is not a surprise", () => {
  const soon = ackFor({ expires: "2026-10-12", expiresAt: new Date("2026-10-12T23:59:59.999Z") });
  const report = formatReport(auditSkills([vendoredSkill], { acknowledgements: soon, now: NOW }));
  assert.match(report, /expiring soon/);
});

test("the ack file is REJECTED for an editable skill -- that case must use the in-body marker", () => {
  const editable = { ...vendoredSkill, editable: true };
  const finding = auditSkill(editable, { acknowledgements: ackFor(), now: NOW });
  assert.equal(finding.degraded, true, "an editable skill must not be silenced out of band");
  assert.equal(finding.rejectedAcknowledgements.length, 1);
  const report = formatReport(auditSkills([editable], { acknowledgements: ackFor(), now: NOW }));
  assert.match(report, /ACKNOWLEDGEMENT REJECTED/);
});

test("a payload that omits `editable` is treated as editable -- fail closed, no suppression on a guess", () => {
  const { editable: _unused, ...unknown } = vendoredSkill;
  assert.equal(auditSkill(unknown, { acknowledgements: ackFor(), now: NOW }).degraded, true);
});

test("an acknowledgement is per-path and per-skill, not a blanket mute", () => {
  const twoMissing = {
    ...vendoredSkill,
    markdown: VENDORED_SKILL_MD + "\nAlso run `scripts/paperclip-not-shipped.sh`.\n",
  };
  const finding = auditSkill(twoMissing, { acknowledgements: ackFor(), now: NOW });
  assert.equal(finding.degraded, true);
  assert.deepEqual(finding.droppedPaths, ["scripts/paperclip-not-shipped.sh"]);
  // An entry naming another skill's key must not reach this one.
  const wrongSkill = ackFor({ skillKey: "someone-else/other/skill" });
  assert.equal(auditSkill(vendoredSkill, { acknowledgements: wrongSkill, now: NOW }).degraded, true);
});

test("an acknowledgement whose finding is gone is reported STALE but does not red a clean library", () => {
  const fixed = {
    ...vendoredSkill,
    fileInventory: [...vendoredSkill.fileInventory, { path: "scripts/paperclip-issue-update.sh" }],
  };
  const audit = auditSkills([fixed], { acknowledgements: ackFor(), now: NOW });
  assert.equal(audit.degraded.length, 0, "a tidy-up must not fail the audit");
  assert.equal(audit.results[0].staleAcknowledgements.length, 1);
  assert.match(formatReport(audit), /STALE ACKNOWLEDGEMENT/);
});

console.log("\nacknowledgement file parsing (fail closed)");

test("parseAcknowledgements accepts a well-formed entry and derives end-of-day expiry", () => {
  const { entries, errors } = parseAcknowledgements(
    JSON.stringify({
      acknowledgements: [
        { skillKey: "a/b/c", path: "scripts/x.sh", expires: "2027-01-06", issue: "GOL-1", reason: "why" },
      ],
    }),
  );
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].expiresAt.toISOString(), "2027-01-06T23:59:59.999Z");
});

test("every field is mandatory -- a nameless or unexplained entry is an error, not an entry", () => {
  for (const field of ["skillKey", "path", "expires", "issue", "reason"]) {
    const entry = { skillKey: "a/b/c", path: "scripts/x.sh", expires: "2027-01-06", issue: "GOL-1", reason: "why" };
    delete entry[field];
    const { entries, errors } = parseAcknowledgements(JSON.stringify({ acknowledgements: [entry] }));
    assert.equal(entries.length, 0, `missing ${field} must not yield an entry`);
    assert.match(errors[0], new RegExp(field));
  }
});

test("a malformed expiry is rejected rather than coerced into a permanent mute", () => {
  for (const expires of ["soon", "2027-13-99", "06/01/2027", ""]) {
    const { entries, errors } = parseAcknowledgements(
      JSON.stringify({
        acknowledgements: [
          { skillKey: "a/b/c", path: "scripts/x.sh", expires, issue: "GOL-1", reason: "why" },
        ],
      }),
    );
    assert.equal(entries.length, 0, `"${expires}" must not be honoured`);
    assert.ok(errors.length > 0);
  }
});

test("unparseable or shapeless JSON yields an error and zero entries", () => {
  assert.equal(parseAcknowledgements("{not json").entries.length, 0);
  assert.ok(parseAcknowledgements("{not json").errors.length > 0);
  assert.ok(parseAcknowledgements(JSON.stringify({})).errors.length > 0);
});

test("a bad entry is reported in the report, so it cannot fail silently", () => {
  const { errors } = parseAcknowledgements(JSON.stringify({ acknowledgements: [{ path: "scripts/x.sh" }] }));
  const report = formatReport(auditSkills([vendoredSkill], { acknowledgementErrors: errors, now: NOW }));
  assert.match(report, /BAD ACKNOWLEDGEMENT/);
});

console.log("\nthe shipped acknowledgement file");

test("the committed scripts/ops/skill-audit-acknowledged.json is valid and fully explained", async () => {
  const url = new URL(`../ops/${ACKNOWLEDGEMENT_FILE}`, import.meta.url);
  const { entries, errors } = parseAcknowledgements(await readFile(url, "utf8"));
  assert.deepEqual(errors, [], "the file we ship must parse clean");
  for (const entry of entries) {
    assert.match(entry.issue, /^GOL-\d+$/, `${entry.path}: issue must be a GOL ticket`);
    assert.ok(entry.reason.length > 40, `${entry.path}: reason must actually explain itself`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall audit-company-skills tests passed");
