import { test, expect, type Page } from "@playwright/test";

/**
 * GOL-3874 — the command palette must actually open.
 *
 * `CommandDialog` rendered its children straight into `DialogContent` with no
 * cmdk `Command` root, so `CommandInput` read an undefined store context and
 * every open threw `Cannot read properties of undefined (reading 'subscribe')`.
 * Nothing mounts the palette until it is opened, so the page looked healthy
 * and the suite stayed green. These specs open it for real, through both
 * entry points.
 */

const TRIGGER_NAME = /open command palette/i;

// `/` client-redirects here just after load, which would tear down the page
// mid-spec (and close the palette with it).
const ROUTE = "/runs";

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function palette(page: Page) {
  return page.locator('[data-slot="dialog-content"]');
}

/**
 * The hotkey listener binds in an effect, so an early press is lost before
 * hydration. Retries must not press while it is open: Ctrl+K toggles.
 */
async function openWithHotkey(page: Page) {
  await expect(async () => {
    if (!(await palette(page).isVisible())) {
      await page.keyboard.press("Control+k");
    }
    await expect(palette(page)).toBeVisible({ timeout: 500 });
  }).toPass();
}

/** Same hydration race as the hotkey; opening twice is harmless here. */
async function openWithTrigger(page: Page) {
  const trigger = page.getByRole("button", { name: TRIGGER_NAME });
  await expect(async () => {
    if (!(await palette(page).isVisible())) {
      await trigger.click();
    }
    await expect(palette(page)).toBeVisible({ timeout: 500 });
  }).toPass();
}

async function expectPaletteWorks(page: Page) {
  await expect(palette(page).locator("[cmdk-root]")).toHaveCount(1);
  const input = page.getByPlaceholder("Search skills, wiki pages, runs…");
  await expect(input).toBeFocused();
  await input.fill("settings");
  await expect(page.getByRole("option", { name: "Open Settings" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Clear filter" })).toHaveCount(0);
}

test.describe("command palette", () => {
  test("Ctrl+K opens it and Esc returns focus", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(ROUTE);

    await page.keyboard.press("Tab");
    const previouslyFocused = await page.evaluateHandle(() => document.activeElement);

    await openWithHotkey(page);
    await expectPaletteWorks(page);

    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
    await expect
      .poll(() => previouslyFocused.evaluate((el) => el === document.activeElement))
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test("the header trigger opens it and Esc returns focus", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(ROUTE);

    await openWithTrigger(page);
    await expectPaletteWorks(page);

    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: TRIGGER_NAME })).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("it fits the viewport with a margin", async ({ page }) => {
    await page.goto(ROUTE);
    await openWithTrigger(page);

    const box = await palette(page).boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(16);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width - 16);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    // The desktop palette is a 640px search surface, not a 384px dialog.
    if (viewport!.width >= 1024) expect(box!.width).toBe(640);
  });
});
