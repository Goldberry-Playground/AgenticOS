import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Native `<select>` dressed to match {@link Input} (GOL-2651).
 *
 * Deliberate design-system addition: until now every select in the app was a
 * bare `<select>` with `appearance: auto`, so Chromium painted its own control
 * chrome over our token background and there was no design-system chevron.
 * The element stays *native* on purpose — on mobile that means the platform's
 * own picker wheel (Jakob's Law), and keyboard/AT behaviour comes for free.
 *
 * Three details are load-bearing and easy to lose in a refactor:
 *
 *  - `min-w-0`. A flex item defaults to `min-width: auto`, which refuses to
 *    shrink below its min-content width — for a select that is its widest
 *    `<option>`. Without this, `flex-1` cannot claw the width back and a long
 *    option blows out the whole page (the 68px `/settings` overflow at 390px).
 *  - `h-11 sm:h-8`. 44px is the WCAG 2.5.8 / Fitts's Law minimum touch target.
 *    Desktop keeps the denser 32px form row.
 *  - `pr-9` reserves the lane the chevron is absolutely positioned into, so the
 *    truncated value text never runs under the icon.
 *
 * The chevron uses `text-text-secondary` rather than the primitive layer's
 * usual `text-muted-foreground`: `--text-muted` is only 2.82:1 on the light
 * page background, under the 3:1 WCAG 1.4.11 floor for a meaningful icon.
 * `--text-secondary` is 9.15:1 dark / 7.03:1 light.
 */
function Select({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { containerClassName?: string }) {
  return (
    <div className={cn("relative w-full min-w-0", containerClassName)}>
      <select
        data-slot="select"
        className={cn(
          "h-11 w-full min-w-0 truncate appearance-none rounded-lg border border-border-strong bg-surface-muted pl-2.5 pr-9 text-base text-text transition-colors",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-2 aria-invalid:border-error-fg",
          "sm:h-8 sm:text-sm",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-text-secondary"
      />
    </div>
  )
}

export { Select }
