import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/**
 * GOL-2997 — the `components/ui` focus-ring gallery.
 *
 * Every primitive in `components/ui` used to hand-roll its own focus
 * treatment at 50% alpha (`focus-visible:ring-ring/50`), which measured
 * 1.40-2.86:1 against the surfaces it lands on — under the WCAG 1.4.11 3:1
 * floor for a non-text indicator. They now take the shared `:focus-visible`
 * outline from `app/globals.css`.
 *
 * Most of these primitives are not mounted anywhere in the dashboard yet, so
 * there was no surface on which to see — or guard — the indicator. This page
 * is that surface, for two readers:
 *
 *   - a human, tabbing through it at 1440x900 and 390x844, in both themes;
 *   - `e2e/focus-visible.spec.ts`, which tabs each `[data-focus-surface]`
 *     section and measures the painted ring against that section's own
 *     background.
 *
 * The sections are the surface tokens a control can actually land on. The ring
 * is drawn with `outline-offset`, so the colour it is adjacent to is the
 * *parent* surface, not the control's own fill — which is the whole reason the
 * fix is a shared offset outline rather than a full-opacity `ring`. A ring with
 * no offset sits against the control fill, and `--color-primary` is the brand
 * gold (#c9a227): a gold ring on a gold button measures 1.27:1.
 *
 * Dev-only. Unset `UI_FOCUS_GALLERY` and the route 404s, so it is not part of
 * the shipped dashboard; `playwright.config.ts` sets it for the e2e run.
 */

/** The surfaces a control can sit on, worst-contrast case last. */
const SURFACES = [
  { token: "--bg", className: "bg-bg" },
  { token: "--surface", className: "bg-surface" },
  { token: "--surface-elevated", className: "bg-surface-elevated" },
  // == --surface-recessed in both themes, and the light-mode worst case (4.42:1).
  { token: "--surface-muted", className: "bg-surface-muted" },
] as const;

const BUTTON_VARIANTS = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const;

function Controls({ surface }: { surface: string }) {
  const id = surface.replace(/^--/, "");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {BUTTON_VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* A Badge is only focusable when it renders as a link, which is the
            only case where its focus ring can be reached at all. */}
        <Badge render={<a href="#top">default</a>} />
        <Badge variant="secondary" render={<a href="#top">secondary</a>} />
        <Badge variant="destructive" render={<a href="#top">destructive</a>} />
        <Badge variant="outline" render={<a href="#top">outline</a>} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input aria-label={`text input on ${surface}`} placeholder="Input" />
        <Select aria-label={`select on ${surface}`} defaultValue="b">
          <option value="a">Option A</option>
          <option value="b">Option B</option>
        </Select>
        <Textarea
          aria-label={`textarea on ${surface}`}
          placeholder="Textarea"
          className="min-h-11 sm:col-span-2"
        />
        <InputGroup className="sm:col-span-2">
          <InputGroupAddon>
            <span aria-hidden="true">/</span>
          </InputGroupAddon>
          <InputGroupInput
            aria-label={`input group on ${surface}`}
            placeholder="Input group — the ring belongs to the group"
          />
        </InputGroup>
      </div>

      <Tabs defaultValue={`${id}-one`}>
        <TabsList>
          <TabsTrigger value={`${id}-one`}>Tab one</TabsTrigger>
          <TabsTrigger value={`${id}-two`}>Tab two</TabsTrigger>
        </TabsList>
      </Tabs>

      <ScrollArea className="h-16 rounded-lg border border-border-subtle">
        <div className="p-2.5 text-sm text-text-secondary">
          A scroll area is keyboard-focusable once it overflows, so it needs a
          ring too — drawn inside its own box, because the viewport is
          <code className="px-1 font-mono text-xs">size-full</code> and an
          outside ring would be clipped.
          <br />
          Line two.
          <br />
          Line three.
          <br />
          Line four, so that it actually scrolls.
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * GOL-3044 — the `aria-invalid` half of the gallery.
 *
 * Deliberately NOT nested inside the `[data-focus-surface]` sections above:
 * `e2e/focus-visible.spec.ts` tabs each of those sections under a fixed press
 * ceiling, and another half-dozen controls per section would spend it. These
 * carry their own `data-invalid-surface` attribute and their own spec.
 *
 * Each surface shows a valid control beside its invalid twin, because the
 * question this page has to answer is not "can you see a red thing" but "can
 * you tell these two apart" — in deuteranopia, protanopia, tritanopia and
 * grayscale. Colour is not allowed to be the answer, so the invalid side
 * differs by border weight and by an octagon-and-text error row as well.
 */
function InvalidControls({ surface }: { surface: string }) {
  const id = surface.replace(/^--/, "");
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {([false, true] as const).map((invalid) => {
        const state = invalid ? "invalid" : "valid";
        const error = invalid
          ? "Enter an absolute path — “~” is expanded, “./” is not."
          : undefined;
        return (
          <div
            key={state}
            data-invalid-column={state}
            className="flex flex-col gap-4"
          >
            <p className="font-mono text-[0.6875rem] tracking-wider text-text-muted uppercase">
              {state}
            </p>

            <Field
              id={`${id}-${state}-input`}
              label="Vault path"
              error={error}
            >
              {(control) => (
                <Input {...control} placeholder="~/Documents/vault" />
              )}
            </Field>

            <Field
              id={`${id}-${state}-select`}
              label="Default model"
              error={error && "Pick a model — the saved one is no longer offered."}
            >
              {(control) => (
                <Select {...control} defaultValue="b">
                  <option value="a">Option A</option>
                  <option value="b">Option B</option>
                </Select>
              )}
            </Field>

            <Field
              id={`${id}-${state}-textarea`}
              label="Run notes"
              error={error && "Notes are capped at 280 characters."}
            >
              {(control) => (
                <Textarea {...control} placeholder="Textarea" className="min-h-11" />
              )}
            </Field>

            <Field
              id={`${id}-${state}-group`}
              label="Repository"
              error={error && "Repository must be owner/name."}
            >
              {(control) => (
                <InputGroup>
                  <InputGroupAddon>
                    <span aria-hidden="true">/</span>
                  </InputGroupAddon>
                  <InputGroupInput {...control} placeholder="owner/name" />
                </InputGroup>
              )}
            </Field>

            {/* A Button and a Badge can carry aria-invalid too (a combobox
                trigger, a status chip). They are not fields, so they have no
                FieldError of their own — on a gold-filled variant the border
                only clears 3:1 on its outer edge, which is why the spec treats
                them as border-only and why real usage still owes them a
                message nearby. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button aria-invalid={invalid || undefined}>default</Button>
              <Button variant="outline" aria-invalid={invalid || undefined}>
                outline
              </Button>
              <Badge aria-invalid={invalid || undefined}>badge</Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function UiFocusGalleryPage() {
  if (process.env.UI_FOCUS_GALLERY !== "1") notFound();

  return (
    <main id="top" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border-subtle pb-6">
        <p className="font-mono text-xs tracking-widest text-text-muted uppercase">
          Design system · dev only
        </p>
        <h1 className="text-2xl font-semibold text-text sm:text-3xl">
          components/ui focus rings
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-text-secondary">
          Every control below takes the one shared <code>:focus-visible</code>{" "}
          outline. Tab through a section and the ring should read identically on
          every surface, in both themes, at every viewport. Nothing here paints
          its own.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {SURFACES.map(({ token, className }) => (
          <section
            key={token}
            data-focus-surface={token}
            className={`${className} rounded-xl border border-border-subtle p-4 sm:p-6`}
          >
            <h2 className="mb-4 font-mono text-xs tracking-wider text-text-secondary">
              {token}
            </h2>
            <Controls surface={token} />
          </section>
        ))}
      </div>

      <header className="mt-12 mb-8 flex flex-col gap-2 border-b border-border-subtle pb-6">
        <p className="font-mono text-xs tracking-widest text-text-muted uppercase">
          Design system · dev only
        </p>
        <h1 className="text-2xl font-semibold text-text sm:text-3xl">
          components/ui error states
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-text-secondary">
          Every pair below is the same control, valid on the left and{" "}
          <code>aria-invalid</code> on the right. Cover the colour — squint, or
          view this page in grayscale — and the invalid side should still be the
          obvious one: a heavier border, an octagon, and a sentence saying what
          is wrong.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {SURFACES.map(({ token, className }) => (
          <section
            key={token}
            data-invalid-surface={token}
            className={`${className} rounded-xl border border-border-subtle p-4 sm:p-6`}
          >
            <h2 className="mb-4 font-mono text-xs tracking-wider text-text-secondary">
              {token}
            </h2>
            <InvalidControls surface={token} />
          </section>
        ))}
      </div>
    </main>
  );
}
