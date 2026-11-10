import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import type {
  WikiPath,
  InboxPath,
  WikiPage,
  InboxNote,
  VaultIndex,
  LintIssue,
  TreeNode,
  TagInfo,
  VaultStats,
} from "../types";
import type { VaultStore } from "./vault-store";
import { safeResolve } from "../path/safe-resolve";
import { parseFrontmatter } from "../parse/frontmatter";
import { extractWikilinks, resolveWikilinks } from "../parse/wikilinks";
import { extractTags, mergeTags } from "../parse/tags";
import { processMarkdown } from "../parse/pipeline";
import { detectBrokenLinks } from "../lint/broken-links";
import { detectOrphans } from "../lint/orphans";
import { detectTodos } from "../lint/todos";
// VaultPathError imported for external callers; thrown via safeResolve
import type { VaultPathError as _VaultPathError } from "./errors";

const TTL_MS = 30_000;

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

interface InMemoryConfig {
  /** Absolute path to the vault root directory. */
  vaultRoot: string;
  /** TTL in milliseconds (default: 30 000) */
  ttlMs?: number;
  /**
   * Subdirectory under `vaultRoot` that holds wiki pages (default: `"wiki"`).
   * Set to `""` to treat the vault root itself as the page root — used on the
   * live Droplet, whose Obsidian vault keeps pages at the root (e.g.
   * `farming/…`) rather than under a `wiki/` folder. In root mode the inbox
   * queue and dotfolders are still excluded (see `walkMarkdown`).
   */
  wikiSubdir?: string;
}

/** Group lookup for tag taxonomy */
function inferTagGroup(tag: string): string {
  const lower = tag.toLowerCase();
  if (/^(goldberry|instnt|personal)/.test(lower)) return "project";
  if (/^(cowork|code)/.test(lower)) return "lane";
  if (/^(farm|marketing|video|software|concepts)/.test(lower) || lower === "personal") {
    return "domain";
  }
  return "default";
}

/** Extract title: first # heading, then first non-empty line */
function extractTitle(body: string, fallback: string): string {
  const lines = body.split("\n");
  for (const line of lines) {
    const parts = /^#{1,6}\s+(.+)$/.exec(line);
    if (parts) return (parts[1] ?? "").slice(0, 120);
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 120);
  }
  return fallback.slice(0, 120);
}

/**
 * Recursively collect `.md` file paths under `dir`.
 *
 * Directories whose name begins with `.` (e.g. Syncthing's `.stfolder`,
 * agent-generated `.summaries`, `.obsidian`, `.git`) are always skipped, and
 * any absolute path in `exclude` is pruned. The `exclude` set lets root-mode
 * stores keep the sibling `inbox/` queue out of the wiki page index.
 */
async function walkMarkdown(
  dir: string,
  exclude: ReadonlySet<string> = new Set()
): Promise<string[]> {
  const results: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" }) as import("node:fs").Dirent[];
  } catch {
    return results;
  }
  for (const entry of entries) {
    const name = entry.name as string;
    const full = path.join(dir, name);
    if (entry.isDirectory()) {
      if (name.startsWith(".") || exclude.has(full)) continue;
      results.push(...(await walkMarkdown(full, exclude)));
    } else if (entry.isFile() && /\.md$/i.test(name)) {
      results.push(full);
    }
  }
  return results;
}

export class InMemoryVaultStore implements VaultStore {
  private readonly vaultRoot: string;
  private readonly ttlMs: number;
  private readonly wikiSubdir: string;
  private index: VaultIndex | null = null;
  private ttlExpiresAt = 0;
  // Notes dropped from the index this revalidate() because their frontmatter
  // wouldn't parse. Surfaced through lint() so a broken note is visible in the
  // UI instead of silently vanishing from search. Rebuilt atomically with the
  // index below.
  private malformedNotes: LintIssue[] = [];

  constructor(config: InMemoryConfig) {
    this.vaultRoot = config.vaultRoot;
    this.ttlMs = config.ttlMs ?? TTL_MS;
    this.wikiSubdir = config.wikiSubdir ?? "wiki";
  }

  private get wikiDir(): string {
    // Empty subdir → the vault root itself is the page root.
    return this.wikiSubdir
      ? path.join(this.vaultRoot, this.wikiSubdir)
      : this.vaultRoot;
  }

  private get inboxDir(): string {
    return path.join(this.vaultRoot, "inbox");
  }

  // The rebuild currently running on behalf of ensureIndex(), shared by every
  // caller that finds the index cold or stale while it runs. Without this, N
  // concurrent reads after the TTL lapses start N full rebuilds, each holding
  // its own copy of every note in memory: the dashboard's /memory graph fires
  // ~157 /page reads at once, and that took vault-server past its 256 MiB heap
  // on 2026-11-10. Explicit revalidate() calls (writes, POST /revalidate)
  // still rebuild unconditionally.
  private rebuildInFlight: Promise<void> | null = null;

  private async ensureIndex(): Promise<VaultIndex> {
    if (this.index && Date.now() < this.ttlExpiresAt) {
      return this.index;
    }
    if (!this.rebuildInFlight) {
      this.rebuildInFlight = this.revalidate().finally(() => {
        this.rebuildInFlight = null;
      });
    }
    await this.rebuildInFlight;
    return this.index!;
  }

  async revalidate(): Promise<void> {
    // In root mode (wikiDir === vaultRoot) the inbox queue is a sibling under
    // the same root, so exclude it explicitly. In the default wiki/ mode the
    // exclusion is a harmless no-op (inboxDir isn't under wikiDir).
    const files = await walkMarkdown(this.wikiDir, new Set([this.inboxDir]));
    const pages = new Map<WikiPath, WikiPage>();
    const allTags = new Set<string>();
    const malformed: LintIssue[] = [];

    // Type helper for temp field during build
    type PageWithRefs = WikiPage & { _rawRefs?: ReturnType<typeof extractWikilinks> };

    // First pass: parse all pages
    for (const absFile of files) {
      const relNoExt = path
        .relative(this.wikiDir, absFile)
        .replace(/\.md$/i, "");

      let raw: string;
      try {
        raw = await fs.readFile(absFile, "utf8");
      } catch {
        continue;
      }

      // A single note with malformed frontmatter (e.g. an unquoted title
      // containing a second colon) must not take down the whole index — that
      // 500'd /stats, /tree, and /list in production. Skip the bad file with a
      // warning, exactly as the unreadable-file case above continues.
      let meta: Record<string, unknown>;
      let body: string;
      try {
        ({ meta, body } = parseFrontmatter(raw));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`[vault] skipping ${relNoExt}: ${detail}`);
        malformed.push({ kind: "malformed-frontmatter", path: relNoExt, detail });
        continue;
      }

      const fmTags = Array.isArray(meta["tags"])
        ? (meta["tags"] as string[])
        : [];
      const inlineTags = extractTags(body);
      const tags = mergeTags(fmTags, inlineTags);
      tags.forEach((t) => allTags.add(t));

      const stat = await fs.stat(absFile).catch(() => null);
      const mtime = stat?.mtime.toISOString() ?? new Date().toISOString();

      const fmTitle = typeof meta["title"] === "string" ? meta["title"] : null;
      const title = (fmTitle ?? extractTitle(body, relNoExt)).slice(0, 120);

      const bodyAst = await processMarkdown(body);
      const wikilinkRefs = extractWikilinks(body);

      const page: PageWithRefs = {
        path: relNoExt,
        title,
        tags,
        created: typeof meta["created"] === "string" ? meta["created"] : mtime,
        updated: typeof meta["updated"] === "string" ? meta["updated"] : mtime,
        sources: Array.isArray(meta["sources"])
          ? (meta["sources"] as string[])
          : [],
        body,
        bodyAst,
        outgoing: [],
        unresolvedLinks: [],
        _rawRefs: wikilinkRefs,
      };

      pages.set(relNoExt, page);
    }

    // Second pass: resolve wikilinks + compute backlinks
    const knownPaths = [...pages.keys()];
    const backlinks = new Map<WikiPath, WikiPath[]>();
    knownPaths.forEach((p) => backlinks.set(p, []));

    for (const [pagePath, rawPage] of pages) {
      const page = rawPage as PageWithRefs;
      const refs = page._rawRefs ?? [];

      const { resolved, unresolved } = resolveWikilinks(refs, knownPaths);
      page.outgoing = resolved;
      page.unresolvedLinks = unresolved;
      delete page._rawRefs;

      for (const target of resolved) {
        const existing = backlinks.get(target) ?? [];
        existing.push(pagePath);
        backlinks.set(target, existing);
      }
    }

    this.index = { pages, backlinks, allTags, builtAt: Date.now() };
    this.malformedNotes = malformed;
    this.ttlExpiresAt = Date.now() + this.ttlMs;
  }

  async list(): Promise<{ tree: TreeNode; flat: WikiPath[] }> {
    const idx = await this.ensureIndex();
    const flat = [...idx.pages.keys()];

    const nodeMap = new Map<string, TreeNode>();

    // Collect folder paths
    const folderSet = new Set<string>();
    for (const p of flat) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        folderSet.add(parts.slice(0, i).join("/"));
      }
    }

    // Create folder nodes
    for (const folder of folderSet) {
      nodeMap.set(folder, {
        path: folder,
        name: folder.split("/").pop()!,
        kind: "folder",
        children: [],
      });
    }

    // Create page nodes
    for (const p of flat) {
      nodeMap.set(p, {
        path: p,
        name: p.split("/").pop()!,
        kind: "page",
      });
    }

    const root: TreeNode = { path: "/", name: "wiki", kind: "folder", children: [] };

    for (const [nodePath, node] of nodeMap) {
      const parentPath = nodePath.includes("/")
        ? nodePath.split("/").slice(0, -1).join("/")
        : null;

      if (parentPath === null) {
        root.children!.push(node);
      } else {
        const parent = nodeMap.get(parentPath);
        if (parent?.kind === "folder") {
          parent.children!.push(node);
        }
      }
    }

    return { tree: root, flat };
  }

  async read(pagePath: WikiPath): Promise<WikiPage | null> {
    const idx = await this.ensureIndex();
    return idx.pages.get(pagePath) ?? null;
  }

  async search(
    query: string,
    opts?: { tags?: string[]; limit?: number }
  ): Promise<WikiPage[]> {
    const idx = await this.ensureIndex();
    const q = query.toLowerCase();
    const filterTags = opts?.tags ?? [];
    const limit = opts?.limit ?? 50;
    const results: WikiPage[] = [];

    for (const page of idx.pages.values()) {
      if (
        filterTags.length > 0 &&
        !filterTags.every((t) => page.tags.includes(t))
      ) {
        continue;
      }
      if (
        q &&
        !page.body.toLowerCase().includes(q) &&
        !page.title.toLowerCase().includes(q)
      ) {
        continue;
      }
      results.push(page);
      if (results.length >= limit) break;
    }

    return results;
  }

  async getBacklinks(pagePath: WikiPath): Promise<WikiPath[]> {
    const idx = await this.ensureIndex();
    return idx.backlinks.get(pagePath) ?? [];
  }

  async getOutgoing(pagePath: WikiPath): Promise<WikiPath[]> {
    const idx = await this.ensureIndex();
    return idx.pages.get(pagePath)?.outgoing ?? [];
  }

  async getAllTags(): Promise<TagInfo[]> {
    const idx = await this.ensureIndex();
    const countMap = new Map<string, number>();
    for (const page of idx.pages.values()) {
      for (const tag of page.tags) {
        countMap.set(tag, (countMap.get(tag) ?? 0) + 1);
      }
    }
    return [...countMap.entries()].map(([id, count]) => ({
      id,
      label: id,
      count,
      group: inferTagGroup(id),
    }));
  }

  async listInbox(): Promise<InboxNote[]> {
    let fileNames: string[];
    try {
      const rawEntries = await fs.readdir(this.inboxDir, { withFileTypes: true, encoding: "utf8" }) as import("node:fs").Dirent[];
      fileNames = rawEntries
        .filter((e) => e.isFile() && /\.md$/i.test(e.name as string))
        .map((e) => path.join(this.inboxDir, e.name as string));
    } catch {
      return [];
    }

    const notes: InboxNote[] = [];
    for (const absFile of fileNames) {
      const note = await this._readInboxFile(absFile);
      if (note) notes.push(note);
    }
    return notes;
  }

  async readInbox(inboxPath: InboxPath): Promise<InboxNote | null> {
    const abs = safeResolve(this.inboxDir, inboxPath);
    return this._readInboxFile(abs);
  }

  private async _readInboxFile(absFile: string): Promise<InboxNote | null> {
    try {
      const raw = await fs.readFile(absFile, "utf8");
      const stat = await fs.stat(absFile);
      const { body } = parseFrontmatter(raw);
      const relPath = path.relative(this.inboxDir, absFile);
      const title = extractTitle(body, relPath.replace(/\.md$/i, ""));
      return {
        path: relPath,
        capturedAt: stat.mtime.toISOString(),
        title,
        body,
      };
    } catch {
      return null;
    }
  }

  async lint(): Promise<LintIssue[]> {
    const idx = await this.ensureIndex();
    // ensureIndex() has just (re)built the index, so this.malformedNotes is
    // in sync with it. List malformed notes first — they're the most actionable
    // (the note is missing from search until fixed), not merely advisory.
    return [
      ...this.malformedNotes,
      ...detectBrokenLinks(idx),
      ...detectOrphans(idx),
      ...detectTodos(idx),
    ];
  }

  async promoteInbox(
    inboxPath: InboxPath,
    page: Omit<WikiPage, "bodyAst" | "outgoing" | "unresolvedLinks">
  ): Promise<WikiPage> {
    // Validate path safety (throws VaultPathError on violations)
    safeResolve(this.wikiDir, page.path + ".md");
    const inboxAbs = safeResolve(this.inboxDir, inboxPath);
    const destAbs = safeResolve(this.wikiDir, page.path + ".md");
    const destDir = path.dirname(destAbs);

    await fs.mkdir(destDir, { recursive: true });

    const frontmatter = buildFrontmatter(page);
    const content = `${frontmatter}\n${page.body}`;

    const tmpFile = path.join(
      os.tmpdir(),
      `vault-promote-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
    );
    await fs.writeFile(tmpFile, content, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmpFile, destAbs);
    await fs.chmod(destAbs, 0o600);

    try {
      await fs.unlink(inboxAbs);
    } catch {
      // Non-fatal
    }

    await this.revalidate();

    const bodyAst = await processMarkdown(page.body);
    const refs = extractWikilinks(page.body);
    const knownPaths = [...this.index!.pages.keys()];
    const { resolved, unresolved } = resolveWikilinks(refs, knownPaths);

    return { ...page, bodyAst, outgoing: resolved, unresolvedLinks: unresolved };
  }

  async discardInbox(inboxPath: InboxPath): Promise<void> {
    const abs = safeResolve(this.inboxDir, inboxPath);
    const archiveDir = path.join(this.inboxDir, "archived");
    await fs.mkdir(archiveDir, { recursive: true });

    const base = path.basename(abs);
    let dest = path.join(archiveDir, base);
    // Don't clobber an existing archived note of the same name.
    if (await pathExists(dest)) {
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      dest = path.join(archiveDir, `${stem}-${Date.now()}${ext}`);
    }
    await fs.rename(abs, dest);
  }

  async stats(): Promise<VaultStats> {
    // Build (or refresh) the index first, like every other read method. Without
    // this, a cold `/api/vault/stats` — the first route hit after a restart —
    // reported pageCount 0 until some other route happened to warm the index.
    const index = await this.ensureIndex();
    return {
      pageCount: index.pages.size,
      builtAt: index.builtAt,
      ttlExpiresAt: this.ttlExpiresAt,
    };
  }
}

function buildFrontmatter(
  page: Omit<WikiPage, "bodyAst" | "outgoing" | "unresolvedLinks">
): string {
  const lines = ["---"];
  lines.push(`title: ${JSON.stringify(page.title)}`);
  if (page.tags.length > 0) {
    lines.push(`tags: [${page.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
  }
  if (page.created) lines.push(`created: ${JSON.stringify(page.created)}`);
  if (page.updated) lines.push(`updated: ${JSON.stringify(page.updated)}`);
  if (page.sources.length > 0) {
    lines.push(`sources: [${page.sources.map((s) => JSON.stringify(s)).join(", ")}]`);
  }
  lines.push("---");
  return lines.join("\n");
}
