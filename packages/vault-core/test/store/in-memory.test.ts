import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// InMemoryVaultStore carries `import "server-only"` which Next.js replaces with
// a runtime error in client bundles. In a Node/Vitest environment the package
// exports a no-op, so the import is safe here.
import { InMemoryVaultStore } from "../../src/store/in-memory.js";

let tmpDir: string;
let wikiDir: string;
let inboxDir: string;
let store: InMemoryVaultStore;

async function writeWikiPage(relPath: string, content: string): Promise<void> {
  const abs = path.join(wikiDir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

async function writeInboxNote(name: string, content: string): Promise<void> {
  await fs.mkdir(inboxDir, { recursive: true });
  await fs.writeFile(path.join(inboxDir, name), content, "utf8");
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-core-test-"));
  wikiDir = path.join(tmpDir, "wiki");
  inboxDir = path.join(tmpDir, "inbox");
  await fs.mkdir(wikiDir, { recursive: true });
  await fs.mkdir(inboxDir, { recursive: true });

  store = new InMemoryVaultStore({ vaultRoot: tmpDir, ttlMs: 60_000 });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("InMemoryVaultStore - list", () => {
  it("returns empty tree when wiki dir has no pages", async () => {
    const { flat } = await store.list();
    expect(flat).toHaveLength(0);
  });

  it("lists pages in the flat array", async () => {
    await writeWikiPage("Farm/Plot A12.md", "# Plot A12\n\nContent here.");
    await writeWikiPage("Software/Notes.md", "# Notes\n\nSome notes.");
    await store.revalidate();
    const { flat } = await store.list();
    expect(flat).toContain("Farm/Plot A12");
    expect(flat).toContain("Software/Notes");
  });
});

describe("InMemoryVaultStore - malformed frontmatter resilience", () => {
  // Regression: a single note with an unquoted title containing a second
  // colon ("Bruno & Carlo: Cousin Connection") produced malformed YAML
  // ("Nested mappings are not allowed in compact mappings"), and because
  // revalidate() parsed frontmatter without a guard, that one file 500'd
  // the entire vault API — /stats, /tree, and /list all went down.
  const BAD = `---\ntitle: Helvetia Campaign — Bruno & Carlo: Cousin Connection\ntags: [tabletop]\n---\nBody.`;

  it("skips a malformed-frontmatter file instead of failing the whole index", async () => {
    await writeWikiPage("Good/One.md", "# One\n\nFine.");
    await writeWikiPage("Bad/Broken.md", BAD);
    await writeWikiPage("Good/Two.md", "# Two\n\nAlso fine.");

    // Must not throw — the bug was that this rejected.
    await expect(store.revalidate()).resolves.not.toThrow();

    const { flat } = await store.list();
    expect(flat).toContain("Good/One");
    expect(flat).toContain("Good/Two");
    // The broken page is skipped, not indexed.
    expect(flat).not.toContain("Bad/Broken");
  });

  it("stats() succeeds and counts only the parseable pages", async () => {
    await writeWikiPage("Good/One.md", "# One");
    await writeWikiPage("Bad/Broken.md", BAD);
    const stats = await store.stats();
    expect(stats.pageCount).toBe(1);
  });

  it("surfaces the skipped note as a malformed-frontmatter lint issue", async () => {
    await writeWikiPage("Good/One.md", "# One");
    await writeWikiPage("Bad/Broken.md", BAD);
    const issues = await store.lint();
    const malformed = issues.filter((i) => i.kind === "malformed-frontmatter");
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.path).toBe("Bad/Broken");
    expect(malformed[0]!.detail).toMatch(/frontmatter/i);
  });

  it("clears the malformed issue once the note is fixed and revalidated", async () => {
    await writeWikiPage("Bad/Broken.md", BAD);
    expect(await store.lint()).toHaveLength(1);
    // Quote the title — the real-world fix.
    await writeWikiPage(
      "Bad/Broken.md",
      `---\ntitle: "Helvetia Campaign — Bruno & Carlo: Cousin Connection"\ntags: [tabletop]\n---\nBody.`
    );
    await store.revalidate();
    expect(
      (await store.lint()).filter((i) => i.kind === "malformed-frontmatter")
    ).toHaveLength(0);
  });
});

describe("InMemoryVaultStore - read", () => {
  it("returns null for unknown page", async () => {
    const page = await store.read("Nonexistent");
    expect(page).toBeNull();
  });

  it("reads a page with correct title from frontmatter", async () => {
    await writeWikiPage(
      "Farm/Plot.md",
      `---\ntitle: My Farm Plot\ntags: [farm]\n---\n# Heading\nBody text.`
    );
    await store.revalidate();
    const page = await store.read("Farm/Plot");
    expect(page).not.toBeNull();
    expect(page!.title).toBe("My Farm Plot");
    expect(page!.tags).toContain("farm");
  });

  it("falls back to first heading for title when no frontmatter title", async () => {
    await writeWikiPage("Notes/Simple.md", "# My Heading\n\nSome content.");
    await store.revalidate();
    const page = await store.read("Notes/Simple");
    expect(page!.title).toBe("My Heading");
  });

  it("includes bodyAst as a parsed mdast Root", async () => {
    await writeWikiPage("Notes/WithAst.md", "# Heading\n\nParagraph text.");
    await store.revalidate();
    const page = await store.read("Notes/WithAst");
    expect(page!.bodyAst.type).toBe("root");
    expect(page!.bodyAst.children.length).toBeGreaterThan(0);
  });
});

describe("InMemoryVaultStore - backlinks", () => {
  it("computes backlinks correctly", async () => {
    await writeWikiPage("A.md", "Links to [[B]]");
    await writeWikiPage("B.md", "# B\n\nNo links.");
    await store.revalidate();
    const backlinks = await store.getBacklinks("B");
    expect(backlinks).toContain("A");
  });

  it("returns empty array for page with no backlinks", async () => {
    await writeWikiPage("Isolated.md", "# Isolated\n\nNo links.");
    await store.revalidate();
    const backlinks = await store.getBacklinks("Isolated");
    expect(backlinks).toHaveLength(0);
  });
});

describe("InMemoryVaultStore - getAllTags", () => {
  it("returns tags with counts and groups", async () => {
    await writeWikiPage("P1.md", "---\ntags: [farm, software]\n---\nContent");
    await writeWikiPage("P2.md", "---\ntags: [farm]\n---\nMore content");
    await store.revalidate();
    const tags = await store.getAllTags();
    const farm = tags.find((t) => t.id === "farm");
    expect(farm).toBeDefined();
    expect(farm!.count).toBe(2);
    expect(farm!.group).toBe("domain");
    const sw = tags.find((t) => t.id === "software");
    expect(sw).toBeDefined();
    expect(sw!.group).toBe("domain");
  });
});

describe("InMemoryVaultStore - search", () => {
  beforeEach(async () => {
    await writeWikiPage(
      "Farm/Syntropic.md",
      "---\ntags: [farm]\n---\n# Syntropic Plot\n\nSyntropic agriculture content."
    );
    await writeWikiPage(
      "Software/TS.md",
      "---\ntags: [software]\n---\n# TypeScript\n\nType system notes."
    );
    await store.revalidate();
  });

  it("returns pages matching a query string", async () => {
    const results = await store.search("syntropic");
    expect(results.some((p) => p.path === "Farm/Syntropic")).toBe(true);
  });

  it("filters by tags (AND semantics)", async () => {
    const results = await store.search("", { tags: ["farm"] });
    expect(results.every((p) => p.tags.includes("farm"))).toBe(true);
    expect(results.some((p) => p.path === "Software/TS")).toBe(false);
  });

  it("returns empty array when no match", async () => {
    const results = await store.search("zzz-no-match-xyz");
    expect(results).toHaveLength(0);
  });
});

describe("InMemoryVaultStore - listInbox / readInbox", () => {
  it("returns empty array when inbox is empty", async () => {
    const notes = await store.listInbox();
    expect(notes).toHaveLength(0);
  });

  it("lists inbox notes", async () => {
    await writeInboxNote("fleeting-note.md", "# Quick idea\n\nSomething I thought of.");
    const notes = await store.listInbox();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("Quick idea");
  });

  it("reads a specific inbox note by path", async () => {
    await writeInboxNote("idea.md", "# Great Idea\n\nBody here.");
    const note = await store.readInbox("idea.md");
    expect(note).not.toBeNull();
    expect(note!.title).toBe("Great Idea");
  });

  it("returns null for non-existent inbox note", async () => {
    const note = await store.readInbox("missing.md");
    expect(note).toBeNull();
  });
});

describe("InMemoryVaultStore - promoteInbox", () => {
  it("writes a new wiki page and removes the inbox note", async () => {
    await writeInboxNote("raw.md", "# Raw Idea\n\nSome body.");
    const now = new Date().toISOString();
    await store.promoteInbox("raw.md", {
      path: "Concepts/New Idea",
      title: "New Idea",
      tags: ["concepts"],
      created: now,
      updated: now,
      sources: [],
      body: "Refined body here.",
    });

    // Wiki file should exist
    const wikiFile = path.join(wikiDir, "Concepts/New Idea.md");
    const content = await fs.readFile(wikiFile, "utf8");
    expect(content).toContain("Refined body here.");

    // Inbox file should be deleted
    const inboxFile = path.join(inboxDir, "raw.md");
    await expect(fs.access(inboxFile)).rejects.toThrow();

    // Index should be refreshed
    const page = await store.read("Concepts/New Idea");
    expect(page).not.toBeNull();
  });

  it("rejects path-unsafe destinations", async () => {
    await writeInboxNote("raw.md", "body");
    await expect(
      store.promoteInbox("raw.md", {
        path: "../escape",
        title: "Escape",
        tags: [],
        created: "",
        updated: "",
        sources: [],
        body: "malicious",
      })
    ).rejects.toThrow();
  });
});

describe("InMemoryVaultStore - discardInbox", () => {
  it("removes the inbox note file", async () => {
    await writeInboxNote("discard-me.md", "Fleeting thought.");
    await store.discardInbox("discard-me.md");
    const noteFile = path.join(inboxDir, "discard-me.md");
    await expect(fs.access(noteFile)).rejects.toThrow();
  });

  it("rejects path-unsafe paths", async () => {
    await expect(store.discardInbox("../outside.md")).rejects.toThrow();
  });
});

describe("InMemoryVaultStore - discardInbox (archive, not delete)", () => {
  it("moves the inbox note into inbox/archived/ instead of deleting it", async () => {
    await writeInboxNote("toss.md", "# Toss\n\nfleeting");
    await store.discardInbox("toss.md");

    // original gone
    await expect(fs.access(path.join(inboxDir, "toss.md"))).rejects.toThrow();
    // archived copy exists with same content
    const archived = await fs.readFile(
      path.join(inboxDir, "archived", "toss.md"),
      "utf8",
    );
    expect(archived).toContain("fleeting");
  });

  it("disambiguates when an archived file of the same name already exists", async () => {
    await writeInboxNote("dup.md", "first");
    await store.discardInbox("dup.md");
    await writeInboxNote("dup.md", "second");
    await store.discardInbox("dup.md");

    const names = await fs.readdir(path.join(inboxDir, "archived"));
    expect(names.filter((n) => n.startsWith("dup")).length).toBe(2);
  });
});

describe("InMemoryVaultStore - revalidate + stats", () => {
  it("bumps builtAt on revalidate", async () => {
    await store.revalidate();
    const first = (await store.stats()).builtAt;
    // Small sleep to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));
    await store.revalidate();
    const second = (await store.stats()).builtAt;
    expect(second).toBeGreaterThan(first);
  });

  it("stats returns correct pageCount after revalidate", async () => {
    await writeWikiPage("PageOne.md", "# One");
    await writeWikiPage("PageTwo.md", "# Two");
    await store.revalidate();
    expect((await store.stats()).pageCount).toBe(2);
  });
});

describe("InMemoryVaultStore - configurable wiki root (wikiSubdir)", () => {
  // The live Droplet vault keeps pages at the vault root (e.g. `farming/…`)
  // rather than under a `wiki/` subdir. `wikiSubdir: ""` makes the store treat
  // the vault root itself as the page root, while still excluding the inbox
  // queue and dotfolders (Syncthing's `.stfolder`, agent `.summaries`, etc.).
  let rootStore: InMemoryVaultStore;

  beforeEach(() => {
    rootStore = new InMemoryVaultStore({
      vaultRoot: tmpDir,
      ttlMs: 60_000,
      wikiSubdir: "",
    });
  });

  it("reads pages from the vault root when wikiSubdir is empty", async () => {
    // Write directly under the vault root (not under wiki/).
    await fs.writeFile(path.join(tmpDir, "HELLO.md"), "# Hello", "utf8");
    await fs.mkdir(path.join(tmpDir, "farming"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "farming", "notes.md"),
      "# Notes",
      "utf8"
    );
    await rootStore.revalidate();
    const { flat } = await rootStore.list();
    expect(flat).toContain("HELLO");
    expect(flat).toContain("farming/notes");
  });

  it("excludes the inbox/ queue from wiki pages in root mode", async () => {
    await writeInboxNote("capture.md", "# Captured");
    await fs.writeFile(path.join(tmpDir, "Real.md"), "# Real", "utf8");
    await rootStore.revalidate();
    const { flat } = await rootStore.list();
    expect(flat).toContain("Real");
    expect(flat).not.toContain("inbox/capture");
  });

  it("excludes dotfolders (.summaries, .stfolder) from wiki pages in root mode", async () => {
    await fs.mkdir(path.join(tmpDir, ".summaries"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".summaries", "auto.md"),
      "# Auto summary",
      "utf8"
    );
    await fs.writeFile(path.join(tmpDir, "Kept.md"), "# Kept", "utf8");
    await rootStore.revalidate();
    const { flat } = await rootStore.list();
    expect(flat).toContain("Kept");
    expect(flat).not.toContain(".summaries/auto");
  });

  it("still defaults to the wiki/ subdir when wikiSubdir is unset", async () => {
    await writeWikiPage("Under/Wiki.md", "# Under wiki");
    // A root-level file must NOT appear under the default (wiki/) store.
    await fs.writeFile(path.join(tmpDir, "RootLevel.md"), "# Root", "utf8");
    await store.revalidate();
    const { flat } = await store.list();
    expect(flat).toContain("Under/Wiki");
    expect(flat).not.toContain("RootLevel");
  });
});

describe("InMemoryVaultStore - concurrent cold reads (thundering herd)", () => {
  // Regression (2026-11-10): the dashboard's /memory graph fires one
  // /page request per note (~157) at once. With an expired TTL, every one of
  // them ran its own full revalidate() -- 157 parallel copies of the whole
  // vault index -- and vault-server died at its 256 MiB heap limit.
  it("shares one index rebuild across concurrent callers", async () => {
    for (let i = 0; i < 20; i++) {
      await writeWikiPage(`Farm/Note ${i}.md`, `# Note ${i}\n\nBody [[Note ${(i + 1) % 20}]].`);
    }
    const spy = vi.spyOn(store, "revalidate");

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.read(`Farm/Note ${i % 20}`))
    );

    expect(results.every((p) => p !== null)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds again once the shared rebuild has settled and the TTL lapses", async () => {
    const short = new InMemoryVaultStore({ vaultRoot: tmpDir, ttlMs: 0 });
    await writeWikiPage("Farm/A.md", "# A");
    const spy = vi.spyOn(short, "revalidate");

    await Promise.all([short.read("Farm/A"), short.read("Farm/A")]);
    await short.read("Farm/A");

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
