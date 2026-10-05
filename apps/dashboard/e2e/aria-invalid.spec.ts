import { test, expect } from "@playwright/test";

/**
 * GOL-3044 — an `aria-invalid` control must be distinguishable from a valid
 * one without relying on hue, and its visual indicator must clear WCAG 1.4.11.
 *
 * Every shadcn-derived control used to signal invalid with
 * `aria-invalid:ring-3 aria-invalid:ring-destructive/20` and nothing else.
 * That failed twice over: the ring composited to roughly 1.2:1 against the
 * surface, and red was the only carrier, so in deuteranopia, protanopia or
 * grayscale an invalid field read as a normal field.
 *
 * Two assertions here, deliberately different in kind:
 *
 * 1. **Contrast >= 3:1.** WCAG contrast is a *luminance* ratio — hue cancels
 *    out of it. So a border that clears 3:1 against the surface behind it is,
 *    by construction, still visible in grayscale and under every simulated
 *    colour-vision deficiency. This is why the spec measures a ratio rather
 *    than running a CVD filter: the ratio is the stronger claim.
 * 2. **A channel that is not colour at all.** The invalid border is 2px where
 *    the resting border is 1px, and every invalid *field* owns an error row —
 *    `role="alert"`, an octagon glyph, and a sentence — reachable from the
 *    control through `aria-describedby`. Both survive a monochrome rendering
 *    and a screen reader respectively.
 *
 * The spec reads `/dev/ui-focus`, whose second half pairs each control with
 * its invalid twin on every surface token (see the page's own notes on why it
 * is not folded into the `[data-focus-surface]` sections).
 */

async function freezeTransitions(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }",
  });
}

type EdgeProbe = {
  name: string;
  /** Element the edge was read from, when it is not the control itself. */
  edgeOwner?: string;
  borderWidth: number;
  borderColor: string;
  boxShadow: string;
  backdrop: string;
  contrast: number | null;
  /** Null for controls that are not form fields (Button, Badge). */
  errorRow: {
    found: boolean;
    role: string | null;
    hasGlyph: boolean;
    text: string;
  } | null;
};

/**
 * Read the edge treatment of every probe-able control in one column of one
 * surface section. Runs in the page so it can use `getComputedStyle`.
 */
async function probeColumn(
  page: import("@playwright/test").Page,
  scope: string,
  column: "valid" | "invalid",
): Promise<EdgeProbe[]> {
  return page.evaluate(
    ({ scope, column }) => {
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((c) => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      // Alpha < 1 means the painted colour is not what the string says, so
      // the measurement would be a lie. Report unmeasurable instead.
      const parse = (c: string): number[] | null => {
        const m = String(c).match(/-?[\d.]+/g);
        if (!m || m.length < 3) return null;
        if (m.length >= 4 && Number(m[3]) < 1) return null;
        return [Number(m[0]), Number(m[1]), Number(m[2])];
      };
      const ratio = (a: number[], b: number[]) => {
        const la = lum(a);
        const lb = lum(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };
      const backdropOf = (el: HTMLElement) => {
        let node = el.parentElement;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          if (parse(bg)) return bg;
          node = node.parentElement;
        }
        return "";
      };
      /**
       * The input group draws the field's border and its inner control is
       * borderless, so the group — not the control — owns the invalid edge
       * (the same division of labour as the focus outline). Read the edge
       * from the nearest ancestor that actually paints a border.
       */
      const edgeOwnerOf = (el: HTMLElement): HTMLElement => {
        if ((parseFloat(getComputedStyle(el).borderTopWidth) || 0) > 0) return el;
        let up = el.parentElement;
        for (let d = 0; up && d < 4; d++, up = up.parentElement) {
          if ((parseFloat(getComputedStyle(up).borderTopWidth) || 0) > 0) return up;
        }
        return el;
      };

      const FIELDS = ["input", "textarea", "select", "input-group-control"];
      const PROBE_SLOTS = [...FIELDS, "button", "badge"];

      const root = document.querySelector(scope);
      if (!root) throw new Error(`scope not found: ${scope}`);
      const col = root.querySelector(`[data-invalid-column="${column}"]`);
      if (!col) throw new Error(`column not found: ${column} in ${scope}`);

      const controls = Array.from(
        col.querySelectorAll<HTMLElement>("[data-slot]"),
      ).filter((el) => {
        const slot = el.getAttribute("data-slot") || "";
        return PROBE_SLOTS.includes(slot) && el.getBoundingClientRect().width > 0;
      });

      return controls.map((el) => {
        const slot = el.getAttribute("data-slot") || "";
        const owner = edgeOwnerOf(el);
        const cs = getComputedStyle(owner);
        const border = parse(cs.borderTopColor);
        const backdrop = backdropOf(owner);
        const back = parse(backdrop);

        let errorRow: EdgeProbe["errorRow"] = null;
        if (FIELDS.includes(slot)) {
          const ids = (el.getAttribute("aria-describedby") || "")
            .split(/\s+/)
            .filter(Boolean);
          const node = ids
            .map((id) => document.getElementById(id))
            .find((n) => n?.getAttribute("data-slot") === "field-error");
          errorRow = {
            found: Boolean(node),
            role: node ? node.getAttribute("role") : null,
            hasGlyph: Boolean(node?.querySelector("svg")),
            text: node ? (node.textContent || "").trim() : "",
          };
        }

        const label =
          el.getAttribute("aria-label") ||
          el.id ||
          (el.textContent || "").trim().slice(0, 20) ||
          "(unnamed)";

        return {
          name: `${slot}:${label}`,
          edgeOwner:
            owner === el
              ? undefined
              : owner.getAttribute("data-slot") || owner.tagName.toLowerCase(),
          borderWidth: parseFloat(cs.borderTopWidth) || 0,
          borderColor: cs.borderTopColor,
          boxShadow: cs.boxShadow,
          backdrop,
          contrast: border && back ? ratio(border, back) : null,
          errorRow,
        } satisfies EdgeProbe;
      });
    },
    { scope, column },
  );
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`aria-invalid error affordance (${theme})`, () => {
    test.slow();

    test.beforeEach(async ({ page }) => {
      if (theme === "light") {
        await page.addInitScript(() => {
          document.addEventListener("DOMContentLoaded", () =>
            document.documentElement.classList.add("light"),
          );
        });
      }
    });

    test("an invalid control is >=3:1 and carries a non-colour channel on every surface", async ({
      page,
    }, testInfo) => {
      await page.goto("/dev/ui-focus", { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await freezeTransitions(page);

      const surfaces = await page
        .locator("[data-invalid-surface]")
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-invalid-surface") as string),
        );
      // An empty list would otherwise be a silent pass — the gallery 404s
      // unless UI_FOCUS_GALLERY=1, which playwright.config.ts sets.
      expect(
        surfaces.length,
        "no [data-invalid-surface] sections on /dev/ui-focus — is UI_FOCUS_GALLERY=1 set for the dev server?",
      ).toBeGreaterThan(0);

      const failures: string[] = [];
      const report: Record<string, { valid: EdgeProbe[]; invalid: EdgeProbe[] }> = {};

      for (const surface of surfaces) {
        const scope = `[data-invalid-surface="${surface}"]`;
        const probe = {
          valid: await probeColumn(page, scope, "valid"),
          invalid: await probeColumn(page, scope, "invalid"),
        };
        report[surface] = probe;

        expect(
          probe.invalid.length,
          `no probe-able controls in the invalid column of ${surface}`,
        ).toBeGreaterThan(0);

        for (const p of probe.invalid) {
          const where = p.edgeOwner ? ` (edge read from <${p.edgeOwner}>)` : "";

          // 1 — the border has to be the indicator, not a diluted shadow ring.
          if (p.boxShadow !== "none" && p.boxShadow !== "") {
            failures.push(
              `${surface} ${p.name}: paints box-shadow:${p.boxShadow}. A ring sits against the control's own fill (--color-primary is the brand gold #c9a227), so it cannot be measured against the page and must not carry the error state.`,
            );
          }
          if (p.borderWidth < 2) {
            failures.push(
              `${surface} ${p.name}${where}: invalid border is only ${p.borderWidth}px. The doubled width is the non-colour channel — without it the state is hue-only.`,
            );
          }

          // 2 — measurable, and >=3:1. A luminance ratio is hue-free, so this
          // is also the grayscale and colour-blind assertion.
          if (p.contrast === null) {
            failures.push(
              `${surface} ${p.name}${where}: invalid border ${p.borderColor} is not opaque, so its painted colour cannot be verified — WCAG 1.4.11 needs a measurable >=3:1`,
            );
          } else if (p.contrast < 3) {
            failures.push(
              `${surface} ${p.name}${where}: invalid border ${p.borderColor} is only ${p.contrast.toFixed(2)}:1 on ${p.backdrop} — WCAG 1.4.11 wants >=3:1`,
            );
          }

          // 3 — a field also has to say what is wrong, in text, to AT.
          if (p.errorRow) {
            if (!p.errorRow.found) {
              failures.push(
                `${surface} ${p.name}: aria-invalid with no aria-describedby pointing at a [data-slot=field-error] — the error is visual only`,
              );
            } else {
              if (p.errorRow.role !== "alert") {
                failures.push(
                  `${surface} ${p.name}: error row role is ${p.errorRow.role ?? "(none)"}, expected "alert" so a message appearing after submit is announced`,
                );
              }
              if (!p.errorRow.hasGlyph) {
                failures.push(
                  `${surface} ${p.name}: error row has no glyph — the icon is the sighted non-colour channel`,
                );
              }
              if (p.errorRow.text.length < 8) {
                failures.push(
                  `${surface} ${p.name}: error row text is ${JSON.stringify(p.errorRow.text)} — too short to say what is wrong`,
                );
              }
            }
          }
        }

        // 4 — the weight channel only exists relative to the resting state.
        const restingMax = Math.max(...probe.valid.map((p) => p.borderWidth));
        const invalidMin = Math.min(...probe.invalid.map((p) => p.borderWidth));
        if (!(invalidMin > restingMax)) {
          failures.push(
            `${surface}: invalid borders (min ${invalidMin}px) are not heavier than resting borders (max ${restingMax}px) — the state would be encoded by colour alone`,
          );
        }

        // 5 — a valid control must not be wearing the error affordance.
        for (const p of probe.valid) {
          if (p.errorRow?.found) {
            failures.push(
              `${surface} ${p.name}: a VALID control is described by a field-error row`,
            );
          }
        }
      }

      testInfo.attach(`aria-invalid-${theme}.json`, {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });

      expect(failures, `\n  - ${failures.join("\n  - ")}\n`).toEqual([]);
    });
  });
}
