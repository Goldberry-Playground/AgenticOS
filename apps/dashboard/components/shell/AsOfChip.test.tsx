import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AsOfChip } from "./AsOfChip";
import { AS_OF_UNKNOWN } from "./as-of";

/**
 * GOL-3099 — the three defects the chip shipped with, each pinned by the
 * invariant that was violated rather than by the markup that happened to
 * violate it.
 *
 * The pixel measurement itself lives in the browser: jsdom has no layout
 * engine, so `getBoundingClientRect()` here returns zeroes and would pass
 * against any CSS at all. What a unit test *can* hold is the pair of facts
 * that make the measurement come out right — the time is wrapped in the
 * element the reservation targets, in both states, and the stylesheet still
 * reserves it. Both halves are needed: deleting either one reintroduces the
 * 48px jump, and neither is visible to a type checker.
 */
const CSS = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

function rule(selector: string): string {
  const at = CSS.indexOf(selector + " {");
  expect(at, `${selector} is missing from app/globals.css`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("}", at));
}

describe("AsOfChip — reserved footprint", () => {
  it("wraps the time in .as-of-time whether or not a fetch has resolved", () => {
    const pending = render(<AsOfChip scope="Fleet" />);
    const loaded = render(
      <AsOfChip scope="Fleet" asOfMs={new Date("2026-10-05T18:07:05Z").getTime()} />,
    );

    const slot = (c: HTMLElement) => c.querySelector(".vista-meta .as-of-time");

    expect(slot(pending.container)?.textContent).toBe(AS_OF_UNKNOWN);
    expect(slot(loaded.container)?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    // Same element, same class, same CSS: whatever width the rule reserves is
    // reserved for both states. A placeholder rendered outside the slot — or a
    // loaded value rendered outside it — is the 48px jump coming back.
    expect(slot(pending.container)?.className).toBe(
      slot(loaded.container)?.className,
    );
  });

  it("reserves at least the width of HH:MM:SS, with even digits", () => {
    const declared = rule(".vista-meta .as-of-time");

    // 8 monospace advances for "HH:MM:SS", plus more than the 8 × 0.08em of
    // tracking `.vista-meta` applies, so the declared width always governs.
    expect(declared).toMatch(/min-width:\s*calc\(8ch \+ 0\.75em\)/);
    expect(declared).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // Without this the min-width is inert: it does not apply to a non-replaced
    // inline box.
    expect(declared).toMatch(/display:\s*inline-block/);
  });
});

describe("AsOfChip — one unambiguous claim per page", () => {
  it("names the data it speaks for, so the layout and page chips differ in text", () => {
    const at = new Date("2026-10-05T18:07:05Z").getTime();
    const fleet = render(<AsOfChip scope="Fleet" asOfMs={at} />);
    const runs = render(<AsOfChip scope="Runs" asOfMs={at} />);

    const text = (c: HTMLElement) =>
      c.querySelector(".vista-meta")?.textContent ?? "";

    expect(text(fleet.container)).toMatch(/^Fleet · live as of /);
    expect(text(runs.container)).toMatch(/^Runs · live as of /);
    // Showing the same instant is not what made the two chips ambiguous —
    // being indistinguishable while showing different instants was. They must
    // differ even when the times agree.
    expect(text(fleet.container)).not.toBe(text(runs.container));
  });

  it("keeps the live state in words, not only in the dot's accent colour", () => {
    const { container } = render(<AsOfChip scope="Runs" />);
    expect(container.querySelector(".vista-meta")?.textContent).toContain(
      "live",
    );
    // The dot is the decorative half of that pair and must stay out of the
    // accessible name.
    expect(
      container.querySelector(".live-dot")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});

describe("AsOfChip — accessible name and live region", () => {
  it("does not name the generic container", () => {
    const { container } = render(<AsOfChip scope="Fleet" />);
    const chip = container.querySelector(".vista-meta")!;

    // ARIA 1.2 prohibits an accessible name on `role=generic`, which is what a
    // plain <div> is. The chip carried aria-label="Live data indicator" — the
    // same string on both instances, so a screen reader saw two nodes it could
    // not tell apart. The text content is the name now.
    expect(chip.getAttribute("aria-label")).toBeNull();
    expect(chip.getAttribute("aria-labelledby")).toBeNull();
    expect(chip.getAttribute("title")).toBeNull();
    expect(chip.getAttribute("role")).toBeNull();
  });

  it("makes the live-region decision explicit rather than implicit", () => {
    const { container } = render(<AsOfChip scope="Fleet" />);
    // Deliberately "off": the timestamp moves every 30s, but the KPI values it
    // qualifies are not announced either, so a polite region would interrupt
    // twice a minute to report that something never read aloud had been
    // re-read. Written down so the next reader knows it was decided, not
    // missed.
    expect(container.querySelector(".vista-meta")?.getAttribute("aria-live")).toBe(
      "off",
    );
  });
});
