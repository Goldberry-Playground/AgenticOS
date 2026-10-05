/**
 * The memory graph's category channel: a colour **and a shape** per primary tag,
 * plus the legend data that names each one in text.
 *
 * Colour cannot carry category on its own (GOL-2960). The six brand hues below
 * are near-isoluminant by construction — they have to be, to clear 3:1 against
 * both theme surfaces (GOL-2989) — so they read as one mid-tone in grayscale
 * and collapse pairwise under deuteranopia and protanopia. So every style
 * pairs its hue with a geometric shape, and `buildTagLegend` gives the graph a
 * legend keyed by the literal `#tag` — three channels, none of them
 * colour-only.
 *
 * Assignment is data-driven on purpose. A page's primary tag is its first
 * frontmatter tag, and the live vault's vocabulary is `skill` (81 pages),
 * `goldberry` (45), `tabletop` (20), `agenticos`, `instnt`, `meta`… — not the
 * folder names. The previous hardcoded map keyed on folder-ish names
 * (`farm`, `software`, `video`…) matched 3 of 157 pages, so 154 nodes shared
 * one style and the channel encoded nothing. The scale is therefore handed to
 * the tags that actually appear, most frequent first (ties alphabetical, so
 * the same vault always yields the same assignment), and the tail is bucketed
 * into one honest "other" style that the legend labels as such.
 */

/** Shapes chosen to stay separable at small size and in grayscale. */
export type TagShape =
  | "square"
  | "diamond"
  | "triangle"
  | "triangle-down"
  | "hexagon"
  | "cross"
  | "circle";

export interface TagStyle {
  color: string;
  shape: TagShape;
}

/**
 * Ordered category scale. **Every hue is unchanged from the original
 * brand-derived ramp** — re-hueing a user-facing ramp is a brand-visual call
 * and GOL-2979 decided against it. What changed (GOL-2989) is lightness only:
 * each swatch was recomputed in OKLCh with its hue and chroma frozen and only
 * `L` moved, to land every fill inside the one luminance window where it
 * clears 3:1 as a graphical object against *both* theme surfaces — the dark
 * `--surface: #1a1714` and the light theme's `#ffffff`. Measured |Δhue| is
 * ≤ 1.2° and |Δchroma| ≤ 0.007, i.e. these are the same colours, re-tinted.
 *
 * That window is narrow and the arithmetic is worth writing down, because it
 * is the reason this ramp looks "bunched" and must stay that way:
 *
 *   >= 3:1 vs #1a1714 (Y=4.71)  =>  Y >= 12.6
 *   >= 3:1 vs #ffffff           =>  Y <= 30.0
 *
 * A 1.98:1 total luminance span for six swatches caps the best possible
 * adjacent grayscale step at 1.147:1, so a *grayscale*-separable ramp is
 * unreachable on two surfaces at once — GOL-2979 proved that, and it is why
 * shape (not luminance) carries the colour-blind channel here. Do not "fix"
 * flat grayscale by pushing these values apart; that just re-breaks contrast.
 *
 * Side effect of using the full window instead of bunching inside it: worst-
 * case CIEDE2000 separation under simulated CVD improves across the board —
 * deuteranopia 5.5 -> 8.1, protanopia 6.4 -> 11.2, tritanopia 7.8 -> 11.1.
 */
export const TAG_STYLE_SCALE: readonly TagStyle[] = [
  { color: "#5c8938", shape: "square" }, // moss green  (was #7fae5c)
  // Brand plum, re-tinted. Numerically identical to `--accent-plum-500`, but
  // deliberately a literal: `:root` in globals.css re-points that token to
  // `var(--accent-gold-500)` ("plum accent retired"), so referencing it would
  // render this category gold and collide with the gold below. Canvas needs a
  // resolved string for `ctx.fillStyle` anyway.
  { color: "#7452b8", shape: "diamond" }, // brand plum  (was #8c6bce)
  // HELD at the shipped value. Brand gold is a canonical brand colour and
  // re-tinting it is the brand owner's call, not a contrast fix: #c9a227 is
  // 2.42:1 on #ffffff and is the one scale entry outside the window above.
  // TODO(GOL-2979): swap to #b69000 (5.93 / 3.01) once Abigail signs off, and
  // drop the matching exception in tag-styles.test.ts.
  { color: "#c9a227", shape: "triangle" }, // brand gold (unchanged, see above)
  { color: "#a54d00", shape: "triangle-down" }, // ember   (was #d97c3f)
  { color: "#506586", shape: "hexagon" }, // slate blue  (was #8aa0c4)
  { color: "#bd79a8", shape: "cross" }, // mallow        (was #c47fae)
];

/**
 * Pages whose primary tag falls past the scale, or that carry no tag at all.
 * Lifted off the dark surface for the same reason as the scale above: the
 * shipped #6b6157 was 2.95:1 against #1a1714.
 */
export const OTHER_TAG_STYLE: TagStyle = { color: "#796e63", shape: "circle" };

export interface TagLegendEntry {
  tag: string;
  count: number;
  style: TagStyle;
}

export interface TagLegend {
  /** Scale-assigned tags, most frequent first. */
  entries: TagLegendEntry[];
  /** The bucketed tail: tags past the scale plus untagged pages. */
  other: {
    count: number;
    distinctTags: number;
    hasUntagged: boolean;
    style: TagStyle;
  } | null;
}

function normalize(tag: string | undefined): string {
  return (tag ?? "").trim().toLowerCase();
}

/** Count primary tags, then rank by frequency with an alphabetical tiebreak. */
function rank(primaryTags: readonly (string | undefined)[]): {
  ranked: [string, number][];
  untagged: number;
} {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const raw of primaryTags) {
    const tag = normalize(raw);
    if (!tag) {
      untagged += 1;
      continue;
    }
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  return { ranked, untagged };
}

/**
 * Map each primary tag present in `primaryTags` to a style. Tags past the end
 * of the scale map to `OTHER_TAG_STYLE`, which is also what `styleForTag`
 * returns for an unknown or empty tag.
 */
export function assignTagStyles(
  primaryTags: readonly (string | undefined)[]
): Map<string, TagStyle> {
  const { ranked } = rank(primaryTags);
  const assignment = new Map<string, TagStyle>();
  ranked.forEach(([tag], index) => {
    assignment.set(tag, TAG_STYLE_SCALE[index] ?? OTHER_TAG_STYLE);
  });
  return assignment;
}

export function styleForTag(
  tag: string | undefined,
  assignment: Map<string, TagStyle>
): TagStyle {
  const key = normalize(tag);
  if (!key) return OTHER_TAG_STYLE;
  return assignment.get(key) ?? OTHER_TAG_STYLE;
}

/**
 * Legend rows for the tags present, in the same order the scale was handed
 * out, with the tail collapsed into a single labelled "other" row.
 */
export function buildTagLegend(
  primaryTags: readonly (string | undefined)[]
): TagLegend {
  const { ranked, untagged } = rank(primaryTags);
  const scaleSize = TAG_STYLE_SCALE.length;

  const entries: TagLegendEntry[] = ranked
    .slice(0, scaleSize)
    .map(([tag, count], index) => ({
      tag,
      count,
      style: TAG_STYLE_SCALE[index],
    }));

  const overflow = ranked.slice(scaleSize);
  const overflowCount = overflow.reduce((sum, [, count]) => sum + count, 0);
  const otherCount = overflowCount + untagged;

  return {
    entries,
    other:
      otherCount > 0
        ? {
            count: otherCount,
            distinctTags: overflow.length,
            hasUntagged: untagged > 0,
            style: OTHER_TAG_STYLE,
          }
        : null,
  };
}

/**
 * Unit-radius polygon for a shape, centred on the origin — `null` for a
 * circle, which both renderers special-case. One source of geometry so the
 * canvas node and the legend's SVG swatch can never drift apart.
 */
export function shapePolygon(shape: TagShape): readonly [number, number][] | null {
  switch (shape) {
    case "circle":
      return null;
    case "square": {
      const s = 0.8;
      return [
        [-s, -s],
        [s, -s],
        [s, s],
        [-s, s],
      ];
    }
    case "diamond":
      return [
        [0, -1.15],
        [1.15, 0],
        [0, 1.15],
        [-1.15, 0],
      ];
    case "triangle":
      return [
        [0, -1.2],
        [1.1, 0.75],
        [-1.1, 0.75],
      ];
    case "triangle-down":
      return [
        [0, 1.2],
        [-1.1, -0.75],
        [1.1, -0.75],
      ];
    case "hexagon": {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push([Math.cos(a), Math.sin(a)]);
      }
      return pts;
    }
    case "cross": {
      // A plus sign as a 12-gon: arm half-width `w`, arm reach `l`.
      const w = 0.42;
      const l = 1.2;
      return [
        [-w, -l],
        [w, -l],
        [w, -w],
        [l, -w],
        [l, w],
        [w, w],
        [w, l],
        [-w, l],
        [-w, w],
        [-l, w],
        [-l, -w],
        [-w, -w],
      ];
    }
  }
}

/** `shapePolygon` as an SVG `points` attribute at the given radius. */
export function shapePolygonPoints(shape: TagShape, radius: number): string {
  const poly = shapePolygon(shape);
  if (!poly) return "";
  return poly.map(([x, y]) => `${x * radius},${y * radius}`).join(" ");
}
