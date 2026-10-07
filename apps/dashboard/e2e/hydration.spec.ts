import { test, expect } from "@playwright/test";

/**
 * GOL-3073 — a hydration mismatch must fail by name, not as somebody else's flake.
 *
 * `main` went red on `E2E / Playwright` at e193e91 with two failures in
 * `e2e/focus-visible.spec.ts` reporting "Tab order did not reach every header
 * control … reached: (nothing)". Nothing in that spec was wrong. Two vista
 * components read `new Date()` while rendering, so the server printed one
 * second and the client's first render printed the next. React's recovery for
 * a text mismatch is not local to the span — it discards the server HTML and
 * "regenerates this tree on the client", replacing the DOM nodes that the a11y
 * spec had just tagged with `data-focus-probe`. The probe then found zero
 * controls and blamed the Tab order.
 *
 * That indirection cost real time twice: the merge-queue run on the identical
 * tree had passed three minutes earlier (same two tests, reported `flaky`), so
 * the first read was "flaky test", and the first fix addressed only the clock
 * in the root layout — leaving the one in `VistaShell` that every per-tab vista
 * renders, which took the suite from 2 failures to 3.
 *
 * So assert the cause directly. Any route that logs a regenerating hydration
 * mismatch fails here, pointing at the component, before it can corrupt an
 * unrelated spec's DOM.
 *
 * Scoped deliberately to the tree-destroying message. React also warns about
 * attributes that "won't be patched up" — `next dev` emits one of those for
 * the CSS-module class list on `<html>` on every load, and it leaves the DOM
 * intact. Asserting on it would make this spec permanently red for a condition
 * that breaks nothing.
 */
const REGENERATING_MISMATCH =
  /Hydration failed because the server rendered (text|HTML) didn't match the client/;

/**
 * `/` is deliberately absent: it is a server redirect to `/runs`, and during
 * the client transition the app router briefly holds both the outgoing and
 * incoming segment, so `header.shell-header` matches twice and the readiness
 * check below trips on strict mode rather than on anything real. `/runs`
 * covers the same tree.
 */
const ROUTES = [
  "/runs",
  "/cost",
  "/health",
  "/memory",
  "/architecture",
  "/settings",
] as const;

for (const route of ROUTES) {
  test(`${route} hydrates without regenerating the tree`, async ({ page }) => {
    const mismatches: string[] = [];
    const record = (text: string) => {
      if (REGENERATING_MISMATCH.test(text)) mismatches.push(text);
    };

    page.on("console", (msg) => record(msg.text()));
    page.on("pageerror", (err) => record(`${err.message}\n${err.stack ?? ""}`));

    await page.goto(route, { waitUntil: "load" });

    // A 500 or an error page hydrates cleanly because there is nothing to
    // hydrate, so without this the whole spec passes vacuously — which is how
    // it first "passed" against a dev server whose workspace install was
    // incomplete. Prove the app shell actually rendered before believing the
    // absence of a mismatch means anything.
    await expect(page.locator("header.shell-header").first()).toBeVisible();

    // Hydration is scheduled after load; React logs the mismatch as it
    // recovers, so give the recovery a beat to be observable.
    await page.waitForTimeout(1500);

    expect(
      mismatches,
      `${route} hydrated with a server/client mismatch. React discarded the ` +
        `server DOM and re-rendered, which silently invalidates any node ` +
        `another spec has queried or tagged. The stack below names the ` +
        `component — look for a clock, Math.random(), or locale formatting ` +
        `read during render.\n\n${mismatches.join("\n\n")}`,
    ).toEqual([]);
  });
}
