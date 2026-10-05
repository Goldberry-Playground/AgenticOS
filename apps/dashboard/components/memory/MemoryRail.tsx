"use client";

import { ArrowLeft, ArrowRight, Tag } from "lucide-react";
import { useVaultPage } from "@/lib/vault/hooks/use-vault-page";
import { useVaultBacklinks } from "@/lib/vault/hooks/use-vault-backlinks";
import { useFilter } from "@/lib/filter/use-filter";
import { LintPanel } from "./LintPanel";

interface MemoryRailProps {
  path: string | null;
  onNavigate: (path: string) => void;
}

export function MemoryRail({ path, onNavigate }: MemoryRailProps) {
  const { tags: activeTags, toggleTag } = useFilter();
  const { data: page } = useVaultPage(path);
  const { data: backlinks } = useVaultBacklinks(path);

  const backlinkPaths = backlinks ?? [];
  const outgoingPaths = page?.outgoing ?? [];
  const unresolvedLinks = page?.unresolvedLinks ?? [];
  const pageTags = page?.tags ?? [];

  return (
    <aside className="memory-rail">
      {/* Backlinks */}
      <section
        className="px-4 pt-5 pb-4 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-1.5 mb-3">
          <ArrowLeft
            size={12}
            strokeWidth={1.5}
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <p
            className="text-[11px] font-medium tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Backlinks
          </p>
        </div>
        {backlinkPaths.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {path ? "No backlinks." : "—"}
          </p>
        ) : (
          <ul className="space-y-1">
            {backlinkPaths.map((bp) => (
              <li key={bp}>
                <button
                  type="button"
                  onClick={() => onNavigate(bp)}
                  className="text-left text-[13px] w-full rounded-md px-2 py-1 transition-colors truncate"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      "var(--surface-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                  }}
                >
                  {bp.split("/").pop() ?? bp}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Outgoing links */}
      <section
        className="px-4 py-4 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-1.5 mb-3">
          <ArrowRight
            size={12}
            strokeWidth={1.5}
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <p
            className="text-[11px] font-medium tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Outgoing links
          </p>
        </div>
        {outgoingPaths.length === 0 && unresolvedLinks.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {path ? "No outgoing links." : "—"}
          </p>
        ) : (
          <ul className="space-y-1">
            {outgoingPaths.map((op) => (
              <li key={op}>
                <button
                  type="button"
                  onClick={() => onNavigate(op)}
                  className="text-left text-[13px] w-full rounded-md px-2 py-1 transition-colors truncate"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      "var(--surface-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                  }}
                >
                  {op.split("/").pop() ?? op}
                </button>
              </li>
            ))}
            {unresolvedLinks.map((link) => (
              <li key={link}>
                <span
                  className="block text-[13px] px-2 py-1 truncate"
                  style={{ color: "var(--error)" }}
                  title={`Broken link — "${link}" not found in vault`}
                >
                  {link.split("/").pop() ?? link}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tags */}
      <section
        className="px-4 py-4 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-1.5 mb-3">
          <Tag
            size={12}
            strokeWidth={1.5}
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <p
            className="text-[11px] font-medium tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Tags
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pageTags.length === 0 && (
            <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              {path ? "No tags." : "—"}
            </p>
          )}
          {pageTags.map((tag) => {
            const isActive = activeTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className="text-[11px] px-1.5 py-0.5 rounded-sm font-medium border transition-colors"
                style={{
                  color: isActive ? "var(--accent-plum-300)" : "var(--text-muted)",
                  backgroundColor: isActive ? "var(--accent-plum-800)" : "var(--surface-muted)",
                  borderColor: isActive ? "var(--accent-plum-600)" : "transparent",
                }}
                title={isActive ? "Remove filter" : "Filter by #" + tag}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      </section>

      <LintPanel onNavigate={onNavigate} />
    </aside>
  );
}
