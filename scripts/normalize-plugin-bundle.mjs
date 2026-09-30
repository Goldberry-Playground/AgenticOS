#!/usr/bin/env node
/**
 * normalize-plugin-bundle.mjs — GOL-2694
 *
 * Strip the pnpm virtual-store prefix out of the module-boundary comments
 * esbuild stamps into a bundle, so the committed `packages/*\/dist/**`
 * artifact stops churning on dependency bumps that change nothing executable.
 *
 * WHY THIS EXISTS
 * ---------------
 * The plugin `dist/` bundles ARE the deployed artifact: docker-compose
 * bind-mounts `packages/<p>` into paperclip-server, so the committed bytes are
 * what the droplet runs (GOL-2585/GOL-2591). The CI "Build" job therefore
 * rebuilds and refuses any PR whose committed dist differs from a fresh build
 * (the GOL-2612 stale-dist guard, #717). That guard is correct and stays armed.
 *
 * The problem is that esbuild labels every inlined module with its real path on
 * disk, and under pnpm that path embeds the resolved version:
 *
 *   // ../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/util.js
 *
 * So a PURE patch bump of a bundled dependency — zero executable change —
 * rewrites hundreds of comment lines in every worker and reds `Build` until a
 * human or agent hand-runs `pnpm -w build` and pushes the regenerated dist.
 * That cost a full merge-queue cycle on #713 (GOL-2685: 820 changed lines,
 * 820/820 provenance-only) and recurs on every `@paperclipai/plugin-sdk`
 * release.
 *
 * Normalizing the comment to the package-relative path:
 *
 *   // node_modules/zod/v4/core/util.js
 *
 * keeps every bit of information a reader of the bundle actually wants (which
 * package and file this chunk came from) while making the bundle a function of
 * the dependency's CONTENT instead of its version string. A version-only bump
 * now produces a byte-identical dist and `Build` stays green with no rebuild;
 * a bump that genuinely changes code still moves the bundle and still — as it
 * must — reds the guard until the artifact is regenerated.
 *
 * WHAT IT REWRITES (deliberately narrow)
 * --------------------------------------
 * A line is rewritten only when ALL of these hold:
 *   1. the whole line is `// ` followed by a single whitespace-free token;
 *   2. that token contains `/node_modules/.pnpm/`;
 *   3. the line is immediately preceded by a blank line.
 * That is exactly the shape esbuild emits for a module boundary, and it was
 * verified against all 1295 such lines in the six committed plugin bundles
 * (100% conforming). Anything else — including a path that merely mentions
 * `.pnpm` inside code or a string — is left untouched. The rewrite keeps the
 * path suffix after the LAST `/node_modules/` segment, which is the
 * package-relative path (`@scope/pkg/dist/x.js` for scoped packages).
 *
 * The transform is idempotent: a normalized line no longer contains `.pnpm`.
 *
 * Usage:  node scripts/normalize-plugin-bundle.mjs <file> [<file> ...]
 *         node scripts/normalize-plugin-bundle.mjs --check <file> [...]
 *
 * `--check` rewrites nothing and exits 1 if any file would change; it is how
 * the unit test and any future CI assertion ask "is this bundle normalized?".
 * Exit 0 otherwise. Prints one line per file it actually rewrote.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const MODULE_COMMENT = /^\/\/ (\S+)$/;

/**
 * Normalize the text of one bundle. Pure; returns the new text.
 * @param {string} text
 * @returns {string}
 */
export function normalizeBundle(text) {
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    // Anchor 3: esbuild always separates a module boundary with a blank line.
    if (lines[i - 1] !== '') continue;
    const m = MODULE_COMMENT.exec(lines[i]);
    if (!m) continue;
    const path = m[1];
    if (!path.includes('/node_modules/.pnpm/')) continue;
    // Everything after the final `/node_modules/` is the package-relative
    // path. Package subpaths never contain a `node_modules` segment, so the
    // last occurrence is unambiguous.
    const cut = path.lastIndexOf('/node_modules/');
    lines[i] = `// node_modules/${path.slice(cut + '/node_modules/'.length)}`;
  }
  return lines.join('\n');
}

function main(argv) {
  const check = argv[0] === '--check';
  const files = check ? argv.slice(1) : argv;
  if (files.length === 0) {
    console.error('usage: normalize-plugin-bundle.mjs [--check] <file> [<file> ...]');
    return 2;
  }
  let drifted = 0;
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    const after = normalizeBundle(before);
    if (before === after) continue;
    drifted += 1;
    if (check) {
      console.error(`not normalized: ${file}`);
    } else {
      writeFileSync(file, after);
      console.log(`normalized: ${file}`);
    }
  }
  return check && drifted > 0 ? 1 : 0;
}

// Only run as a CLI; importing this module for tests must have no side effects.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
