"use client";

import { ExternalLink, FileText, Loader2, AlertCircle } from "lucide-react";
import { useVaultPage } from "@/lib/vault/hooks/use-vault-page";
import { RenderPageBody } from "@/lib/markdown/render-page";

interface MemoryReaderProps {
  path: string | null;
}

const VAULT_WIKI_ROOT =
  "/Users/joshuadunbar/Documents/Dev Projects/vault/wiki/";

function buildObsidianUrl(pagePath: string): string {
  const absolutePath = VAULT_WIKI_ROOT + pagePath + ".md";
  return "obsidian://open?path=" + encodeURIComponent(absolutePath);
}

export function MemoryReader({ path }: MemoryReaderProps) {
  const { data: page, isLoading, isError } = useVaultPage(path);

  if (!path) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ backgroundColor: "var(--bg)" }}
      >
        <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>
          Select a page from the sidebar.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-1 items-center justify-center gap-2"
        style={{ backgroundColor: "var(--bg)" }}
      >
        <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        <span className="text-[14px]" style={{ color: "var(--text-muted)" }}>
          Loading page…
        </span>
      </div>
    );
  }

  if (isError || page === null || page === undefined) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2"
        style={{ backgroundColor: "var(--bg)" }}
      >
        <AlertCircle size={20} style={{ color: "var(--error)" }} />
        <p className="text-[14px]" style={{ color: "var(--error)" }}>
          {isError ? "Failed to load page." : "Page not found."}
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          {path}
        </p>
      </div>
    );
  }

  // page is WikiPage here — all falsy cases are handled above
  const obsidianUrl = buildObsidianUrl(page.path);

  return (
    <article
      className="flex flex-col flex-1 overflow-y-auto"
      style={{ backgroundColor: "var(--bg)" }}
    >
      {/* Page header */}
      <div
        className="flex items-start justify-between gap-4 px-8 pt-8 pb-6 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-start gap-3">
          <FileText
            size={20}
            strokeWidth={1.5}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <div>
            <h1
              className="font-medium mb-2"
              style={{ color: "var(--text)", fontSize: "22px", lineHeight: 1.2 }}
            >
              {page.title}
            </h1>
            <div className="flex flex-wrap gap-1.5">
              {page.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] px-1.5 py-0.5 rounded-sm font-medium"
                  style={{
                    color: "var(--accent-plum-300)",
                    backgroundColor: "var(--accent-plum-950)",
                    border: "1px solid var(--accent-plum-700)",
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Header actions. The reader/graph toggle lives in the Memory
            toolbar, not here: this component unmounts in graph mode, so a
            toggle rendered inside it could never show its "on" state (or be
            used to switch back). See GOL-2950. */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Open in Obsidian */}
          <a
            href={obsidianUrl}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium border transition-colors shrink-0"
          style={{
            color: "var(--text-secondary)",
            borderColor: "var(--border-brand)",
            backgroundColor: "var(--surface)",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.color = "var(--text)";
            el.style.borderColor = "var(--border-strong)";
            el.style.backgroundColor = "var(--surface-elevated)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.color = "var(--text-secondary)";
            el.style.borderColor = "var(--border-brand)";
            el.style.backgroundColor = "var(--surface)";
          }}
            title={obsidianUrl}
          >
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" />
            Open in Obsidian
          </a>
        </div>
      </div>

      {/* Page body */}
      <div className="px-8 py-6 max-w-3xl">
        <RenderPageBody body={page.body} />
      </div>

      {/* Path breadcrumb */}
      <div className="px-8 pb-8 mt-auto">
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          wiki/{page.path}
        </p>
      </div>
    </article>
  );
}
