import { describe, it, expect } from "vitest";
import {
  assignTagStyles,
  buildTagLegend,
  OTHER_TAG_STYLE,
  shapePolygon,
  shapePolygonPoints,
  styleForTag,
  TAG_STYLE_SCALE,
  type TagShape,
} from "./tag-styles";

/**
 * WCAG 2.1 relative luminance and contrast ratio (SC 1.4.11), computed here
 * rather than imported so the guard below depends on nothing that a future
 * refactor of the colour pipeline could quietly redefine.
 */
function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x
  );
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The two surfaces a graph node is actually drawn on — the *strictest* of the
 * candidates, and measured in the running app rather than assumed.
 *
 * The pane backdrop is `--ink`: #060f0b dark, #f7f4f0 light. #1a1714 is the
 * documented dark-surface constant and is lighter than #060f0b, so it binds on
 * the dark side; #f7f4f0 is darker than #ffffff, so it binds on the light side.
 * Asserting this pair therefore covers every surface the ramp can land on.
 *
 * `--surface` (#182721) deliberately does NOT appear here: the graph renders
 * with `backgroundColor="transparent"` and uses `--surface` only for the label
 * halo, so no fill is ever drawn on it.
 */
const DARK_SURFACE = "#1a1714";
const LIGHT_SURFACE = "#f7f4f0";

/**
 * Brand gold is a canonical brand colour, so its contrast fix needs the brand
 * owner's sign-off and is tracked on GOL-2979 rather than landed here. Listing
 * it explicitly — instead of loosening the 3:1 floor — keeps the exception
 * visible and self-expiring: the pin below fails the moment the value moves,
 * which forces whoever lands #b69000 to delete this set at the same time.
 */
const HELD_PENDING_BRAND_SIGNOFF: ReadonlySet<string> = new Set(["#c9a227"]);

describe("TAG_STYLE_SCALE colour values", () => {
  it("is the GOL-2989 lightness-only re-tint of the brand ramp", () => {
    expect(TAG_STYLE_SCALE.map((s) => s.color)).toEqual([
      "#5c8938", // farm / moss green
      "#7452b8", // software / brand plum
      "#c9a227", // marketing / brand gold — HELD, see GOL-2979
      "#a54d00", // video / ember
      "#506586", // concepts / slate blue
      "#ba77a6", // personal / mallow
    ]);
    expect(OTHER_TAG_STYLE.color).toBe("#796e63");
  });

  it("holds >=3:1 against both theme surfaces, so each fill is a perceivable graphical object", () => {
    const measured = [...TAG_STYLE_SCALE, OTHER_TAG_STYLE]
      .map((s) => s.color)
      .filter((color) => !HELD_PENDING_BRAND_SIGNOFF.has(color))
      .map((color) => ({
        color,
        onDark: Number(contrastRatio(color, DARK_SURFACE).toFixed(2)),
        onLight: Number(contrastRatio(color, LIGHT_SURFACE).toFixed(2)),
      }));

    // Every non-held value, not just "most of them".
    expect(measured).toHaveLength(6);

    const failures = measured.filter((m) => m.onDark < 3 || m.onLight < 3);
    expect(failures).toEqual([]);
  });

  it("pins the held brand gold, so landing GOL-2979 must also retire the exception", () => {
    // If this fails because gold moved: apply the new value, then delete
    // HELD_PENDING_BRAND_SIGNOFF and this test. Do not widen the set.
    expect([...HELD_PENDING_BRAND_SIGNOFF]).toEqual(["#c9a227"]);
    expect(TAG_STYLE_SCALE[2].color).toBe("#c9a227");
    expect(contrastRatio("#c9a227", LIGHT_SURFACE)).toBeLessThan(3);
  });
});

describe("TAG_STYLE_SCALE", () => {
  it("pairs every colour with a distinct shape, so colour is never the only channel", () => {
    const shapes = TAG_STYLE_SCALE.map((s) => s.shape);
    expect(new Set(shapes).size).toBe(TAG_STYLE_SCALE.length);
    const colors = TAG_STYLE_SCALE.map((s) => s.color);
    expect(new Set(colors).size).toBe(TAG_STYLE_SCALE.length);
  });

  it("keeps the 'other' bucket distinguishable from every scale entry by shape too", () => {
    expect(TAG_STYLE_SCALE.map((s) => s.shape)).not.toContain(
      OTHER_TAG_STYLE.shape
    );
  });
});

describe("assignTagStyles", () => {
  it("hands the scale out by descending frequency", () => {
    const assignment = assignTagStyles([
      "skill",
      "skill",
      "skill",
      "goldberry",
      "goldberry",
      "tabletop",
    ]);
    expect(assignment.get("skill")).toEqual(TAG_STYLE_SCALE[0]);
    expect(assignment.get("goldberry")).toEqual(TAG_STYLE_SCALE[1]);
    expect(assignment.get("tabletop")).toEqual(TAG_STYLE_SCALE[2]);
  });

  it("breaks frequency ties alphabetically, so the same vault always maps the same way", () => {
    const a = assignTagStyles(["zeta", "alpha", "mid"]);
    expect(a.get("alpha")).toEqual(TAG_STYLE_SCALE[0]);
    expect(a.get("mid")).toEqual(TAG_STYLE_SCALE[1]);
    expect(a.get("zeta")).toEqual(TAG_STYLE_SCALE[2]);

    const reordered = assignTagStyles(["mid", "zeta", "alpha"]);
    expect([...reordered]).toEqual([...a]);
  });

  it("is case- and whitespace-insensitive", () => {
    const assignment = assignTagStyles(["Skill", " skill ", "SKILL"]);
    expect(assignment.size).toBe(1);
    expect(styleForTag("sKiLl", assignment)).toEqual(TAG_STYLE_SCALE[0]);
  });

  it("buckets tags past the end of the scale into the 'other' style", () => {
    const tags = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
    const assignment = assignTagStyles(tags);
    expect(assignment.get("t6")).toEqual(TAG_STYLE_SCALE[5]);
    expect(assignment.get("t7")).toEqual(OTHER_TAG_STYLE);
    expect(assignment.get("t8")).toEqual(OTHER_TAG_STYLE);
  });

  it("ignores empty and missing primary tags", () => {
    const assignment = assignTagStyles(["", undefined, "   ", "skill"]);
    expect(assignment.size).toBe(1);
    expect(assignment.get("skill")).toEqual(TAG_STYLE_SCALE[0]);
  });
});

describe("styleForTag", () => {
  it("falls back to the 'other' style for unknown, empty and missing tags", () => {
    const assignment = assignTagStyles(["skill"]);
    expect(styleForTag("nope", assignment)).toEqual(OTHER_TAG_STYLE);
    expect(styleForTag("", assignment)).toEqual(OTHER_TAG_STYLE);
    expect(styleForTag(undefined, assignment)).toEqual(OTHER_TAG_STYLE);
  });
});

describe("buildTagLegend", () => {
  it("names every style present in text, in scale order", () => {
    const legend = buildTagLegend([
      "skill",
      "skill",
      "goldberry",
      "tabletop",
      "tabletop",
      "tabletop",
    ]);
    expect(legend.entries.map((e) => [e.tag, e.count])).toEqual([
      ["tabletop", 3],
      ["skill", 2],
      ["goldberry", 1],
    ]);
    expect(legend.entries.map((e) => e.style)).toEqual([
      TAG_STYLE_SCALE[0],
      TAG_STYLE_SCALE[1],
      TAG_STYLE_SCALE[2],
    ]);
    expect(legend.other).toBeNull();
  });

  it("agrees with assignTagStyles for every tag it lists", () => {
    const tags = ["a", "a", "b", "c", "d", "e", "f", "g", "h"];
    const assignment = assignTagStyles(tags);
    const legend = buildTagLegend(tags);
    for (const entry of legend.entries) {
      expect(styleForTag(entry.tag, assignment)).toEqual(entry.style);
    }
  });

  it("collapses the tail and untagged pages into one labelled 'other' row", () => {
    const legend = buildTagLegend([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
      "t8",
      undefined,
      "",
    ]);
    expect(legend.entries).toHaveLength(6);
    expect(legend.other).toEqual({
      count: 4, // t7 + t8 + two untagged
      distinctTags: 2,
      hasUntagged: true,
      style: OTHER_TAG_STYLE,
    });
  });

  it("reports an 'other' row for untagged pages even when the scale is not full", () => {
    const legend = buildTagLegend(["skill", undefined]);
    expect(legend.entries).toHaveLength(1);
    expect(legend.other).toMatchObject({
      count: 1,
      distinctTags: 0,
      hasUntagged: true,
    });
  });

  it("returns an empty legend for an empty graph", () => {
    expect(buildTagLegend([])).toEqual({ entries: [], other: null });
  });
});

describe("shapePolygon", () => {
  const shapes: TagShape[] = [
    "square",
    "diamond",
    "triangle",
    "triangle-down",
    "hexagon",
    "cross",
  ];

  it("returns null only for the circle", () => {
    expect(shapePolygon("circle")).toBeNull();
    for (const shape of shapes) {
      expect(shapePolygon(shape)).not.toBeNull();
    }
  });

  it("keeps every vertex inside a sane radius multiple", () => {
    for (const shape of shapes) {
      for (const [x, y] of shapePolygon(shape) ?? []) {
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(1.35);
      }
    }
  });

  it("gives each shape a distinct outline", () => {
    const outlines = shapes.map((s) => shapePolygonPoints(s, 10));
    expect(new Set(outlines).size).toBe(shapes.length);
  });

  it("scales to an SVG points list and is empty for a circle", () => {
    expect(shapePolygonPoints("diamond", 10)).toBe(
      "0,-11.5 11.5,0 0,11.5 -11.5,0"
    );
    expect(shapePolygonPoints("circle", 10)).toBe("");
  });
});
