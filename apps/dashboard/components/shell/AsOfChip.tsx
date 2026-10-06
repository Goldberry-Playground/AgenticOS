import { formatAsOf } from "./as-of";

/**
 * The "Live · as of HH:MM:SS" freshness chip in the corner of a vista banner.
 *
 * Both vista chromes render this: `KpiVista` from the root layout and
 * `VistaShell` from each tab page. Before GOL-3099 each had its own copy of
 * the markup, which is how all three of that ticket's defects came to exist in
 * two places at once:
 *
 *  1. **The chip reflowed.** The chip is right-anchored (`.vista-meta` is
 *     `position: absolute; right: 16px`) and the time is the only part of it
 *     whose width changes, so the narrow `—` placeholder let the left edge
 *     jump 48px (108px → 156px) about a second after first paint — twice per
 *     page, at both viewports. The time now lives in its own `.as-of-time`
 *     span whose CSS reserves the loaded footprint; see `app/globals.css`.
 *
 *  2. **Two chips per page could disagree.** Every route renders the layout's
 *     fleet banner *and* its own page banner. They used to share a render-time
 *     clock and so agreed by accident; `dataUpdatedAt` is per query, with
 *     different refetch intervals, so they can legitimately differ — and two
 *     identical chips showing different times reads as a bug. Hence the
 *     required {@link AsOfChipProps.scope}: each chip now names the data it
 *     speaks for, in text rather than in the accent colour the two banners
 *     already differ by (a colour-only difference is not a difference for
 *     everyone). Two claims about named, different things cannot be read as
 *     contradicting each other.
 *
 *  3. **The accessible name was invalid.** The chip was a plain `<div>` —
 *     `role=generic` — carrying `aria-label="Live data indicator"`. ARIA 1.2
 *     prohibits naming `generic`, and the name was identical on both chips, so
 *     a screen reader got two indistinguishable nodes. The attribute is gone;
 *     the text content is the name now, and the scope word makes the two
 *     distinct.
 *
 * **Live-region decision (explicit, per GOL-3099):** `aria-live="off"`. The
 * timestamp changes every 30s, but the KPI values it describes are not
 * announced either — announcing only the clock would interrupt a screen
 * reader twice a minute to report that something it never read had been
 * re-read. Freshness is available on demand in the reading order, next to the
 * numbers it qualifies, which is where someone goes looking for it.
 *
 * The pulsing `.live-dot` stays paired with the word "live" so the state
 * survives greyscale and every form of colour blindness.
 */
export interface AsOfChipProps {
  /**
   * The data this freshness claim covers — `"Fleet"` for the layout banner,
   * the tab's own name (`"Runs"`, `"Cost"`, `"Health"`, `"Memory"`,
   * `"Architecture"`) for a page banner. Required: a page shows two of these
   * chips, and an unlabelled one is indistinguishable from the other.
   */
  scope: string;
  /**
   * Epoch-ms instant the data was fetched — the backing query's
   * `dataUpdatedAt`, or `oldestUpdatedAt(...)` over all of them when a vista
   * has several, so the claim holds for every tile under the banner rather
   * than just the freshest one. `0`/`null`/omitted means nothing has resolved
   * yet and renders an em-dash in the same footprint. Never a render-time
   * clock; see `./as-of.ts`.
   */
  asOfMs?: number | null;
}

export function AsOfChip({ scope, asOfMs }: AsOfChipProps) {
  return (
    <div className="vista-meta" aria-live="off">
      <span className="live-dot" aria-hidden="true" />
      <span>
        {/*
          * One template literal, not `{scope} · live as of`: separate JSX
          * children become separate text nodes, and Chromium's accessibility
          * tree then exposes "FLEET" and " · LIVE AS OF" as two StaticText
          * siblings that some screen readers pause between. One node reads as
          * one phrase.
          */}
        {`${scope} · live as of `}
        <span className="as-of-time">{formatAsOf(asOfMs)}</span>
      </span>
    </div>
  );
}

export default AsOfChip;
