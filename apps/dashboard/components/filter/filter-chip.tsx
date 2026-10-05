"use client";

import React, { useState, useMemo } from "react";
import { ChevronDown, Search, X, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useFilter } from "@/lib/filter/use-filter";

interface Tag {
  id: string;
  label: string;
  group: string;
}

const TAGS: Tag[] = [
  { id: "all", label: "All", group: "default" },
  { id: "goldberry", label: "Goldberry Grove", group: "project" },
  { id: "instnt", label: "Instnt", group: "project" },
  { id: "personal", label: "Personal", group: "project" },
  { id: "cowork", label: "Cowork", group: "lane" },
  { id: "code", label: "Code", group: "lane" },
  { id: "farm", label: "Farm", group: "domain" },
  { id: "marketing", label: "Marketing", group: "domain" },
  { id: "video", label: "Video", group: "domain" },
  { id: "software", label: "Software", group: "domain" },
];

const GROUP_LABELS: Record<string, string> = {
  project: "Projects",
  lane: "Lanes",
  domain: "Domains",
};

const SELECTABLE_TAGS = TAGS.filter((t) => t.id !== "all");

function getChipLabel(tags: string[], allTags: Tag[]): string {
  if (tags.length === 0) return "Filter: All";
  if (tags.length === 1) {
    const tag = allTags.find((t) => t.id === tags[0]);
    return tag ? `Filter: ${tag.label}` : `Filter: ${tags[0]}`;
  }
  if (tags.length === 2) {
    const labels = tags.map((id) => {
      const tag = allTags.find((t) => t.id === id);
      return tag?.label ?? id;
    });
    return `Filter: ${labels[0]} +1`;
  }
  const first = allTags.find((t) => t.id === tags[0]);
  return `Filter: ${first?.label ?? tags[0]} +${tags.length - 1}`;
}

export function FilterChip() {
  const { tags, toggleTag, clear } = useFilter();
  const [search, setSearch] = useState("");

  const filteredTags = useMemo(() => {
    if (!search.trim()) return SELECTABLE_TAGS;
    const q = search.toLowerCase();
    return SELECTABLE_TAGS.filter(
      (t) => t.label.toLowerCase().includes(q) || t.id.includes(q)
    );
  }, [search]);

  const groupedTags = useMemo(() => {
    const groups: Record<string, Tag[]> = {};
    for (const tag of filteredTags) {
      if (!groups[tag.group]) groups[tag.group] = [];
      groups[tag.group].push(tag);
    }
    return groups;
  }, [filteredTags]);

  const isActive = tags.length > 0;
  const chipLabel = getChipLabel(tags, TAGS);

  return (
    <Popover>
      <PopoverTrigger
        data-slot="filter-chip-trigger"
        className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--accent-plum-400]"
        style={{
          backgroundColor: "var(--surface-muted)",
          color: isActive ? "var(--accent-plum-300)" : "var(--text-secondary)",
          border: `1px solid ${isActive ? "var(--accent-plum-400)" : "var(--border-brand)"}`,
        }}
        aria-label="Open global filter"
      >
        {chipLabel}
        <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-72 p-0 overflow-hidden"
        style={{
          backgroundColor: "var(--surface-elevated)",
          border: "1px solid var(--border-brand)",
          borderRadius: "10px",
          boxShadow:
            "0 8px 24px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        {/* Search input */}
        <div
          className="px-3 pt-3 pb-2"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="relative flex items-center">
            <Search
              size={12}
              strokeWidth={1.5}
              className="absolute left-2.5 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            />
            <Input
              type="text"
              placeholder="Search tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-7 text-xs rounded-md"
              style={{
                backgroundColor: "var(--surface-muted)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
              aria-label="Search tags"
            />
          </div>
        </div>

        {/* Tag groups */}
        <div className="overflow-y-auto max-h-56 px-1.5 py-1.5">
          {Object.entries(groupedTags).length === 0 ? (
            <p
              className="px-2 py-3 text-xs text-center"
              style={{ color: "var(--text-muted)" }}
            >
              No tags match &ldquo;{search}&rdquo;
            </p>
          ) : (
            Object.entries(groupedTags).map(([group, groupTags]) => (
              <div key={group} className="mb-1.5">
                {/* Group header */}
                <p
                  className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest"
                  style={{ color: "var(--text-muted)" }}
                >
                  {GROUP_LABELS[group] ?? group}
                </p>

                {/* Tag rows */}
                {groupTags.map((tag) => {
                  const isChecked = tags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      role="checkbox"
                      aria-checked={isChecked}
                      onClick={() => toggleTag(tag.id)}
                      className="flex items-center gap-2.5 w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors"
                      style={{
                        backgroundColor: isChecked
                          ? "var(--accent-plum-900)"
                          : "transparent",
                        color: isChecked
                          ? "var(--accent-plum-300)"
                          : "var(--text-secondary)",
                      }}
                      onMouseEnter={(e) => {
                        if (!isChecked) {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                            "var(--surface-muted)";
                          (e.currentTarget as HTMLButtonElement).style.color =
                            "var(--text)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isChecked) {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                            "transparent";
                          (e.currentTarget as HTMLButtonElement).style.color =
                            "var(--text-secondary)";
                        }
                      }}
                    >
                      {/* Custom checkbox */}
                      <span
                        className="flex items-center justify-center rounded-sm shrink-0"
                        style={{
                          width: 14,
                          height: 14,
                          border: `1px solid ${isChecked ? "var(--accent-plum-500)" : "var(--border-strong)"}`,
                          backgroundColor: isChecked
                            ? "var(--accent-plum-700)"
                            : "transparent",
                        }}
                        aria-hidden="true"
                      >
                        {isChecked && (
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 9 9"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M1.5 4.5L3.5 6.5L7.5 2.5"
                              stroke="var(--accent-plum-300)"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      {tag.label}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          {/* Clear all */}
          <button
            type="button"
            onClick={clear}
            disabled={!isActive}
            className="flex items-center gap-1 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: isActive ? "var(--text-secondary)" : "var(--text-muted)" }}
            aria-label="Clear all filters"
          >
            <X size={11} strokeWidth={1.5} aria-hidden="true" />
            Clear all
          </button>

          {/* + New tag (disabled in Phase 1) */}
          <button
            type="button"
            disabled
            title="Available in Phase 2"
            aria-label="Create new tag — available in Phase 2"
            className="flex items-center gap-1 text-xs cursor-not-allowed opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            <Plus size={11} strokeWidth={1.5} aria-hidden="true" />
            New tag
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
