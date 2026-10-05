import { test, expect } from "@playwright/test";

/**
 * GOL-3045 — an *unfocused* form field must have a perceivable boundary, and
 * the hint inside it must be readable.
 *
 * `--color-input` is `var(--surface-muted)`: a surface token. `Input`,
 * `Textarea` and `InputGroup` painted their border with it, so a field was
 * outlined in the colour of the thing behind it — 1.00:1 on an inset zone
 * (literally the same colour), 1.05-1.38:1 on every other surface, in both
 * themes. `Select` used `--border-strong`, 1.93-2.81:1 dark. The fields were
 * invisible until you clicked into them, and the GOL-2997 focus ring landing
 * correctly is what made that obvious: the ring appeared around nothing.
 *
 * Three things make this spec different from `focus-visible.spec.ts`, and all
 * three are why the defect survived a green suite for as long as it did:
 *
 * 1. It measures the field at rest. No Tab, no `:focus-visible`. The focus
 *    indicator and the component boundary are two separate WCAG 1.4.11
 *    obligations, and passing one says nothing about the other.
 * 2. It measures the border against BOTH adjacent colours — the surface
 *    outside the field and the field's own fill inside it. `dark:bg-input/30`
 *    composites a different fill on every surface, so "3:1 against the page"
 *    is only half the requirement.
 * 3. It composites alpha itself rather than discarding it. The focus spec
 *    treats a non-opaque colour as unmeasurable, which is right for a ring
 *    sitting on an unknown fill; here the stack underneath is known, so a
 *    translucent fill can and must be resolved to the colour a user sees.
 */

/**
 * `transition-colors` animates `border-color`, so a colour read before the
 * transition settles is a colour nobody sees. Freeze first — and note that
 * this matters even without an interaction, because applying `.light` retints
 * every field and `getComputedStyle` will happily hand back an interpolated
 * midpoint for ~240ms afterwards.
 */
async function freezeTransitions(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }",
  });
}

/**
 * The things that owe a boundary, by the `data-slot` each primitive stamps.
 * Deliberately NOT `input-group-control`: the inner control of an input group
 * is `border-0` on purpose — the group draws the field (GOL-2997) — so asking
 * it for an edge would be asking the wrong element.
 */
const BOUNDED = ["input", "textarea", "select", "input-group"] as const;

/** The gallery renders one of each on each of its four surface sections. */
const SURFACE_SECTIONS = 4;

type BorderProbe = {
  kind: "border";
  surface: string;
  slot: string;
  borderStyle: string;
  borderWidth: number;
  /** Border colour composited over the field's own fill. */
  borderColor: string;
  /** Composited colour immediately inside the border. */
  fill: string;
  /** Composited colour immediately outside the border. */
  backdrop: string;
  vsFill: number | null;
  vsBackdrop: number | null;
};

type PlaceholderProbe = {
  kind: "placeholder";
  surface: string;
  slot: string;
  label: string;
  color: string | null;
  fill: string;
  contrast: number | null;
};

type Probe = BorderProbe | PlaceholderProbe;

async function probeFields(
  page: import("@playwright/test").Page,
): Promise<Probe[]> {
  return page.evaluate((bounded) => {
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: number[], b: number[]) => {
      const x = lum(a);
      const y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    /** "rgb[a](r, g, b[, a])" -> [r,g,b,a]; null when unparseable. */
    const parse = (c: string): number[] | null => {
      const m = c.match(/-?[\d.]+/g);
      if (!m || m.length < 3) return null;
      return [
        Number(m[0]),
        Number(m[1]),
        Number(m[2]),
        m.length >= 4 ? Number(m[3]) : 1,
      ];
    };
    const over = (fg: number[], bg: number[]) =>
      [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const hex = (rgb: number[]) =>
      "#" +
      rgb
        .map((v) =>
          Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"),
        )
        .join("");

    /**
     * The colour a user actually sees at `el`: walk up compositing every
     * translucent background until one is opaque. A field is `bg-transparent`
     * in light mode and `bg-input/30` in dark, so neither end of this walk is
     * hypothetical.
     */
    const seenColour = (el: Element | null): number[] => {
      const stack: number[][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const p = parse(getComputedStyle(n).backgroundColor);
        if (!p || p[3] === 0) continue;
        stack.push(p);
        if (p[3] === 1) break;
      }
      // Nothing opaque found (shouldn't happen — <html> paints one). Assume
      // white rather than silently reporting a passing number.
      let acc = [255, 255, 255];
      for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
      return acc;
    };

    const out: Probe[] = [];
    for (const section of Array.from(
      document.querySelectorAll<HTMLElement>("[data-focus-surface]"),
    )) {
      const surface = section.getAttribute("data-focus-surface") || "?";

      for (const slot of bounded) {
        for (const el of Array.from(
          section.querySelectorAll<HTMLElement>(`[data-slot="${slot}"]`),
        )) {
          const cs = getComputedStyle(el);
          const border = parse(cs.borderTopColor);
          // The border sits between the field's own fill and whatever the
          // field is placed on, and owes 3:1 to each.
          const fill = seenColour(el);
          const backdrop = seenColour(el.parentElement);
          const resolved = border ? over(border, fill) : null;
          out.push({
            kind: "border",
            surface,
            slot,
            borderStyle: cs.borderTopStyle,
            borderWidth: parseFloat(cs.borderTopWidth) || 0,
            borderColor: resolved ? hex(resolved) : cs.borderTopColor,
            fill: hex(fill),
            backdrop: hex(backdrop),
            vsFill: resolved ? contrast(resolved, fill) : null,
            vsBackdrop: resolved ? contrast(resolved, backdrop) : null,
          });
        }
      }

      // Placeholders are read off the element that actually has one, which for
      // an input group is the inner control, not the group.
      for (const el of Array.from(
        section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input[placeholder], textarea[placeholder]",
        ),
      )) {
        const fill = seenColour(el);
        const ph = parse(getComputedStyle(el, "::placeholder").color);
        const resolved = ph && ph[3] > 0 ? over(ph, fill) : null;
        out.push({
          kind: "placeholder",
          surface,
          slot: el.getAttribute("data-slot") || el.tagName.toLowerCase(),
          label: el.getAttribute("placeholder") || "",
          color: resolved ? hex(resolved) : null,
          fill: hex(fill),
          contrast: resolved ? contrast(resolved, fill) : null,
        });
      }
    }
    return out;
  }, BOUNDED as unknown as string[]);
}

/** WCAG 1.4.11 for the boundary, 1.4.3 for the hint text inside it. */
function verdict(p: Probe): string | null {
  const at = `${p.slot} on ${p.surface}`;
  if (p.kind === "border") {
    if (p.borderStyle === "none" || p.borderWidth < 1) {
      return `${at}: no border painted (${p.borderStyle} ${p.borderWidth}px) — a field with no edge is not a region (WCAG 1.4.11)`;
    }
    if (p.vsFill === null || p.vsBackdrop === null) {
      return `${at}: border colour ${p.borderColor} could not be resolved to a painted colour`;
    }
    if (p.vsBackdrop < 3) {
      return `${at}: border ${p.borderColor} is only ${p.vsBackdrop.toFixed(2)}:1 against the surface outside it (${p.backdrop}) — WCAG 1.4.11 wants >=3:1`;
    }
    if (p.vsFill < 3) {
      return `${at}: border ${p.borderColor} is only ${p.vsFill.toFixed(2)}:1 against the field's own fill (${p.fill}) — WCAG 1.4.11 wants >=3:1 against every adjacent colour, not just the page`;
    }
    return null;
  }
  if (p.contrast === null) {
    return `${at} ("${p.label}"): no ::placeholder colour could be read, so its readability is unverified`;
  }
  if (p.contrast < 4.5) {
    return `${at} ("${p.label}"): placeholder ${p.color} is only ${p.contrast.toFixed(2)}:1 on ${p.fill} — a placeholder is text and owes 4.5:1 (WCAG 1.4.3)`;
  }
  return null;
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`unfocused form-field boundary (${theme})`, () => {
    test.beforeEach(async ({ page }) => {
      if (theme === "light") {
        await page.addInitScript(() => {
          document.addEventListener("DOMContentLoaded", () =>
            document.documentElement.classList.add("light"),
          );
        });
      }
    });

    test("every field has a >=3:1 edge and a >=4.5:1 placeholder", async ({
      page,
    }, testInfo) => {
      await page.goto("/dev/ui-focus", { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await freezeTransitions(page);

      const probes = await probeFields(page);

      testInfo.attach(`field-boundary-${theme}.json`, {
        body: JSON.stringify(probes, null, 2),
        contentType: "application/json",
      });

      // Non-vacuity, both halves. If a refactor drops a primitive from the
      // gallery this spec must go red rather than quietly pass on what's left:
      // most of components/ui is mounted nowhere else in the dashboard, so the
      // gallery is the only place these are measurable at all.
      const borders = probes.filter((p) => p.kind === "border");
      const placeholders = probes.filter((p) => p.kind === "placeholder");
      expect(
        borders.map((p) => `${p.slot}@${p.surface}`).sort(),
        "the gallery no longer renders one of each bounded primitive on each surface section",
      ).toHaveLength(BOUNDED.length * SURFACE_SECTIONS);
      // Input, Textarea and the input group's inner control, per section.
      expect(
        placeholders.length,
        `expected 3 placeholder-bearing fields per surface section, found ${placeholders.length} — the 4.5:1 half of this spec would be inert`,
      ).toBe(3 * SURFACE_SECTIONS);

      const failures = probes.map(verdict).filter(Boolean);
      expect(failures, `\n  - ${failures.join("\n  - ")}\n`).toEqual([]);
    });
  });
}
