import { test, expect, type Page } from "@playwright/test";

/**
 * GOL-2980 — brand-filled controls must keep a legible label in BOTH themes.
 *
 * `.light` re-points `--text-inverse` (#0d1612 → #f0ebe4) because the inverse
 * surface flips with the theme. `--color-primary` does NOT flip: the plum scale
 * aliases to `--gold` and `.light` leaves it alone. Routing primary's foreground
 * through `--text-inverse` therefore put light parchment on brand gold at
 * **2.04:1** in light mode — every default `Button` and `Badge` in the product.
 * Same shape as the `--warning-fg` gap (GOL-903).
 *
 * Why this is a browser spec and not a token-chain unit test: `@theme inline`
 * compiles `text-primary-foreground` to `color: var(--ink-on-light)` and never
 * emits `--color-primary-foreground` as a custom property at all. A `.light`
 * override of `--color-primary-foreground` would be a *silent no-op* — a
 * token-chain reading says "fixed" while the pixels are unchanged. Only the
 * computed colour on a rendered element tells the truth.
 *
 * `.light` has no in-app toggle today; globals.css documents it as "apply
 * .light class to <html>", which is what this spec does.
 */

const AA_TEXT = 4.5;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Resolved ink per theme, so a vacuous pass (theme never applied) is impossible. */
const INK_ON_LIGHT = { dark: "#0d1612", light: "#1a1512" } as const;

/**
 * `transition-all` on Button means getComputedStyle returns the INTERPOLATED
 * colour for ~150ms after the theme class flips. Two equal frames is not enough
 * — the first frames still read the old theme's colour — so require a run of
 * identical frames before measuring.
 */
async function settle(page: Page, selector: string): Promise<void> {
  await page.evaluate(async (sel) => {
    const el = document.querySelector(sel)!;
    let prev: string | null = null;
    let stable = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const cs = getComputedStyle(el);
      const now = `${cs.color}|${cs.backgroundColor}`;
      stable = now === prev ? stable + 1 : 0;
      prev = now;
      if (stable >= 12) return;
    }
  }, selector);
}

/** WCAG 2.x contrast of an element's label against its own painted fill. */
async function contrast(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const over = (fg: number[], bg: number[]) => {
      const a = fg.length > 3 ? fg[3] : 1;
      return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    };
    const hex = (c: number[]) =>
      "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

    const el = document.querySelector(sel)!;
    // Composite the element's own fill over the first opaque backdrop above it.
    let node = el.parentElement;
    let backdrop: number[] = [255, 255, 255];
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if ((bg.length > 3 ? bg[3] : 1) >= 1) {
        backdrop = bg.slice(0, 3);
        break;
      }
      node = node.parentElement;
    }
    const cs = getComputedStyle(el);
    const bg = over(parse(cs.backgroundColor), backdrop);
    const fg = over(parse(cs.color), bg);
    const [a, b] = [lum(fg), lum(bg)];
    return {
      color: hex(fg),
      background: hex(bg),
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    };
  }, selector);
}

for (const vp of VIEWPORTS) {
  for (const theme of ["dark", "light"] as const) {
    test(`default Button label keeps 4.5:1 on the ${theme} theme at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/settings");

      const save = 'button[type="submit"]';
      await page.waitForSelector(save);
      if (theme === "light") {
        await page.evaluate(() => document.documentElement.classList.add("light"));
      }
      await settle(page, save);

      // The theme really changed — otherwise every assertion below is vacuous.
      const ink = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--ink-on-light").trim()
      );
      expect(ink.toLowerCase(), `--ink-on-light under .${theme}`).toBe(INK_ON_LIGHT[theme]);

      const measured = await contrast(page, save);
      expect(
        measured.ratio,
        `${theme}: "Save settings" is ${measured.color} on ${measured.background}`
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }
}
