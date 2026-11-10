import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";

interface SkillEntry {
  name: string;
  description: string;
  triggers: string[];
  usedBy: string[];
  path: string;
}

const SKILL_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * GET /skills — lists skill pages from the Obsidian vault's `wiki/Skills/`
 * directory (mirrored from ~/.claude/skills). The real vault nests skills by
 * domain (wiki/Skills/Software/…, wiki/Skills/Video/…), so the walk is
 * RECURSIVE — a flat readdir only sees the top-level _index/_plugin-skills and
 * misses the actual skill pages. Real skill pages frequently omit
 * `triggers`/`used_by`, so those default to []. Returns an empty list (not an
 * error) when the directory is missing, so the dashboard panel degrades cleanly.
 */
export function registerSkillsRoute(app: FastifyInstance, config: Config): void {
  app.get("/skills", async () => {
    const wikiSubdir = config.wikiSubdir ?? "wiki";
    const skillsRoot = path.join(config.vaultRoot, wikiSubdir, "Skills");

    const files = await walkMarkdown(skillsRoot);

    const skills: SkillEntry[] = [];
    for (const full of files) {
      const raw = await fs.readFile(full, "utf-8");
      const fm = parseFrontmatter(raw);
      if (!fm) continue;
      const base = path.basename(full).replace(/\.md$/, "");
      skills.push({
        // The vault's skills mirror (skills-vault sync) writes skill_name /
        // skill_description; hand-written pages use name / description.
        name: ((fm.name ?? fm.skill_name) as string) ?? base,
        description: ((fm.description ?? fm.skill_description) as string) ?? "",
        triggers: toStringArray(fm.triggers),
        usedBy: toStringArray(fm.used_by ?? fm.usedBy),
        // Path relative to the vault root, posix-normalized for the dashboard.
        path: path.relative(config.vaultRoot, full).split(path.sep).join("/"),
      });
    }

    return { totalRegistered: skills.length, skills };
  });
}

/** Recursively collect `.md` files under `dir`; [] if the dir is missing. */
async function walkMarkdown(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkMarkdown(full)));
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const match = SKILL_REGEX.exec(raw);
  if (!match) return null;
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      fm[key] = val;
    }
  }
  return fm;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}
