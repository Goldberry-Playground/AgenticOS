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
      // `hover:bg-[--surface-muted]` was the same inert v3 arbitrary-value
      // syntax as the Filter chip's broken ring — the trigger had no hover
      // affordance at all. `bg-(--surface-muted)` is the v4 spelling.
      // GOL-2968.
      className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-(--surface-muted)"
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
