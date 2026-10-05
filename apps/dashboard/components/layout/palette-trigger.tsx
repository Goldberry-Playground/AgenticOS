"use client";

import { Command } from "lucide-react";
import { usePaletteStore } from "@/lib/palette/use-palette-store";

/**
 * Cmd-K command palette trigger button.
 *
 * Client island: the Header component stays server-rendered while this small
 * island carries the `"use client"` directive needed to bind the onClick
 * handler. Selects `open` from the Zustand palette store via a selector so
 * the component doesn't re-render on unrelated state changes.
 */
export function PaletteTrigger() {
  const open = usePaletteStore((s) => s.open);
  return (
    <button
      type="button"
      onClick={open}
      className="flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[--surface-muted]"
      style={{ color: "var(--text-muted)" }}
      aria-label="Open command palette (⌘K)"
    >
      <Command size={12} strokeWidth={1.5} aria-hidden="true" />
      <kbd
        className="font-mono text-[11px]"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
      >
        K
      </kbd>
    </button>
  );
}
