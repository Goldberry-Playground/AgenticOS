"use client";

import { useMemo, useState } from "react";
import { X, Copy, ExternalLink, Check } from "lucide-react";
import type { InboxNote } from "@agenticos/vault-core";

interface PromoteReviewDrawerProps {
  inboxPath: string;
  note: InboxNote;
  categories: string[];
  onClose: () => void;
}

/**
 * Mirror of `buildFrontmatter` in vault-core (packages/vault-core/src/store/in-memory.ts).
 * Implemented inline so the drawer never imports the server-only store — promotion is a
 * client-side draft, not a cloud write.
 */
function renderFrontmatter(opts: {
  title: string;
  tags: string[];
  created: string;
  updated: string;
}): string {
  const lines = ["---"];
  lines.push(`title: ${JSON.stringify(opts.title)}`);
  if (opts.tags.length > 0) {
    lines.push(`tags: [${opts.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
  }
  lines.push(`created: ${JSON.stringify(opts.created)}`);
  lines.push(`updated: ${JSON.stringify(opts.updated)}`);
  lines.push("---");
  return lines.join("\n");
}

export function PromoteReviewDrawer({
  inboxPath,
  note,
  categories,
  onClose,
}: PromoteReviewDrawerProps) {
  const [category, setCategory] = useState(categories[0] ?? "");
  const [title, setTitle] = useState(note.title);
  const [tagsRaw, setTagsRaw] = useState("");
  const [copied, setCopied] = useState(false);

  const draft = useMemo(() => {
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const frontmatter = renderFrontmatter({
      title,
      tags,
      created: today,
      updated: today,
    });
    return `${frontmatter}\n\n${note.body}`;
  }, [title, tagsRaw, note.body]);

  const deepLink = `obsidian://open?vault=vault&file=inbox/${encodeURIComponent(
    inboxPath
  )}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort; the rendered <pre> is the fallback
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Promote inbox note"
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-y-auto shadow-xl"
        style={{
          width: "480px",
          backgroundColor: "var(--surface)",
          borderLeft: "1px solid var(--border-subtle)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            Promote to Obsidian
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 transition-opacity hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Editable fields */}
        <div className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Category (top-level wiki folder)
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--surface-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
            >
              {categories.length === 0 && <option value="">(none)</option>}
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--surface-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
              placeholder="Page title"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Tags (comma-separated)
            </span>
            <input
              type="text"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="rounded border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--surface-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
              placeholder="tag-one, tag-two"
            />
          </label>

          {/* Drafted markdown preview */}
          <div className="flex flex-col gap-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Drafted page
            </span>
            <pre
              className="rounded border px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words"
              style={{
                backgroundColor: "var(--surface-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
            >
              {draft}
            </pre>
          </div>

          {/* Instruction */}
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Create <code>wiki/{category || "<Category>"}/{title || "<name>"}.md</code> in
            Obsidian with this content, then Discard the inbox item.
          </p>
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-2 p-4 border-t mt-auto"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--surface-elevated)",
              color: "var(--text)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>

          <a
            href={deepLink}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "var(--accent-plum-400)",
              color: "#fff",
            }}
          >
            <ExternalLink size={12} />
            Open in Obsidian
          </a>
        </div>
      </aside>
    </>
  );
}
