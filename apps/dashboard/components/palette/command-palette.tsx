"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, BookOpen, Activity, Settings } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { usePaletteStore } from "@/lib/palette/use-palette-store";
import { useFilter } from "@/lib/filter/use-filter";
import { useVaultSkills } from "@/lib/vault/hooks/use-vault-skills";
import { useVaultTree } from "@/lib/vault/hooks/use-vault-tree";
import { useRunFeed } from "@/lib/hooks/use-run-feed";

/**
 * CommandPalette — opened by ⌘K, the header button, or usePaletteStore.open().
 * Searches skills, wiki pages, and recent runs. Resets input on each open.
 *
 * Skills come from /api/vault/skills (the real vault-server registry — same
 * source the Architecture page renders; truth pass 2026-07-14, previously a
 * local fixtures file of invented skills). Selecting one opens the
 * Architecture page, where the skill catalog lives.
 *
 * Filter strategy: uses the built-in cmdk Command primitive filter, which scores
 * each item's `value` prop against the user's query using a simple fuzzy algorithm.
 * This is sufficient for these data sizes and avoids an extra dependency.
 *
 * Zero-result groups are hidden automatically by cmdk (CommandGroup renders nothing
 * when all its children are filtered out) — no manual hide logic needed.
 */
export function CommandPalette() {
  const isOpen = usePaletteStore((s) => s.isOpen);
  const close = usePaletteStore((s) => s.close);
  const router = useRouter();
  const { clear: clearFilter } = useFilter();
  const { data: vaultTree } = useVaultTree();
  const wikiPaths = vaultTree?.flatPaths.slice(0, 5) ?? [];
  const { data: vaultSkills } = useVaultSkills();
  const skills = vaultSkills?.skills.slice(0, 8) ?? [];
  const { data: recentRuns } = useRunFeed({ limit: 5 });

  function handleOpenChange(open: boolean) {
    if (!open) close();
  }

  function handleOpenSkill() {
    close();
    router.push("/architecture");
  }

  function handleWikiNavigate(path: string) {
    close();
    router.push(`/memory?page=${encodeURIComponent(path)}`);
  }

  function handleRunNavigate(id: string) {
    close();
    router.push(`/observability/run/${id}`);
  }

  function handleOpenSettings() {
    close();
    router.push("/settings");
  }

  function handleClearFilter() {
    clearFilter();
    close();
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Search skills, wiki pages, and recent runs"
      className="max-w-[640px] w-full"
    >
      <CommandInput placeholder="Search skills, wiki pages, runs…" />

      <CommandList className="max-h-[380px]">
        <CommandEmpty>No results found.</CommandEmpty>

        {/* ── Skills ──────────────────────────────────────────── */}
        <CommandGroup heading="Skills">
          {skills.map((skill) => (
            <CommandItem
              key={skill.path}
              value={`skill ${skill.name} ${skill.description} ${skill.triggers.join(" ")}`}
              onSelect={handleOpenSkill}
              className="gap-2.5"
            >
              <Sparkles
                size={14}
                className="shrink-0"
                style={{ color: "var(--accent-plum-400)" }}
                aria-hidden="true"
              />
              <span className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{skill.name}</span>
                <span
                  className="text-xs truncate"
                  style={{ color: "var(--text-muted)" }}
                >
                  {skill.description}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* ── Wiki Pages ───────────────────────────────────────── */}
        <CommandGroup heading="Wiki Pages">
          {wikiPaths.map((pagePath) => {
            const title = pagePath.split("/").pop() ?? pagePath;
            return (
              <CommandItem
                key={pagePath}
                value={`wiki ${title} ${pagePath}`}
                onSelect={() => handleWikiNavigate(pagePath)}
                className="gap-2.5"
              >
                <BookOpen
                  size={14}
                  className="shrink-0"
                  style={{ color: "var(--accent-gold-400)" }}
                  aria-hidden="true"
                />
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{title}</span>
                  <span
                    className="text-xs truncate font-mono"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-jetbrains-mono, monospace)",
                    }}
                  >
                    {pagePath}
                  </span>
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {/* ── Recent Runs ──────────────────────────────────────── */}
        <CommandGroup heading="Recent Runs">
          {(recentRuns ?? []).slice(0, 5).map((run) => (
            <CommandItem
              key={run.id}
              value={`run ${run.agent} ${run.status} ${((run as { tags?: string[] }).tags ?? []).join(" ")}`}
              onSelect={() => handleRunNavigate(run.id)}
              className="gap-2.5"
            >
              <Activity
                size={14}
                className="shrink-0"
                style={{ color: "var(--text-muted)" }}
                aria-hidden="true"
              />
              <span className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{run.agent}</span>
                <span
                  className="text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  Hermes · {run.status}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* ── Quick Actions ────────────────────────────────────── */}
        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="open settings"
            onSelect={handleOpenSettings}
            className="gap-2.5"
          >
            <Settings
              size={14}
              className="shrink-0"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            />
            <span className="text-sm">Open Settings</span>
          </CommandItem>
          <CommandItem
            value="clear filter tags"
            onSelect={handleClearFilter}
            className="gap-2.5"
          >
            <span
              className="size-[14px] shrink-0 flex items-center justify-center text-xs leading-none"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            >
              ✕
            </span>
            <span className="text-sm">Clear filter</span>
          </CommandItem>
          <CommandItem
            value="toggle theme"
            onSelect={() => {
              toast.info("Theme toggle available in Phase 6.");
              close();
            }}
            className="gap-2.5"
          >
            <span
              className="size-[14px] shrink-0 flex items-center justify-center text-xs leading-none"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            >
              ◑
            </span>
            <span className="text-sm">Toggle theme</span>
            <span
              className="ml-auto text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Phase 6
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      {/* Footer keyboard hints */}
      <div
        className="flex items-center gap-3 border-t px-3 py-2"
        style={{
          borderTopColor: "var(--border-subtle)",
          backgroundColor: "color-mix(in srgb, var(--surface-elevated) 60%, transparent)",
        }}
      >
        <span className="flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
          <kbd
            className="rounded-sm border px-1 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: "var(--surface-muted)",
              borderColor: "var(--border-brand)",
              fontFamily: "var(--font-jetbrains-mono, monospace)",
            }}
          >
            ↑↓
          </kbd>
          <span className="text-[11px]">navigate</span>
        </span>
        <span className="flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
          <kbd
            className="rounded-sm border px-1 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: "var(--surface-muted)",
              borderColor: "var(--border-brand)",
              fontFamily: "var(--font-jetbrains-mono, monospace)",
            }}
          >
            Enter
          </kbd>
          <span className="text-[11px]">select</span>
        </span>
        <span className="flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
          <kbd
            className="rounded-sm border px-1 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: "var(--surface-muted)",
              borderColor: "var(--border-brand)",
              fontFamily: "var(--font-jetbrains-mono, monospace)",
            }}
          >
            Esc
          </kbd>
          <span className="text-[11px]">close</span>
        </span>
      </div>
    </CommandDialog>
  );
}
