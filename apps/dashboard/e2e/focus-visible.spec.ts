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

type ShellSnapshot = {
  /** Keys of every visible focusable in the scope, in DOM order, right now. */
  keys: string[];
  /** The focus treatment of `document.activeElement`, if it is in the scope. */
  focused: Probe | null;
};

/**
 * Read the scope's focusable set and the current focus treatment in one pass,
 * deriving every key from the element's own properties.
 *
 * GOL-3095: this used to write a `data-focus-probe` attribute onto each control
 * up front and read it back off `document.activeElement`. React owns those
 * nodes and is free to re-create them — a theme toggle, a layout-level state
 * change, a Suspense boundary resolving, a hydration mismatch — at which point
 * every attribute the spec wrote is gone, no Tab stop can be identified, and
 * the failure reads `reached: (nothing)`: a WCAG 2.4.3 report for a cause that
 * has nothing to do with the Tab order. That cost two heartbeats on GOL-3073.
 *
 * So nothing is written. The key is `index:tag:identity` computed from the live
 * DOM at read time, which means a replacement node in the same position with
 * the same identity produces the same key, and the probe simply does not
 * notice. `identity` deliberately prefers authored, stable attributes over
 * visible text — see `identify` below.
 * What the probe cannot absorb — the focusable *set* changing underneath it —
 * is reported as drift, by name, instead of as a Tab-order finding.
 */
async function snapshotShell(
  page: import("@playwright/test").Page,
  scopeSelector: string,
): Promise<ShellSnapshot> {
  return page.evaluate(
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
      ) as HTMLElement[];

      // A key has to be stable for as long as the control is, or the drift
      // check below reads an ordinary data update as DOM replacement. So:
      // authored `aria-label` first, then an anchor's path — never the visible
      // text when something stabler exists. The nav tabs render
      // `Runs<span class="count">3</span>`; those counts are hard-coded today
      // but TabBar.tsx is explicit that they get wired to live data, at which
      // point a poll landing mid-walk would rename a control under the probe.
      const identify = (el: HTMLElement) => {
        const aria = el.getAttribute("aria-label");
        if (aria?.trim()) return aria.trim();
        if (el instanceof HTMLAnchorElement && el.getAttribute("href")) {
          return el.pathname;
        }
        const text = (el.textContent || "").trim();
        return text ? text.slice(0, 28) : "(no label)";
      };
      const keys = controls.map(
        (el, i) => `${i}:${el.tagName.toLowerCase()}:${identify(el)}`,
      );

      const el = document.activeElement as HTMLElement | null;
      const index = el ? controls.indexOf(el) : -1;
      if (!el || index === -1) return { keys, focused: null };

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
        contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }

      return {
        keys,
        focused: {
          name: keys[index],
          focusVisible: el.matches(":focus-visible"),
          outlineStyle: cs.outlineStyle,
          outlineWidth: parseFloat(cs.outlineWidth) || 0,
          outlineColor: cs.outlineColor,
          boxShadow: cs.boxShadow,
          backdrop,
          contrast,
          indicator,
        },
      };
    },
    { focusable: FOCUSABLE, scope: scopeSelector },
  );
}

/**
 * Hand the scope's markup back to the browser as new nodes.
 *
 * Only `probe survives a mid-probe re-render` uses this. It assigns HTML
 * captured *before* the probe started, so every imperative mutation made since
 * is discarded and every node is a fresh object — which is what React does
 * when it re-creates a subtree from its own tree, and the thing the old
 * attribute-based probe could not survive.
 */
async function replaceScopeNodes(
  page: import("@playwright/test").Page,
  scopeSelector: string,
  pristineHtml: string,
) {
  await page.evaluate(
    ({ scope, html }) => {
      const root = document.querySelector(scope);
      if (!root) throw new Error(`scope not found: ${scope}`);
      root.innerHTML = html;
    },
    { scope: scopeSelector, html: pristineHtml },
  );
}

type ProbeResult = {
  probes: Probe[];
  expected: string[];
  /**
   * Set when the scope's focusable set stopped matching the set the probe
   * started from. Non-null means the DOM changed under the probe, so neither
   * `probes` nor `expected` can be read as a statement about the Tab order.
   */
  drift: { press: number; keys: string[] } | null;
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
  opts: {
    /** Test hook: replace the scope's nodes after the Nth press (0-indexed). */
    disrupt?: { afterPress: number; run: () => Promise<void> };
  } = {},
): Promise<ProbeResult> {
  const expected = (await snapshotShell(page, scopeSelector)).keys;

  const probes: Probe[] = [];
  const seen = new Set<string>();
  let drift: ProbeResult["drift"] = null;
  // Generous ceiling: the skip link and anything before the scope burn presses,
  // and a re-render drops focus to <body>, so the walk restarts from the top of
  // the document and pays for the lead-in a second time.
  for (let i = 0; i < 60 && seen.size < expected.length; i++) {
    await page.keyboard.press("Tab");
    if (opts.disrupt && opts.disrupt.afterPress === i) {
      await opts.disrupt.run();
    }
    const snap = await snapshotShell(page, scopeSelector);
    if (!drift && snap.keys.join("|") !== expected.join("|")) {
      drift = { press: i + 1, keys: snap.keys };
    }
    if (snap.focused && !seen.has(snap.focused.name)) {
      seen.add(snap.focused.name);
      probes.push(snap.focused);
    }
  }
  return { probes, expected, drift };
}

/** Failure text for a focusable-set change, which is never a 2.4.3 finding. */
function driftMessage(scopeSelector: string, result: ProbeResult): string {
  const drift = result.drift;
  const why = [
    `the DOM was replaced or re-rendered under the probe at Tab press ${drift?.press},`,
    "so this run says NOTHING about the Tab order (WCAG 2.4.3). Look for a",
    "client re-render of the app shell; e2e/hydration.spec.ts names the",
    "hydration-mismatch case.",
  ].join(" ");
  const list = (keys: string[]) => keys.join("\n        ");
  return `\n${scopeSelector}: the focusable set changed — ${why}\n\nbefore: ${list(result.expected)}\nafter:  ${list(drift?.keys ?? [])}\n`;
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

      const result = await probeFocusByTabbing(page, "header.shell-header");
      const { probes, expected } = result;

      testInfo.attach(`header-focus-${theme}.json`, {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });

      // Check this BEFORE the Tab order (GOL-3095). If the header's focusable
      // set moved mid-probe, the comparison below is reading two different
      // DOMs against each other and would blame the Tab order for it.
      expect(result.drift, driftMessage("header.shell-header", result)).toBeNull();

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
        const result = await probeFocusByTabbing(page, scope);
        const { probes, expected } = result;
        expect(result.drift, driftMessage(scope, result)).toBeNull();

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

/**
 * GOL-3095 — the probe's own integrity.
 *
 * Everything above is only a statement about the app if the probe can tell a
 * skipped Tab stop apart from a DOM it no longer recognises. This test puts the
 * shell's nodes through exactly the replacement React performs on a re-render,
 * one press into the walk, and asserts the probe still names every control.
 *
 * It is the regression test for the failure mode, not a test of the app: delete
 * the drift check and the read-time keying and this goes red with the same
 * `reached: (nothing)` signature that sent GOL-3073 hunting a Tab-order bug.
 */
test.describe("focus probe integrity", () => {
  test.slow();

  test("a mid-probe re-render of the shell is not read as a Tab-order failure", async ({
    page,
  }, testInfo) => {
    const scope = "header.shell-header";
    await page.goto("/runs", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await freezeTransitions(page);
    await expect(page.locator(scope)).toBeVisible();

    // Captured before the probe runs, so replaying it discards anything the
    // probe did imperatively — same as React rendering from its own tree.
    const pristine = await page.evaluate(
      (sel) => document.querySelector(sel)!.innerHTML,
      scope,
    );

    const result = await probeFocusByTabbing(page, scope, {
      disrupt: {
        afterPress: 1,
        run: () => replaceScopeNodes(page, scope, pristine),
      },
    });

    testInfo.attach("probe-integrity.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });

    // The replacement is markup-identical, so there is nothing for the probe to
    // report: no drift, and every control still reached.
    expect(result.drift, driftMessage(scope, result)).toBeNull();
    expect(
      result.probes.map((p) => p.name).sort(),
      `The probe lost its Tab stops when the shell's nodes were replaced.\nexpected: ${result.expected.join("\n          ")}\nreached:  ${result.probes.map((p) => p.name).join("\n          ")}`,
    ).toEqual([...result.expected].sort());
  });

  /**
   * The other half of keying off the live DOM: a key must not embed a value
   * that changes on its own. The nav tabs carry count badges that TabBar.tsx
   * says will be wired to live data, so a poll landing mid-walk would rename a
   * control — and a probe keyed on visible text would report that as DOM
   * replacement. Identity comes from `aria-label` / the anchor path instead.
   */
  test("a count badge updating mid-probe is not read as DOM replacement", async ({
    page,
  }, testInfo) => {
    const scope = "header.shell-header";
    await page.goto("/runs", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await freezeTransitions(page);
    await expect(page.locator(scope)).toBeVisible();

    const { html, changed } = await page.evaluate((sel) => {
      const clone = document.querySelector(sel)!.cloneNode(true) as HTMLElement;
      const badges = clone.querySelectorAll(
        ".count, .shell-tabs-mobile__count",
      );
      badges.forEach((b, i) => {
        b.textContent = `${9000 + i}`;
      });
      return { html: clone.innerHTML, changed: badges.length };
    }, scope);
    // Guard against the mutation silently doing nothing if the badge class
    // is renamed: then this test would pass while asserting nothing.
    expect(changed, "no count badges found to update").toBeGreaterThan(0);

    const result = await probeFocusByTabbing(page, scope, {
      disrupt: { afterPress: 1, run: () => replaceScopeNodes(page, scope, html) },
    });

    testInfo.attach("probe-count-update.json", {
      body: JSON.stringify({ changed, ...result }, null, 2),
      contentType: "application/json",
    });

    expect(result.drift, driftMessage(scope, result)).toBeNull();
    expect(
      result.probes.map((p) => p.name).sort(),
      "A count badge update renamed a control under the probe — the key is reading volatile text.",
    ).toEqual([...result.expected].sort());
  });
});
