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
