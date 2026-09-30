import { test, expect } from "@playwright/test";

/**
 * GOL-2651 — no route may scroll horizontally at its own viewport.
 *
 * `/settings` shipped a 68px horizontal overflow at 390x844 and stayed green
 * for three weeks, because `playwright.config.ts` declared a single Desktop
 * Chrome project. A horizontal scrollbar on a dashboard is not cosmetic: the
 * whole page drifts under the thumb and the right edge of every control in the
 * offending row sits off-screen, so you cannot see the value you are changing.
 *
 * This spec runs in both projects, so the desktop lane guards against the
 * mirror-image regression (a `w-[1400px]` hard-coded width, say) too.
 *
 * On failure it names the offending elements rather than just the delta —
 * hunting an overflow from a bare number is the slow part.
 */

const ROUTES = [
  "/runs",
  "/architecture",
  "/cost",
  "/health",
  "/memory",
  "/settings",
] as const;

/** Elements whose right edge escapes the layout viewport, de-duplicated. */
async function overflowReport(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const offenders = new Map<string, number>();
    if (de.scrollWidth > de.clientWidth) {
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (Math.round(box.right) <= de.clientWidth + 1) continue;
        const key =
          `${el.tagName}.${(el.getAttribute("class") ?? "").slice(0, 48)}` +
          ` right=${Math.round(box.right)} width=${Math.round(box.width)}`;
        offenders.set(key, (offenders.get(key) ?? 0) + 1);
      }
    }
    return {
      clientWidth: de.clientWidth,
      scrollWidth: de.scrollWidth,
      offenders: Array.from(offenders, ([k, n]) => `${n}x ${k}`).slice(0, 10),
    };
  });
}

test.describe("no horizontal overflow", () => {
  // The first navigation pays the Turbopack cold compile; keep it generous.
  test.slow();

  for (const route of ROUTES) {
    test(`${route} fits its viewport`, async ({ page }, testInfo) => {
      await page.goto(route, { waitUntil: "load" });
      // Web fonts change text metrics, and text metrics are what overflow is
      // made of — measuring before they land gives a false pass.
      await page.evaluate(() => document.fonts.ready);

      const { clientWidth, scrollWidth, offenders } = await overflowReport(page);
      const viewport = testInfo.project.use.viewport;

      expect(
        scrollWidth,
        `${route} overflows by ${scrollWidth - clientWidth}px at ` +
          `${viewport?.width}x${viewport?.height}. Offenders:\n  ` +
          (offenders.join("\n  ") || "(none located — check a negative margin)"),
      ).toBeLessThanOrEqual(clientWidth);
    });
  }
});

test.describe("settings model-tier selects", () => {
  test.slow();

  test("are fully visible, labelled, and a 44px target on mobile", async ({
    page,
  }, testInfo) => {
    await page.goto("/settings", { waitUntil: "load" });
    const selects = page.locator("select");
    await expect(selects).toHaveCount(3);

    const isMobile = (testInfo.project.use.viewport?.width ?? 0) <= 480;
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth,
    );

    for (let i = 0; i < 3; i++) {
      const select = selects.nth(i);
      await expect(select).toBeVisible();

      // Every select carries a programmatic label — the row used to render a
      // bare <label> with no `for`, which associates with nothing.
      const id = await select.getAttribute("id");
      expect(id, "select must have an id for its <label for>").toBeTruthy();
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);

      // getBoundingClientRect rather than locator.boundingBox(): Playwright
      // returns null for a <select> here, and the viewport-relative rect is
      // exactly what "is the right edge on screen" needs anyway.
      //
      // Poll for a laid-out box first. `/settings` still throws a hydration
      // error in CI (GOL-2653, a live clock in the KPI banner), and React
      // regenerates the tree when it recovers — measure inside that window and
      // every rect reads 0. A zero height is never a real 2.5.8 violation, but
      // it failed as one, with a message that sent you hunting a CSS bug that
      // was not there. Assert on a box that exists, so the failure means what
      // it says.
      const measure = () =>
        select.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { right: Math.round(r.right), height: Math.round(r.height) };
        });
      await expect
        .poll(async () => (await measure()).height, {
          message: `select ${i} never laid out (height stayed 0)`,
        })
        .toBeGreaterThan(0);
      const box = await measure();
      expect(
        box.right,
        `select ${i} right edge is off-screen`,
      ).toBeLessThanOrEqual(clientWidth);

      if (isMobile) {
        // WCAG 2.5.8 / Fitts's Law minimum touch target.
        expect(box.height, `select ${i} height`).toBeGreaterThanOrEqual(44);
      }
    }

    // Keyboard operability plus a visible focus ring (not `outline: none` alone).
    const first = selects.first();
    await first.focus();
    await expect(first).toBeFocused();
    const ring = await first.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { boxShadow: cs.boxShadow, outline: cs.outlineStyle };
    });
    expect(
      ring.boxShadow !== "none" || ring.outline !== "none",
      `focused select has no visible ring: ${JSON.stringify(ring)}`,
    ).toBe(true);
  });
});

/**
 * GOL-2707 — the Phase-6 folder picker must stay inert.
 *
 * It regressed twice from the same root cause: it is an icon-only `<button>`
 * with no `onClick`, so it looked like a control and behaved like nothing. As
 * long as it was *enabled* it took a keyboard tab stop that led nowhere, and
 * WCAG 1.4.11 applied to its boundary — which it failed in both themes, at
 * 1.76:1 dark / 1.44:1 light on `--border-brand`. There is no border token to
 * re-point it to: `--border-strong`, the strongest in the palette, only reaches
 * 2.81:1 on the dark page and 2.25:1 on a card (that gap is GOL-2673).
 *
 * So the contract this test pins is *inertness*, not a contrast number:
 * disabled controls are exempt from 1.4.11, and the exemption is only honest
 * while the control really is disabled. If someone re-enables the button when
 * Phase 6 lands, this fails and forces the boundary question to be answered.
 *
 * It also pins the rank of the two icon buttons in a project-root row. The live
 * ✕ must not sit on `--text-muted` — the palette's own "placeholders, disabled"
 * step, and what the inert picker uses — or the two read as peers.
 */
test.describe("settings folder picker (Phase 6 placeholder)", () => {
  test.slow();

  const relLuminance = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

  test("is disabled, out of the tab order, and outranked by the live ✕", async ({
    page,
  }) => {
    await page.goto("/settings", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    // A project-root row renders the picker next to the live ✕; the Vault Path
    // row renders it alone. Both must be inert.
    await page.getByRole("button", { name: /Add project root/i }).click();
    const pickers = page.locator('button[aria-label^="Pick folder"]');
    await expect(pickers).toHaveCount(2);

    for (let i = 0; i < 2; i++) {
      const picker = pickers.nth(i);
      await expect(picker).toBeDisabled();
      // No boundary at all beats a boundary under the 1.4.11 floor.
      const border = await picker.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.borderTopStyle, width: parseFloat(cs.borderTopWidth) };
      });
      expect(
        border.style === "none" || border.width === 0,
        `picker ${i} draws a boundary (${JSON.stringify(border)}); ` +
          "no border token clears 3:1 in dark — see GOL-2673",
      ).toBe(true);
    }

    // Tabbing forward out of the path field must land on the ✕, not the picker
    // that sits between them in the DOM.
    await page.locator('[aria-label="Project root 1 path"]').focus();
    await page.keyboard.press("Tab");
    await expect(
      page.locator('button[aria-label="Remove project root"]'),
    ).toBeFocused();

    // Rank: the live control must be the higher-contrast of the two.
    const weights = await page.evaluate(() => {
      const behind = (el: Element) => {
        let n = el.parentElement;
        while (n) {
          const b = getComputedStyle(n).backgroundColor;
          if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b;
          n = n.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const read = (sel: string) => {
        const el = document.querySelector(sel)!;
        const cs = getComputedStyle(el);
        return { color: cs.color, opacity: parseFloat(cs.opacity), bg: behind(el) };
      };
      return {
        picker: read('button[aria-label^="Pick folder"]'),
        remove: read('button[aria-label="Remove project root"]'),
      };
    });
    const ratioOf = (w: { color: string; opacity: number; bg: string }) => {
      const bg = rgb(w.bg);
      const painted = rgb(w.color).map((v, i) => v * w.opacity + bg[i] * (1 - w.opacity));
      return contrast(painted, bg);
    };
    const pickerRatio = ratioOf(weights.picker);
    const removeRatio = ratioOf(weights.remove);

    // The ✕ is a live icon-only control, so 1.4.11 does apply to it.
    expect(
      removeRatio,
      `live ✕ glyph is ${removeRatio.toFixed(2)}:1 against ${weights.remove.bg}`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      removeRatio,
      `live ✕ (${removeRatio.toFixed(2)}:1) must outrank the inert picker ` +
        `(${pickerRatio.toFixed(2)}:1) — see GOL-2707`,
    ).toBeGreaterThan(pickerRatio * 1.5);
  });
});
