import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * The field's edge is `border-field-line` and its hint is
 * `placeholder:text-field-placeholder` — neither is `--color-input` /
 * `--text-muted` any more.
 *
 * `--color-input` is `var(--surface-muted)`, a *surface* token, so an
 * unfocused field was outlined in the colour of the thing behind it: 1.00:1 on
 * an inset zone (identical colour), 1.05-1.38:1 on every other surface, both
 * themes. `--text-muted` is 2.51:1 on the light page. A light-mode empty field
 * was an invisible box containing illegible text (GOL-3045). `--color-input`
 * is still the right token for the `bg-input/*` fills below; only the border
 * and the placeholder moved.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-field-line bg-transparent px-2.5 py-1 text-base transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-field-placeholder disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-error-fg md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
        className
      )}
      {...props}
    />
  )
}

export { Input }
