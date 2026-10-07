import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { MemoryVista } from "./MemoryVista";
import { AS_OF_UNKNOWN, formatAsOf, oldestUpdatedAt } from "./as-of";

/**
 * GOL-3111 — the "as of" chip speaks for every tile under its banner, so it
 * has to report the data it is *least* sure about.
 *
 * React Query's `dataUpdatedAt` advances only on a successful fetch. The
 * original helper took the `max` of them, which meant one query failing was
 * invisible: its stamp froze at the last good fetch while a healthy sibling on
 * the same 30s interval kept dragging the label forward. The chip read "live as
 * of 18:07:05" over a tile showing data from 40 minutes ago — a false claim in
 * exactly the failure the indicator exists for.
 *
 * Both halves below are load-bearing. The pure-function tests pin the rule; the
 * render test pins that the vistas actually apply it, because a caller reverting
 * to `Math.max(...)` inline would leave every unit test here green.
 */

/** Two instants far enough apart that their HH:MM:SS strings differ. */
const STALLED = new Date("2026-10-05T17:27:05Z").getTime();
const HEALTHY = new Date("2026-10-05T18:07:05Z").getTime();

describe("oldestUpdatedAt", () => {
  it("reports the stalled query, not the healthy one beside it", () => {
    // The defect, in one line: `max` here returned HEALTHY and the 40-minute-old
    // tile went unmentioned. Both argument orders, so the result cannot depend
    // on which query a caller happens to list first.
    expect(oldestUpdatedAt(STALLED, HEALTHY)).toBe(STALLED);
    expect(oldestUpdatedAt(HEALTHY, STALLED)).toBe(STALLED);
  });

  it("stays put while a healthy sibling keeps refetching", () => {
    // Four successful refetches of one query against a stalled other. Under
    // `max` the label walked forward once every 30s; the honest label does not
    // move until the stalled query comes back.
    let healthy = HEALTHY;
    for (let i = 0; i < 4; i++) {
      healthy += 30_000;
      expect(oldestUpdatedAt(STALLED, healthy)).toBe(STALLED);
    }
    // ...and the moment it does come back, the label jumps to the new floor.
    expect(oldestUpdatedAt(healthy - 1_000, healthy)).toBe(healthy - 1_000);
  });

  it("skips queries that have not resolved rather than pinning the label to the epoch", () => {
    // A pending query carries 0. Counting it as the minimum would render an
    // em-dash over tiles that already have data, for as long as the slowest
    // endpoint takes — so zeros are skipped and the reading describes the
    // resolved subset. Decision recorded in as-of.ts.
    expect(oldestUpdatedAt(0, HEALTHY)).toBe(HEALTHY);
    expect(oldestUpdatedAt(HEALTHY, 0, 0)).toBe(HEALTHY);
    expect(oldestUpdatedAt(null, STALLED, undefined, HEALTHY)).toBe(STALLED);
  });

  it("returns a no-time-yet 0 when nothing has resolved", () => {
    expect(oldestUpdatedAt()).toBe(0);
    expect(oldestUpdatedAt(0, 0)).toBe(0);
    expect(oldestUpdatedAt(null, undefined)).toBe(0);
    // Which is the state the chip renders as an em-dash rather than 1970.
    expect(formatAsOf(oldestUpdatedAt(null, 0))).toBe(AS_OF_UNKNOWN);
  });

  it("refuses values that are not instants", () => {
    // `min` is the dangerous direction for junk: NaN poisons a comparison and
    // -Infinity or a negative stamp would win outright and freeze the chip at
    // an invented time.
    expect(oldestUpdatedAt(Number.NaN, HEALTHY)).toBe(HEALTHY);
    expect(oldestUpdatedAt(-Infinity, HEALTHY)).toBe(HEALTHY);
    expect(oldestUpdatedAt(Infinity, HEALTHY)).toBe(HEALTHY);
    expect(oldestUpdatedAt(-1, HEALTHY)).toBe(HEALTHY);
  });
});

describe("a vista's chip, end to end", () => {
  it("MemoryVista reports the stalled OpenViking fetch, not the fresh vault one", () => {
    // The live case: /api/viking/scopes going quiet while /api/vault/stats keeps
    // answering. Seeded through the cache with explicit `updatedAt` stamps, so
    // this is the real hook wiring rather than a prop handed to AsOfChip.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, refetchOnMount: false },
      },
    });
    client.setQueryData(
      ["viking", "scopes"],
      { reachable: true, total: 1200, scopes: { grove: 1200 } },
      { updatedAt: STALLED },
    );
    client.setQueryData(
      ["vault", "stats"],
      { pageCount: 418, builtAt: HEALTHY },
      { updatedAt: HEALTHY },
    );

    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryVista />
      </QueryClientProvider>,
    );

    const chip = container.querySelector(".vista-meta")?.textContent ?? "";
    expect(chip).toContain(formatAsOf(STALLED));
    expect(chip).not.toContain(formatAsOf(HEALTHY));
  });
});
