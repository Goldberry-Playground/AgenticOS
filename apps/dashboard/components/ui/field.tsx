import * as React from "react"
import { OctagonXIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * GOL-3044 — the form-field wrapper that makes an invalid control perceivable
 * without relying on hue.
 *
 * Before this, every `components/ui` control signalled `aria-invalid` with a
 * faint red ring and nothing else (`aria-invalid:ring-3 ring-destructive/20`).
 * Two things were wrong with that:
 *
 *  1. The ring measured ~1.2:1 against the surface behind it — under the WCAG
 *     1.4.11 3:1 floor for a non-text indicator. Tailwind's `ring` is a
 *     zero-offset box-shadow, so it composites over the control's own fill and
 *     cannot be measured against the page at all (the same structural problem
 *     the focus ring hit in GOL-2997).
 *  2. Red was the *only* carrier. To a deuteranope or protanope — and in
 *     grayscale — an invalid field read exactly like a valid one.
 *
 * So the error state now travels on three independent channels:
 *
 *  - **Luminance + weight.** The control's border goes to `--error-fg` at 2px
 *    (`aria-invalid:border-2 aria-invalid:border-error-fg`), which measures
 *    4.82-7.02:1 on the dark surfaces and 4.88-6.00:1 on the light ones. The
 *    doubled width is deliberate: it keeps the state distinguishable from the
 *    resting border on luminance alone, and keeps working once GOL-3045 makes
 *    that resting border visible.
 *  - **Shape.** An `OctagonXIcon` — the design system's existing error glyph
 *    (see `components/ui/sonner.tsx`, where warning is a triangle and error is
 *    an octagon), so the two statuses stay distinct from each other by form,
 *    not just by colour.
 *  - **Text.** The message itself, associated with the control through
 *    `aria-describedby` and announced via `role="alert"`.
 *
 * `Field` takes its child as a render prop rather than a plain node. That is
 * the point of the component: the wiring (`id`, `aria-invalid`,
 * `aria-describedby`) is handed to the control, so it cannot be forgotten, and
 * no context/`cloneElement` magic is needed — which keeps these primitives
 * usable from a server component.
 *
 * Known limit, inherited from the control fills rather than this component: on
 * a filled Button or Badge (`bg-primary` is the brand gold #c9a227) the error
 * border clears 3:1 on its *outer* edge against the page, but only 1.14:1
 * (dark) / 2.48:1 (light) against the fill on its inner edge. There is no
 * colour that fixes that — a red border on a gold chip is a low-contrast
 * adjacency by construction. Which is exactly why the glyph and the text are
 * mandatory and not decoration: an `aria-invalid` control must always be
 * accompanied by a `FieldError`.
 */

type FieldControlProps = {
  id: string
  "aria-invalid": true | undefined
  "aria-describedby": string | undefined
}

function Field({
  id,
  label,
  description,
  error,
  className,
  labelClassName,
  children,
}: {
  /** Owns the id namespace for the label, description and error nodes. */
  id: string
  label?: React.ReactNode
  description?: React.ReactNode
  /** Falsy = valid. Any message switches the field into its invalid state. */
  error?: string | null | false
  className?: string
  labelClassName?: string
  children: (control: FieldControlProps) => React.ReactNode
}) {
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div
      data-slot="field"
      data-invalid={error ? "true" : undefined}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {label ? (
        <label
          htmlFor={id}
          data-slot="field-label"
          className={cn(
            "text-sm font-medium text-text leading-5",
            labelClassName
          )}
        >
          {label}
        </label>
      ) : null}

      {description ? (
        <p
          id={descriptionId}
          data-slot="field-description"
          className="text-sm leading-relaxed text-text-secondary"
        >
          {description}
        </p>
      ) : null}

      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}

      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  )
}

/**
 * The error row. Usually rendered for you by {@link Field}; exported for the
 * form-level cases that have no single owning control.
 *
 * `role="alert"` as well as the `aria-describedby` association from `Field`:
 * the association alone is only read when focus reaches the control, and these
 * messages arrive *after* a submit, when focus is on the submit button. The
 * cost is that a screen reader may read the message twice for a user who then
 * tabs into the field — the accepted trade in the ARIA APG form pattern, and
 * the cheaper failure of the two.
 */
function FieldError({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <p
      id={id}
      role="alert"
      data-slot="field-error"
      className={cn(
        "flex items-start gap-1.5 text-sm leading-5 font-medium text-error-fg",
        className
      )}
    >
      <OctagonXIcon
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0"
      />
      <span>
        {/* The glyph is the sighted non-colour channel; this is the same
            signal for assistive tech, which does not see it. */}
        <span className="sr-only">Error: </span>
        {children}
      </span>
    </p>
  )
}

export { Field, FieldError }
export type { FieldControlProps }
