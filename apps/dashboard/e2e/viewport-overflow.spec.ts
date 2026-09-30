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
      const box = await select.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { right: Math.round(r.right), height: Math.round(r.height) };
      });
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
