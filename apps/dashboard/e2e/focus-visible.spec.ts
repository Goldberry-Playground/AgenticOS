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
 * 3. GOL-3089: it identifies Tab stops by an *intrinsic* key recomputed on
 *    every read, never by an attribute written into the DOM. The original
 *    version tagged each control with `data-focus-probe`; any client re-render
 *    replaced those nodes, deleted the tags, and the spec reported
 *    "Tab order did not reach every header control" with an empty `reached:`
 *    list — blaming 2.4.3 for what was really a hydration mismatch. Keep
 *    identity derived from the live DOM, and keep `describeChurn` wired into
 *    the failure message, or that red herring comes straight back.
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
};

/**
 * What the walk observed about the tree it was walking (GOL-3089). Collected so
 * an incomplete walk can say *why* it was incomplete instead of defaulting to
 * the Tab-order accusation.
 */
type WalkChurn = {
  /** How many times the whole walk was restarted from the top. */
  restarts: number;
  /** Tab presses that landed outside the scope — the symptom of stolen focus. */
  focusLeftScope: number;
  /** Element nodes removed from inside the scope while the walk was running. */
  removals: number;
  /** The scope element itself was swapped for a different node. */
  rootReplaced: boolean;
  /** The set of controls in the scope changed between the start and the end. */
  controlSetChanged: boolean;
};

declare global {
  interface Window {
    __focusProbe?: {
      /** Ordered intrinsic keys of the visible focusables in `scope`. */
      keys(scope: string): string[];
      /** The key of `document.activeElement`, recomputed against the live DOM. */
      activeKey(scope: string): { key: string | null; outside: boolean };
      /** (Re)arm the mutation watch over `scope`. */
      watch(scope: string): void;
      churn(): { removals: number; rootReplaced: boolean };
    };
  }
}

/**
 * Install the page-side identity + mutation helpers on `window`.
 *
 * Deliberately on `window` and not as a DOM attribute: `window` survives a
 * client re-render, an attribute does not. That asymmetry is the whole of
 * GOL-3089.
 */
async function installProbeHelpers(
  page: import("@playwright/test").Page,
  focusableSelector: string,
) {
  await page.evaluate((focusable) => {
    const visible = (root: Element) =>
      Array.from(root.querySelectorAll(focusable)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });

    /**
     * A control's name, derived only from what the control intrinsically is:
     * its position among the scope's visible focusables, its tag, and its
     * accessible label. Recomputing this is cheap and survives node identity
     * changing underneath us.
     */
    const keyFor = (el: Element, i: number) => {
      const label =
        el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 28);
      return `${i}:${el.tagName.toLowerCase()}:${label || "(no label)"}`;
    };

    let watched: Element | null = null;
    let removals = 0;
    let rootReplaced = false;
    let observer: MutationObserver | null = null;

    window.__focusProbe = {
      keys(scope) {
        const root = document.querySelector(scope);
        if (!root) throw new Error(`scope not found: ${scope}`);
        return visible(root).map(keyFor);
      },
      activeKey(scope) {
        const root = document.querySelector(scope);
        const el = document.activeElement as HTMLElement | null;
        if (!root || !el || el === document.body || !root.contains(el)) {
          return { key: null, outside: true };
        }
        const i = visible(root).indexOf(el);
        if (i < 0) return { key: null, outside: true };
        return { key: keyFor(el, i), outside: false };
      },
      watch(scope) {
        removals = 0;
        rootReplaced = false;
        watched = document.querySelector(scope);
        observer?.disconnect();
        observer = new MutationObserver((records) => {
          // Observing from the document root, because a re-render can replace
          // the scope element itself — an observer bound to that element would
          // go quiet at exactly the moment there is something to report.
          if (watched && document.querySelector(scope) !== watched) {
            rootReplaced = true;
          }
          for (const record of records) {
            const target = record.target;
            if (!watched || !(target === watched || watched.contains(target))) {
              continue;
            }
            for (const node of Array.from(record.removedNodes)) {
              if (node.nodeType === Node.ELEMENT_NODE) removals++;
            }
          }
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      },
      churn() {
        return { removals, rootReplaced };
      },
    };
  }, focusableSelector);
}

/** Renders `WalkChurn` as the accusation to print when the walk came up short. */
function describeChurn(churn: WalkChurn): string | null {
  const signals: string[] = [];
  if (churn.rootReplaced) signals.push("the scope element was replaced");
  if (churn.removals > 0) {
    signals.push(`${churn.removals} element(s) were removed from inside the scope`);
  }
  if (churn.controlSetChanged) {
    signals.push("the set of controls in the scope changed mid-walk");
  }
  if (churn.focusLeftScope > 0) {
    signals.push(`${churn.focusLeftScope} Tab press(es) landed outside the scope`);
  }
  if (!churn.rootReplaced && churn.removals === 0 && !churn.controlSetChanged) {
    return null;
  }
  return signals.join("; ");
}

/**
 * Tab forward until every focusable inside `scope` has been visited (or we run
 * out of presses), reading the computed focus treatment at each stop.
 *
 * Returns one probe per control, keyed by a human-readable name, so a failure
 * names the control instead of an index.
 *
 * A client re-render steals focus as well as replacing nodes, so an incomplete
 * pass is retried from the top of the document — but only when the tree
 * actually changed. Retrying a stable tree would just hide a real 2.4.3
 * defect behind three identical passes.
 */
async function probeFocusByTabbing(
  page: import("@playwright/test").Page,
  scopeSelector: string,
  maxAttempts = 3,
): Promise<{ probes: Probe[]; expected: string[]; churn: WalkChurn }> {
  await installProbeHelpers(page, FOCUSABLE);

  const churn: WalkChurn = {
    restarts: 0,
    focusLeftScope: 0,
    removals: 0,
    rootReplaced: false,
    controlSetChanged: false,
  };
  let expected: string[] = [];
  let probes: Probe[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Clear focus so Tab restarts from the first focusable in the document;
    // after a re-render has stolen focus this is also how we get back on track.
    await page.evaluate((scope) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.__focusProbe!.watch(scope);
    }, scopeSelector);

    expected = await page.evaluate(
      (scope) => window.__focusProbe!.keys(scope),
      scopeSelector,
    );
    probes = [];
    const seen = new Set<string>();

    // Generous ceiling: the skip link and anything before the scope burn
    // presses, and a restart-from-top costs another lap.
    for (let i = 0; i < 60 && seen.size < expected.length; i++) {
      await page.keyboard.press("Tab");
      const read = await page.evaluate((scope) => {
        const identity = window.__focusProbe!.activeKey(scope);
        if (!identity.key) return { outside: true, probe: null };
        const el = document.activeElement as HTMLElement;

        const cs = getComputedStyle(el);

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
          // Alpha < 1 would make the measurement a lie about the painted
          // colour; treat it as unmeasurable rather than quietly
          // over-reporting.
          if (m.length >= 4 && Number(m[3]) < 1) return null;
          return [Number(m[0]), Number(m[1]), Number(m[2])];
        };

        // `outline-offset` puts a gap of the nearest painted ancestor surface
        // between the control and the ring, so that surface is the colour the
        // ring is actually adjacent to.
        let node: HTMLElement | null = el.parentElement;
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
          outside: false,
          probe: {
            name: identity.key,
            focusVisible: el.matches(":focus-visible"),
            outlineStyle: cs.outlineStyle,
            outlineWidth: parseFloat(cs.outlineWidth) || 0,
            outlineColor: cs.outlineColor,
            boxShadow: cs.boxShadow,
            backdrop,
            contrast,
          } satisfies Probe,
        };
      }, scopeSelector);

      if (read.outside) {
        churn.focusLeftScope++;
        continue;
      }
      const probe = read.probe;
      if (probe && !seen.has(probe.name)) {
        seen.add(probe.name);
        probes.push(probe);
      }
    }

    const observed = await page.evaluate(() => window.__focusProbe!.churn());
    churn.removals += observed.removals;
    churn.rootReplaced = churn.rootReplaced || observed.rootReplaced;
    const expectedNow = await page.evaluate(
      (scope) => window.__focusProbe!.keys(scope),
      scopeSelector,
    );
    churn.controlSetChanged =
      churn.controlSetChanged || expectedNow.join("|") !== expected.join("|");

    if (seen.size >= expected.length) break;
    // Only a changed tree earns a retry; a stable tree that skips a control is
    // the 2.4.3 defect this spec exists to catch.
    if (!describeChurn(churn)) break;
    if (attempt < maxAttempts) churn.restarts++;
  }

  return { probes, expected, churn };
}

/**
 * Collect the browser-side errors Playwright otherwise swallows, so a failure
 * can quote the hydration mismatch that caused it. A green run ignores these
 * (see GOL-2617): they are diagnostics, not assertions.
 */
function collectClientErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

/** The subset of client errors that explain a tree being rebuilt. */
function hydrationErrors(errors: string[]): string[] {
  return errors.filter((e) => /hydrat/i.test(e));
}

/** A control is compliant when it paints a >=2px ring at >=3:1, or a shadow. */
function verdict(p: Probe): string | null {
  if (!p.focusVisible) {
    return `${p.name}: :focus-visible did not match — probe reached it by means other than the keyboard`;
  }
  const hasOutline = p.outlineStyle !== "none" && p.outlineWidth >= 2;
  const hasShadow = p.boxShadow !== "none" && p.boxShadow !== "";
  if (!hasOutline && !hasShadow) {
    return `${p.name}: NO focus indicator — outline:${p.outlineStyle} ${p.outlineWidth}px, box-shadow:${p.boxShadow} (WCAG 2.4.7)`;
  }
  if (hasOutline && p.contrast !== null && p.contrast < 3) {
    return `${p.name}: focus ring ${p.outlineColor} is only ${p.contrast.toFixed(2)}:1 on ${p.backdrop} — WCAG 1.4.11 wants >=3:1`;
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
      const clientErrors = collectClientErrors(page);

      await page.goto("/runs", { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await freezeTransitions(page);

      const { probes, expected, churn } = await probeFocusByTabbing(
        page,
        "header.shell-header",
      );

      testInfo.attach(`header-focus-${theme}.json`, {
        body: JSON.stringify({ expected, probes, churn, clientErrors }, null, 2),
        contentType: "application/json",
      });

      // GOL-3089 — accuse the right thing first. The walk cannot distinguish
      // "the Tab order skips controls" from "the app shell was rebuilt under
      // the walk", and the assertion below prints the former either way. If
      // the tree changed, say so here, with the evidence.
      const churnReason = describeChurn(churn);
      if (probes.length < expected.length && churnReason) {
        const hydration = hydrationErrors(clientErrors);
        throw new Error(
          [
            `The app shell re-rendered during the Tab walk — ${churnReason}.`,
            "",
            "This is NOT a Tab-order defect. The controls were replaced (and",
            "focus stolen) while the walk was in progress, so the walk could",
            `not finish it: ${probes.length}/${expected.length} controls probed`,
            `after ${churn.restarts} restart(s).`,
            "",
            hydration.length
              ? `Most likely cause — React discarded and rebuilt the tree after a\nhydration mismatch:\n  ${hydration.join("\n  ")}`
              : "No hydration error was logged. Look for another source of a\nclient re-render in the shell (a state update on mount, a live\nclock, a fetch resolving into a key change).",
            "",
            `expected: ${expected.join("\n          ")}`,
            `reached:  ${probes.map((p) => p.name).join("\n          ") || "(nothing)"}`,
          ].join("\n"),
        );
      }

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
      const clientErrors = collectClientErrors(page);

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
      // GOL-3089: a client re-render steals focus here too, and "Tab never
      // reached a switch" reads like a Tab-order defect when it is not.
      const hydration = hydrationErrors(clientErrors);
      expect(
        landed,
        hydration.length
          ? `Tab never reached a role=switch on /settings — but React rebuilt the\npage after a hydration mismatch, which steals focus mid-walk. Fix that\nfirst; this is probably not a Tab-order defect:\n  ${hydration.join("\n  ")}`
          : "Tab never reached a role=switch on /settings",
      ).toBe(true);

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
        body: JSON.stringify({ probe, clientErrors }, null, 2),
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
  });
}

/**
 * GOL-3089 — the guard for the walk itself.
 *
 * The original probe wrote `data-focus-probe` onto every control and read it
 * back off `document.activeElement`. A client re-render replaced those nodes,
 * the attributes went with them, and the spec failed with "Tab order did not
 * reach every header control" and an empty `reached:` list — a 2.4.3
 * accusation for a hydration bug. Finding that took reading the `[WebServer]`
 * log of a CI job.
 *
 * So: rebuild the shell header under the walk, deterministically, the first
 * time focus enters it, and require the walk to still name every control.
 *
 * The `rootReplaced` assertion is load-bearing and goes first. Without it this
 * test passes vacuously the day the injection stops landing, and the
 * resilience it is guarding rots unobserved.
 */
test("the Tab walk survives a client re-render of the app shell (GOL-3089)", async ({
  page,
}, testInfo) => {
  await page.goto("/runs", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await freezeTransitions(page);

  // Replace the header with a fresh copy of itself the first time the walk
  // focuses into it: new nodes, no attributes carried over, focus dropped to
  // `body` — what React does when it discards and re-renders a subtree.
  await page.evaluate((scope) => {
    const root = document.querySelector(scope);
    if (!root) throw new Error(`scope not found: ${scope}`);
    let fired = false;
    root.addEventListener(
      "focusin",
      () => {
        if (fired) return;
        fired = true;
        // Out of the event handler, so focus lands before the tree goes.
        setTimeout(() => root.replaceWith(root.cloneNode(true)), 0);
      },
      true,
    );
  }, "header.shell-header");

  const { probes, expected, churn } = await probeFocusByTabbing(
    page,
    "header.shell-header",
  );

  testInfo.attach("header-focus-rerender.json", {
    body: JSON.stringify({ expected, probes, churn }, null, 2),
    contentType: "application/json",
  });

  expect(
    churn.rootReplaced,
    "the forced re-render never landed — this test proves nothing until it does",
  ).toBe(true);

  expect(
    probes.map((p) => p.name).sort(),
    `The walk lost controls to a re-render it is supposed to absorb.\nchurn: ${JSON.stringify(churn)}\nexpected: ${expected.join("\n          ")}\nreached:  ${probes.map((p) => p.name).join("\n          ") || "(nothing)"}`,
  ).toEqual([...expected].sort());

  // And the probes it collected are still real measurements, not husks.
  const failures = probes.map(verdict).filter(Boolean);
  expect(failures, `\n  - ${failures.join("\n  - ")}\n`).toEqual([]);
});
