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
 * The freshest of several React Query `dataUpdatedAt` stamps.
 *
 * A vista backed by more than one query is "as of" its most recent fetch; a
 * query that has not resolved contributes 0 and so cannot drag the label back
 * to the epoch. Returns 0 when nothing has resolved.
 */
export function freshestUpdatedAt(
  ...stamps: Array<number | null | undefined>
): number {
  let newest = 0;
  for (const s of stamps) {
    if (s && Number.isFinite(s) && s > newest) newest = s;
  }
  return newest;
}
