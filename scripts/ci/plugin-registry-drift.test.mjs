// plugin-registry-drift.test.mjs — GOL-2423
//
// Adding a plugin to the droplet deploy path used to mean editing six
// independently-maintained hardcoded lists. They DID drift: discord-plugin was
// in deploy-droplet-plugins.yml's build loop but missing from
// detect-manifest-bumps.sh AND finish-plugin-upgrade.sh, so a discord manifest
// bump either went undetected or hard-failed CD with "unknown plugin" — the
// stale-registry trap GOL-733 exists to prevent.
//
// scripts/plugin-registry.sh is now the single source of truth (PLUGIN_DIRS).
// The shell consumers source it, but the YAML workflows and docker-compose.yml
// cannot, so they still carry literal lists. This test asserts every one of
// those literals equals PLUGIN_DIRS, turning a future drift into a red PR
// instead of a broken deploy.
//
// Run: node scripts/ci/plugin-registry-drift.test.mjs
//      (auto-discovered by the `CI scripts` job in .github/workflows/ci.yml)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
  }
}

// --- source of truth ---------------------------------------------------------
const registry = read("scripts/plugin-registry.sh");
const dirsLine = /^PLUGIN_DIRS="([^"]+)"/m.exec(registry);
if (!dirsLine) {
  console.error("FATAL: could not read PLUGIN_DIRS from scripts/plugin-registry.sh");
  process.exit(1);
}
const PLUGINS = dirsLine[1].trim().split(/\s+/);
console.log(`PLUGIN_DIRS = ${PLUGINS.join(" ")}\n`);

const pendingLine = /^PLUGIN_PENDING_INSTALL="([^"]*)"/m.exec(registry);
const PENDING = (pendingLine?.[1] || "").trim().split(/\s+/).filter(Boolean);

// --- docker-compose.yml bind mounts -----------------------------------------
// Every plugin needs `./packages/<p>:/paperclip/plugins/<p>:ro` or the container
// reports "Missing package.json" on install (GOL-165/166).
const compose = read("docker-compose.yml");
const mounts = [...compose.matchAll(
  /^\s*-\s*\.\/packages\/([a-z0-9-]+):\/paperclip\/plugins\/([a-z0-9-]+):ro$/gm,
)];
for (const m of mounts) {
  if (m[1] !== m[2]) {
    failures += 1;
    console.error(`  FAIL docker-compose mount host/container mismatch: ${m[1]} -> ${m[2]}`);
  }
}
check("docker-compose.yml plugin bind mounts", mounts.map((m) => m[1]), PLUGINS);

// --- deploy-droplet-plugins.yml ---------------------------------------------
const deploy = read(".github/workflows/deploy-droplet-plugins.yml");
check(
  "deploy-droplet-plugins.yml paths trigger",
  [...deploy.matchAll(/^\s*-\s*'packages\/([a-z0-9-]+)\/\*\*'$/gm)].map((m) => m[1]),
  PLUGINS,
);
// Both the `pnpm install --filter` and the `pnpm ... build` lists, in order.
const filters = [...deploy.matchAll(/--filter @agenticos\/([a-z0-9-]+)/g)].map((m) => m[1]);
check("deploy-droplet-plugins.yml pnpm --filter lists", filters, [...PLUGINS, ...PLUGINS]);
const distLoop = /for p in ([a-z0-9 -]+); do\n\s*for f in dist\/worker\.js/.exec(deploy);
check(
  "deploy-droplet-plugins.yml dist completeness loop",
  distLoop ? distLoop[1].trim().split(/\s+/) : null,
  PLUGINS,
);

// --- recreate-paperclip-server.yml ------------------------------------------
const recreate = read(".github/workflows/recreate-paperclip-server.yml");
const recreateList = /plugins="([a-z0-9 -]+)"/.exec(recreate);
check(
  "recreate-paperclip-server.yml mount verify list",
  recreateList ? recreateList[1].trim().split(/\s+/) : null,
  PLUGINS,
);

// --- detect-manifest-bumps.sh -----------------------------------------------
const detect = read("scripts/detect-manifest-bumps.sh");
const detectLoop = /^for p in ([a-z0-9 -]+); do$/m.exec(detect);
check(
  "detect-manifest-bumps.sh loop",
  detectLoop ? detectLoop[1].trim().split(/\s+/) : null,
  PLUGINS,
);

// --- every plugin dir declares a manifest id --------------------------------
// plugin_key() reads the declared id rather than assuming "agenticos.<dir>";
// grove-content-drafter-plugin declares agenticos.grove-content-drafter. Assert
// each manifest is readable so plugin_key never silently hits its fallback.
for (const p of PLUGINS) {
  let id = null;
  try {
    id = /id:\s*"(agenticos\.[^"]+)"/.exec(read(`packages/${p}/src/manifest.ts`))?.[1] ?? null;
  } catch {
    /* reported below */
  }
  if (id) console.log(`  ok  packages/${p}/src/manifest.ts declares ${id}`);
  else {
    failures += 1;
    console.error(`  FAIL packages/${p}/src/manifest.ts: no id: "agenticos.*" found`);
  }
}

// --- pending-install entries must be real plugins ---------------------------
for (const p of PENDING) {
  if (PLUGINS.includes(p)) console.log(`  ok  PLUGIN_PENDING_INSTALL entry ${p} is in PLUGIN_DIRS`);
  else {
    failures += 1;
    console.error(`  FAIL PLUGIN_PENDING_INSTALL entry '${p}' is not in PLUGIN_DIRS`);
  }
}

if (failures) {
  console.error(
    `\n${failures} plugin-registry drift failure(s). Update the listed file(s) to match ` +
      `PLUGIN_DIRS in scripts/plugin-registry.sh.`,
  );
  process.exit(1);
}
console.log("\nplugin-registry-drift: all plugin lists agree with PLUGIN_DIRS");
