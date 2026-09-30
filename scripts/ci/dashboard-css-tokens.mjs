#!/usr/bin/env node
/**
 * GOL-2650: undefined CSS custom-property guard for apps/dashboard.
 *
 * `var(--border)` shipped on main at ten call sites. `--border` was never
 * defined (globals.css names the scale `--border-brand` / `--border-subtle` /
 * `--border-strong`), so `border-color: var(--border)` was invalid at
 * computed-value time and fell back to the initial value `currentColor` — a
 * bright cream on the dark theme. Typecheck, lint and the Playwright project
 * are all blind to it: a missing custom property is not a syntax error, and the
 * rendered result is merely *wrong*, not broken.
 *
 * This guard closes that hole. It collects every custom property *defined*
 * anywhere under apps/dashboard (CSS declarations and inline style objects)
 * and every fallback-less `var(--name)` *reference*, then fails on references
 * with no definition. Comments are blanked out first, so a commented-out
 * declaration cannot pass itself off as a definition.
 *
 * A `var(--name, fallback)` reference is exempt by design: the fallback is the
 * author declaring the name may be absent (e.g. `var(--font-jetbrains-mono,
 * monospace)`, injected by next/font rather than declared in CSS).
 *
 * Usage: node scripts/ci/dashboard-css-tokens.mjs [dashboardDir]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const EXTENSIONS = [".css", ".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo"]);

/**
 * Blank out comments, preserving every byte offset and newline so reported line
 * numbers stay accurate.
 *
 * Why this is not optional: a commented-out declaration used to register as a
 * *definition*, which silently switched the guard off for exactly the token it
 * was written to protect. `/* --border: #2e2925; retired *\/` left every
 * `var(--border)` in the tree unflagged — GOL-2650 all over again, now with a
 * green check over it. Retiring a token by commenting it out is the single most
 * likely way this guard gets defeated, so it has to see through comments.
 *
 * Block comments are comments in both CSS and TS/TSX. Line comments are TS/TSX
 * only; the `[^:"'\\]` lookbehind keeps `https://…` and `"//cdn/x.png"` intact
 * (CSS has no `//` comment, so stripping one there would be a false positive).
 */
export function stripComments(source) {
  const blank = (text) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
}

/**
 * Every custom property this source *defines*:
 *   - CSS declarations           `--surface: #1a1714;`
 *   - inline style objects       `{ "--normal-bg": "var(--surface)" }`
 *   - next/font injections       `Inter({ variable: "--font-inter" })`
 *
 * The next/font case matters: `--font-inter` is emitted onto <html> by the font
 * loader's className, never by globals.css, so reading it in globals.css is
 * correct. Recognising the declaration keeps the guard honest without an
 * allowlist — a hole that only ever grows.
 */
export function collectDefinitions(rawSource) {
  const source = stripComments(rawSource);
  const names = new Set();
  for (const m of source.matchAll(/(?:^|[\s;{(])(--[A-Za-z0-9_-]+)\s*:/g)) names.add(m[1]);
  for (const m of source.matchAll(/["'](--[A-Za-z0-9_-]+)["']\s*:/g)) names.add(m[1]);
  for (const m of source.matchAll(/\bvariable\s*:\s*["'](--[A-Za-z0-9_-]+)["']/g)) names.add(m[1]);
  return names;
}

/**
 * Every fallback-less `var(--name)` reference, with its 1-indexed line.
 * `var(--name, fallback)` is intentionally skipped.
 */
export function collectReferences(rawSource) {
  const source = stripComments(rawSource);
  const refs = [];
  for (const m of source.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)) {
    refs.push({ name: m[1], line: source.slice(0, m.index).split("\n").length });
  }
  return refs;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** @returns {{files: number, defined: Set<string>, undefinedRefs: Array<{file:string,line:number,name:string}>}} */
export function auditDirectory(root) {
  const files = walk(root);
  const sources = files.map((f) => [f, readFileSync(f, "utf8")]);

  const defined = new Set();
  for (const [, src] of sources) for (const n of collectDefinitions(src)) defined.add(n);

  const undefinedRefs = [];
  for (const [file, src] of sources) {
    for (const ref of collectReferences(src)) {
      if (!defined.has(ref.name)) {
        undefinedRefs.push({ file: relative(root, file), line: ref.line, name: ref.name });
      }
    }
  }
  undefinedRefs.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { files: files.length, defined, undefinedRefs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? "apps/dashboard";
  const { files, defined, undefinedRefs } = auditDirectory(root);
  if (undefinedRefs.length > 0) {
    for (const { file, line, name } of undefinedRefs) {
      // GitHub Actions annotates `::error file=…,line=…::` inline on the diff.
      console.log(`::error file=${join(root, file)},line=${line}::${name} is not defined in ${root} — it resolves to the property's initial value (border-color -> currentColor). Use a defined token, or add an explicit var(${name}, <fallback>).`);
    }
    console.error(`\n✗ ${undefinedRefs.length} undefined custom-property reference(s) across ${files} file(s) in ${root}`);
    process.exit(1);
  }
  console.log(`✓ ${root}: every var(--x) reference resolves (${files} files, ${defined.size} properties defined)`);
}
