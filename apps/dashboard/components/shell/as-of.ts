/**
 * The one place the "Live · as of HH:MM:SS" indicator is formatted.
 *
 * GOL-2653 / GOL-3073 — both vista chromes used to read the clock *while
 * rendering*: `KpiVista` called `liveTimestamp()` with no argument and
 * `VistaShell` fell back to `new Date()` whenever `asOf` was absent, while
 * every caller handed it `useMemo(() => new Date().toISOString(), [])` — which
 * is not one value shared by the server and the client, but a fresh reading in
 * each environment.
 *
 * That is a guaranteed hydration mismatch the moment the second ticks over
 * between the SSR render and hydration, and React's recovery is not local to
 * the span: it discards the server HTML and regenerates the tree on the
 * client. `e2e/focus-visible.spec.ts` tags each header control with a
 * `data-focus-probe` attribute and then Tabs through reading it back, so the
 * regeneration deleted every attribute it had just written and the spec
 * reached zero controls — red on `main` at e193e91, from a commit whose
 * merge-queue run on the identical tree three minutes earlier had passed.
 *
 * The contract here closes the hole structurally: callers pass an instant, and
 * "no instant yet" is a first-class state that renders an em-dash. React Query's
 * `dataUpdatedAt` is 0 until a fetch resolves, so the server and the client's
 * first render agree on "no time yet" and the mismatch cannot occur. It also
 * makes the label honest — the old clock was sampled once at first paint and
 * never again, so it froze while the readings beside it refreshed every 30s.
 */

/** Rendered in place of a time when no fetch has resolved yet. */
export const AS_OF_UNKNOWN = "—";

/**
 * Format an epoch-ms instant as local `HH:MM:SS`.
 *
 * `0`, `null` and `undefined` all mean "no data has arrived yet" and render
 * {@link AS_OF_UNKNOWN}. Never falls back to the current time: a wall clock
 * read during render is the defect this module exists to prevent.
 */
export function formatAsOf(epochMs: number | null | undefined): string {
  if (!epochMs || !Number.isFinite(epochMs)) return AS_OF_UNKNOWN;
  const d = new Date(epochMs);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * The honest "as of" instant for a vista backed by several React Query
 * queries: the **oldest** of their `dataUpdatedAt` stamps, skipping zeros.
 *
 * GOL-3111. `dataUpdatedAt` advances only when a fetch *succeeds*, so the
 * previous version of this function — a `max` named `freshestUpdatedAt` —
 * reported the healthiest query and made a failing one invisible: its stamp
 * froze while a sibling on the same 30s interval kept dragging the label
 * forward. The chip would read "live as of 18:07:05" with a tile beside it
 * showing data from 40 minutes ago, which is precisely the condition the chip
 * exists to surface.
 *
 * `min` makes the claim one the whole banner can keep. Once every query has
 * resolved, the oldest stamp is the point past which *something* on screen may
 * be stale, and a freshness indicator that over-promises is worse than none.
 *
 * Two deliberate decisions, so the next reader knows they were decided:
 *
 *  - **Zeros are skipped, not treated as the minimum.** A query that has not
 *    resolved yet carries 0; counting it would pin every banner to the epoch
 *    for the first few hundred milliseconds of every page load, and
 *    {@link formatAsOf} would render `—` even for data already on screen.
 *  - **A partial reading wins over no reading.** While some queries have
 *    resolved and others have not, the result describes only the resolved
 *    subset — it is a floor over part of the banner rather than all of it. The
 *    alternative, holding `—` until the last query lands, hides a true
 *    statement about the tiles that *are* populated for as long as the slowest
 *    endpoint takes. An honest floor over what has arrived beats silence.
 *
 * Known limit, not fixed here: a query that fails on its *first* attempt has
 * never had a successful fetch, so its stamp is 0 and it is skipped — the
 * label still speaks only for its siblings. Stamps alone cannot tell "not back
 * yet" from "never came back"; distinguishing them needs the query's error
 * state and a different affordance than a timestamp, because the honest
 * message there is "a tile is unavailable", not an older time.
 *
 * Returns 0 when nothing has resolved, which {@link formatAsOf} renders as
 * {@link AS_OF_UNKNOWN}.
 */
export function oldestUpdatedAt(
  ...stamps: Array<number | null | undefined>
): number {
  let oldest = 0;
  for (const s of stamps) {
    if (!s || !Number.isFinite(s) || s <= 0) continue;
    if (oldest === 0 || s < oldest) oldest = s;
  }
  return oldest;
}
