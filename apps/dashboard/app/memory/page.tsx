"use client";

import { useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { Check, Menu, Network, X } from "lucide-react";
import { MemoryVista } from "@/components/shell/MemoryVista";
import { MemoryTree } from "@/components/memory/MemoryTree";
import { MemoryReader } from "@/components/memory/MemoryReader";
import { MemoryRail } from "@/components/memory/MemoryRail";
import { MemorySyncIndicator } from "@/components/memory/MemorySyncIndicator";
import { GraphCanvas } from "@/components/memory/GraphCanvas";
import { SkillsCatalogPanel } from "@/components/memory/SkillsCatalogPanel";
import { RecentVaultChangesPanel } from "@/components/memory/RecentVaultChangesPanel";

export default function MemoryPage() {
  const [selectedPath, setSelectedPath] = useQueryState(
    "page",
    parseAsString.withDefault("")
  );
  const [graphMode, setGraphMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activePath = selectedPath || null;

  function handleSelect(path: string) {
    void setSelectedPath(path);
    setSidebarOpen(false); // close sidebar on mobile after selection
  }

  function handleNavigate(path: string) {
    void setSelectedPath(path);
  }

  function handleGraphSelect(path: string) {
    void setSelectedPath(path);
    setGraphMode(false);
  }

  return (
    <>
      <MemoryVista />
      {/* Vault-native summary panels. OpenViking agent-obs intentionally
          excluded here (two-brain: Viking belongs to the observability tab,
          not the vault Memory tab). */}
      <div className="grid grid-cols-12 gap-4 p-4 shrink-0">
        <div className="col-span-12 lg:col-span-6">
          <SkillsCatalogPanel />
        </div>
        <div className="col-span-12 lg:col-span-6">
          <RecentVaultChangesPanel />
        </div>
      </div>
      <div className="memory-layout">
        <div
          className="memory-toolbar"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--surface)",
          }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="memory-sidebar-toggle"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? (
                <X size={16} aria-hidden="true" />
              ) : (
                <Menu size={16} aria-hidden="true" />
              )}
            </button>
            <h1 className="memory-toolbar__title">Memory</h1>
          </div>
          <div className="memory-toolbar__actions">
            {/* Reader/graph mode toggle. Lives in the toolbar so it is present
                in BOTH modes — and carries its state on three channels:
                aria-pressed for AT, a filled container, and a leading
                check/graph icon, so it never depends on colour alone. */}
            <button
              type="button"
              className="memory-view-toggle"
              onClick={() => setGraphMode((g) => !g)}
              aria-pressed={graphMode}
            >
              {graphMode ? (
                <Check size={13} strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <Network size={13} strokeWidth={1.75} aria-hidden="true" />
              )}
              Graph view
            </button>
            <MemorySyncIndicator />
          </div>
        </div>

        <div className="memory-panes">
          {/* Left rail. MemoryTree is a self-contained sidebar: the Wiki
              header + page tree, then its own inline Inbox section. The inbox
              lives inside the tree (not a separate card) — one owner, no
              duplicate. Promote/discard wiring lands in Phase E. */}
          <div
            className={`memory-sidebar ${sidebarOpen ? "memory-sidebar--open" : ""}`}
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <MemoryTree
              selectedPath={activePath}
              onSelect={handleSelect}
            />
          </div>

          {/* Backdrop overlay for mobile sidebar */}
          {sidebarOpen && (
            <div
              className="memory-sidebar-backdrop"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Center: reader or graph. The wrapper is the measured pane the
              graph canvas sizes itself to (min-width:0 so flex cannot let it
              overflow). */}
          <div className="memory-pane-main">
            {graphMode ? (
              <GraphCanvas onSelectNode={handleGraphSelect} />
            ) : (
              <MemoryReader path={activePath} />
            )}
          </div>

          {/* Right rail */}
          <MemoryRail path={activePath} onNavigate={handleNavigate} />
        </div>
      </div>
    </>
  );
}
