import { test, expect } from "@playwright/test";

/**
 * GOL-2968 — every interactive control must show a visible keyboard focus
 * indicator, and that indicator must clear 3:1 against the surface it lands on.
 *
 * The global Filter chip shipped with `focus-visible:outline-none
 * focus-visible:ring-2 focus-visible:ring-[--accent-plum-400]`. The opt-out
 * landed; the replacement never painted (`ring-[--var]` is Tailwind v3
 * arbitrary-value syntax, inert in v4). So a keyboard user could reach a
 * top-level global control and not see that they had — WCAG 2.4.7 — with a
 * green suite, because nothing here ever asserted on focus.
 *
 * Two things make this spec worth reading before editing it:
 *
 * 1. It drives real `keyboard.press("Tab")`. A scripted `el.focus()` does NOT
 *    match `:focus-visible`, so a probe built on it reports every control as
 *    broken and you chase a bug that isn't there.
 * 2. It asserts the *measured* contrast of the indicator, not merely that
 *    `outline-style !== "none"`. A ring is allowed to exist and still be
 *    unusable: `--gold` (#c9a227), the pre-GOL-2968 `--ring`, measures
 *    1.97-2.42:1 on the light-mode surfaces.
 *
 * It also runs with `.light` applied. Light mode is CSS-only today — nothing
 * in the UI toggles it — so this is the only thing standing between the light
 * palette and a focus ring nobody measured.
 */

/**
 * Tailwind's `transition-colors` animates `outline-color`, so a colour read
 * immediately after Tab can be sampled mid-fade: probing the settings toggle
 * on a production build returned the ring at alpha 0.73 (dark) and 0.50
 * (light) on its way to opaque. Measuring that is measuring nothing. Freeze
 * transitions before reading any computed colour.
 */
async function freezeTransitions(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }",
  });
}

/** Matches the selector list the shared `:focus-visible` rule applies to. */
const FOCUSABLE = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="switch"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex^="-"])',
].join(",");

type Probe = {
  name: string;
  focusVisible: boolean;
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
  boxShadow: string;
  backdrop: string;
  contrast: number | null;
  /** Where the ring was read from, when that is not the focused element. */
  indicator?: string;
};

/**
 * Tab forward until every focusable inside `scope` has been visited (or we run
 * out of presses), reading the computed focus treatment at each stop.
 *
 * Returns one probe per control, keyed by a human-readable name, so a failure
 * names the control instead of an index.
 */
async function probeFocusByTabbing(
  page: import("@playwright/test").Page,
  scopeSelector: string,
): Promise<{ probes: Probe[]; expected: string[] }> {
  // Tag each control in the scope so a Tab stop can be identified by name.
  const expected = await page.evaluate(
    ({ focusable, scope }) => {
      const root = document.querySelector(scope);
      if (!root) throw new Error(`scope not found: ${scope}`);
      const controls = Array.from(root.querySelectorAll(focusable)).filter(
        (el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          // A roving tabindex is correct ARIA, not a defect: a tablist keeps
          // exactly one trigger in the Tab order and moves between the rest
          // with arrow keys. Counting the parked ones as "expected" would make
          // this probe permanently short of its own target. They share the
          // trigger's class list, so the one that is reachable covers them.
          return (el as HTMLElement).tabIndex >= 0;
        },
      );
      return controls.map((el, i) => {
        const label =
          el.getAttribute("aria-label") ||
          (el.textContent || "").trim().slice(0, 28);
        const key = `${i}:${el.tagName.toLowerCase()}:${label || "(no label)"}`;
        el.setAttribute("data-focus-probe", key);
        return key;
      });
    },
    { focusable: FOCUSABLE, scope: scopeSelector },
  );

  const probes: Probe[] = [];
  const seen = new Set<string>();
  // Generous ceiling: the skip link and anything before the scope burn presses.
  for (let i = 0; i < 60 && seen.size < expected.length; i++) {
    await page.keyboard.press("Tab");
    const probe = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const key = el.getAttribute("data-focus-probe");
      if (!key) return null;

      /**
       * A control may delegate its indicator to an ancestor: the input group
       * draws the border and the rounding, and its inner control is borderless
       * and transparent, so the group is what reads as "the field" and the ring
       * belongs on it (GOL-2997). Read the outline from the nearest ancestor
       * that paints one, and measure it against *that* element's backdrop.
       */
      const paintsRing = (n: HTMLElement) => {
        const s = getComputedStyle(n);
        return s.outlineStyle !== "none" && (parseFloat(s.outlineWidth) || 0) >= 2;
      };
      let ringEl: HTMLElement = el;
      let indicator: string | undefined;
      if (!paintsRing(el)) {
        let up = el.parentElement;
        for (let depth = 0; up && depth < 4; depth++, up = up.parentElement) {
          if (paintsRing(up)) {
            ringEl = up;
            indicator =
              up.getAttribute("data-slot") ||
              up.tagName.toLowerCase();
            break;
          }
        }
      }

      const cs = getComputedStyle(ringEl);

      /** sRGB relative luminance (WCAG 2.x). */
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((c) => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parse = (c: string): number[] | null => {
        const m = c.match(/-?[\d.]+/g);
        if (!m || m.length < 3) return null;
        // Alpha < 1 would make the measurement a lie about the painted colour;
        // treat it as unmeasurable rather than quietly over-reporting.
        if (m.length >= 4 && Number(m[3]) < 1) return null;
        return [Number(m[0]), Number(m[1]), Number(m[2])];
      };

      // `outline-offset` puts a gap of the nearest painted ancestor surface
      // between the control and the ring, so that surface is the colour the
      // ring is actually adjacent to.
      let node: HTMLElement | null = ringEl.parentElement;
      let backdrop = "";
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        const p = parse(bg);
        if (p) {
          backdrop = bg;
          break;
        }
        node = node.parentElement;
      }

      const ring = parse(cs.outlineColor);
      const back = parse(backdrop);
      let contrast: number | null = null;
      if (ring && back) {
        const a = lum(ring);
        const b = lum(back);
        contrast =
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }

      return {
        name: key,
        focusVisible: el.matches(":focus-visible"),
        outlineStyle: cs.outlineStyle,
        outlineWidth: parseFloat(cs.outlineWidth) || 0,
        outlineColor: cs.outlineColor,
        boxShadow: cs.boxShadow,
        backdrop,
        contrast,
        indicator,
      } satisfies Probe;
    });
    if (probe && !seen.has(probe.name)) {
      seen.add(probe.name);
      probes.push(probe);
    }
  }
  return { probes, expected };
}

/**
 * A control is compliant when it paints the shared outline at >=2px and >=3:1.
 *
 * GOL-2997 tightened this. It used to accept *any* non-empty `box-shadow` as a
 * second way to pass, which is how `components/ui` sailed through: every
 * shadcn-derived control carried `outline-none focus-visible:ring-3
 * focus-visible:ring-ring/50`, so it reported a box-shadow, this function
 * waved it past unmeasured, and the indicator it was actually painting
 * measured 1.40-2.86:1. A ring is allowed to exist and still be unusable.
 *
 * A box-shadow ring cannot be measured the way an outline can: `box-shadow`
 * with alpha composites over whatever is behind it, and what is behind it is
 * the control's own fill, not the surface — `--color-primary` is the brand gold
 * (#c9a227), so a gold ring abutting a primary Button is 1.27:1 no matter how
 * opaque it is. So a shadow is reported as a failure that names the remedy
 * rather than silently accepted.
 */
function verdict(p: Probe): string | null {
  if (!p.focusVisible) {
    return `${p.name}: :focus-visible did not match — probe reached it by means other than the keyboard`;
  }
  const where = p.indicator ? ` (ring read from <${p.indicator}>)` : "";
  const hasOutline = p.outlineStyle !== "none" && p.outlineWidth >= 2;
  if (!hasOutline) {
    const shadow =
      p.boxShadow !== "none" && p.boxShadow !== ""
        ? ` It paints box-shadow:${p.boxShadow} instead; a shadow ring sits against the control's own fill, which this spec cannot measure and which is the brand gold on primary variants. Drop the hand-rolled \`outline-none\` + \`focus-visible:ring-*\` pair and let the shared rule in globals.css apply.`
        : "";
    return `${p.name}: NO measurable focus outline — outline:${p.outlineStyle} ${p.outlineWidth}px (WCAG 2.4.7).${shadow}`;
  }
  if (p.contrast === null) {
    return `${p.name}: focus ring ${p.outlineColor} is not opaque, so its painted colour cannot be verified — WCAG 1.4.11 needs a measurable >=3:1`;
  }
  if (p.contrast < 3) {
    return `${p.name}${where}: focus ring ${p.outlineColor} is only ${p.contrast.toFixed(2)}:1 on ${p.backdrop} — WCAG 1.4.11 wants >=3:1`;
  }
  return null;
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`keyboard focus indicator (${theme})`, () => {
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

    test("every app shell header control shows a visible ring", async ({
      page,
    }, testInfo) => {
      await page.goto("/runs", { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await freezeTransitions(page);

      const { probes, expected } = await probeFocusByTabbing(
        page,
        "header.shell-header",
      );

      testInfo.attach(`header-focus-${theme}.json`, {
        body: JSON.stringify({ expected, probes }, null, 2),
        contentType: "application/json",
      });

      // Reaching every control matters as much as how it looks: a control the
      // Tab order skips is a 2.4.3 problem this spec would otherwise hide by
      // simply never probing it.
      expect(
        probes.map((p) => p.name).sort(),
        `Tab order did not reach every header control.\nexpected: ${expected.join("\n          ")}\nreached:  ${probes.map((p) => p.name).join("\n          ")}`,
      ).toEqual([...expected].sort());

      const failures = probes.map(verdict).filter(Boolean);
      expect(failures, `\n  - ${failures.join("\n  - ")}\n`).toEqual([]);
    });

    test("the settings connector toggle shows a visible ring", async ({
      page,
    }, testInfo) => {
      await page.goto("/settings", { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await freezeTransitions(page);

      const toggle = page.locator('button[role="switch"]').first();
      await expect(toggle).toBeVisible();

      // Tab until focus lands on the first switch rather than assuming a
      // count: the settings page grows controls above it over time.
      let landed = false;
      for (let i = 0; i < 80 && !landed; i++) {
        await page.keyboard.press("Tab");
        landed = await page.evaluate(
          () => document.activeElement?.getAttribute("role") === "switch",
        );
      }
      expect(landed, "Tab never reached a role=switch on /settings").toBe(true);

      const probe = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const cs = getComputedStyle(el);
        const lum = (rgb: number[]) => {
          const [r, g, b] = rgb.map((c) => {
            const v = c / 255;
            return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const parse = (c: string): number[] | null => {
          const m = c.match(/-?[\d.]+/g);
          if (!m || m.length < 3) return null;
          if (m.length >= 4 && Number(m[3]) < 1) return null;
          return [Number(m[0]), Number(m[1]), Number(m[2])];
        };
        let node: HTMLElement | null = el.parentElement;
        let backdrop = "";
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          if (parse(bg)) {
            backdrop = bg;
            break;
          }
          node = node.parentElement;
        }
        const ring = parse(cs.outlineColor);
        const back = parse(backdrop);
        let contrast: number | null = null;
        if (ring && back) {
          const a = lum(ring);
          const b = lum(back);
          contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        }
        return {
          focusVisible: el.matches(":focus-visible"),
          outlineStyle: cs.outlineStyle,
          outlineWidth: parseFloat(cs.outlineWidth) || 0,
          outlineColor: cs.outlineColor,
          boxShadow: cs.boxShadow,
          backdrop,
          contrast,
          ariaChecked: el.getAttribute("aria-checked"),
        };
      });
      testInfo.attach(`settings-toggle-focus-${theme}.json`, {
        body: JSON.stringify(probe, null, 2),
        contentType: "application/json",
      });

      expect(probe.focusVisible).toBe(true);
      expect(
        probe.outlineStyle !== "none" || probe.boxShadow !== "none",
        `settings toggle has no focus indicator: outline:${probe.outlineStyle}, box-shadow:${probe.boxShadow}`,
      ).toBe(true);
      expect(probe.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(
        probe.contrast,
        `settings toggle ring ${probe.outlineColor} on ${probe.backdrop} — WCAG 1.4.11 wants >=3:1`,
      ).not.toBeNull();
      expect(probe.contrast ?? 0).toBeGreaterThanOrEqual(3);
    });

    /**
     * GOL-2997. The `components/ui` primitives each opted out of the shared
     * rule with their own `outline-none` + `focus-visible:ring-ring/50`, so
     * they kept a ring that measured 1.40-2.86:1. Most of them are not mounted
     * anywhere in the dashboard yet, so `/dev/ui-focus` is the surface that
     * makes them probe-able: one section per surface token a control can land
     * on, each tagged `data-focus-surface`, so a failure names both the control
     * and the background its ring was measured against.
     */
    test("every components/ui control shows a visible ring on every surface", async ({
      page,
    }, testInfo) => {
      await page.goto("/dev/ui-focus", { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await freezeTransitions(page);

      const surfaces = await page
        .locator("[data-focus-surface]")
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-focus-surface") as string),
        );
      // If the gallery 404s (UI_FOCUS_GALLERY unset) this is the failure that
      // says so, rather than an empty pass.
      expect(
        surfaces.length,
        "no [data-focus-surface] sections on /dev/ui-focus — is UI_FOCUS_GALLERY=1 set for the dev server?",
      ).toBeGreaterThan(0);

      const failures: string[] = [];
      const report: Record<string, Probe[]> = {};

      for (const surface of surfaces) {
        const scope = `[data-focus-surface="${surface}"]`;
        // Click the section heading first: each scope has to be tabbed from
        // just above itself, or the 60-press ceiling is spent walking the
        // sections before it.
        await page.locator(`${scope} h2`).click();
        const { probes, expected } = await probeFocusByTabbing(page, scope);

        report[surface] = probes;
        expect(
          probes.map((p) => p.name).sort(),
          `Tab order did not reach every control inside ${surface}.\nexpected: ${expected.join("\n          ")}\nreached:  ${probes.map((p) => p.name).join("\n          ")}`,
        ).toEqual([...expected].sort());

        for (const problem of probes.map(verdict)) {
          if (problem) failures.push(`on ${surface}: ${problem}`);
        }
      }

      testInfo.attach(`components-ui-focus-${theme}.json`, {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });

      expect(failures, `\n  - ${failures.join("\n  - ")}\n`).toEqual([]);
    });
  });
}
