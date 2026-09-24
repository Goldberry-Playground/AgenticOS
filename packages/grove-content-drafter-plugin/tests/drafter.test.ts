import { describe, it, expect } from "vitest";
import { parseDraftResponse, buildSystemPrompt, buildUserPrompt, type ProductView } from "../src/drafter.js";

function view(overrides: Partial<ProductView> = {}): ProductView {
  return {
    id: 42,
    name: "Chicago Hardy Fig",
    botanicalName: "Ficus carica",
    category: "Plants / Fruit",
    shippingTier: "bareroot",
    facts: {
      grove_botanical_name: "Ficus carica",
      grove_zone_min: "6",
      grove_soil: "",
      grove_spacing: "",
    },
    emptyFillable: ["grove_soil", "grove_spacing"],
    ...overrides,
  };
}

describe("prompt building", () => {
  it("system prompt embeds the allow-list and house rules", () => {
    const sys = buildSystemPrompt("Juglone is a minor factor; never say 'poison'.");
    expect(sys).toContain("p, h2, h3, ul, ol, li, strong, em, a[href]");
    expect(sys).toContain("never say 'poison'");
  });

  it("user prompt lists facts and only the empty fillable fields", () => {
    const u = buildUserPrompt(view());
    expect(u).toContain("Ficus carica");
    expect(u).toContain("grove_soil");
    expect(u).toContain("grove_spacing");
    expect(u).not.toContain("grove_zone_min (grove_zone_min)"); // zones aren't fillable
  });

  it("user prompt asks for spread / pollination / years-to-fruit (GOL-2544)", () => {
    const u = buildUserPrompt(view());
    expect(u).toMatch(/mature height and spread/i);
    expect(u).toMatch(/pollination/i);
    expect(u).toMatch(/years to fruit/i);
  });
});

describe("parseDraftResponse", () => {
  const good = JSON.stringify({
    description_ecommerce_html: "<p>A cold-hardy fig.</p><div>drop me</div>",
    website_description_html: "<h2>Site & soil</h2><p>Full sun.</p>",
    filled_facts: [
      { field: "grove_soil", value: "Well-drained loam", source_name: "NC State Ext", source_url: "https://ext.ncsu.edu/fig" },
      { field: "grove_zone_min", value: "5", source_name: "x", source_url: "https://x" }, // not fillable → dropped
      { field: "grove_spacing", value: "10 ft", source_name: "bad", source_url: "javascript:evil" }, // unsafe url → dropped
    ],
    sources: [{ name: "NC State Ext", url: "https://ext.ncsu.edu/fig" }],
  });

  it("sanitises html and accepts only valid fills", () => {
    const res = parseDraftResponse(good, view().emptyFillable);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.descriptionEcommerce).toBe("<p>A cold-hardy fig.</p>drop me");
    expect(res.data.websiteDescription).toContain("<h2>Site & soil</h2>");
    expect(res.data.filledFacts).toHaveLength(1);
    expect(res.data.filledFacts[0]!.field).toBe("grove_soil");
    expect(res.data.sources).toHaveLength(1);
  });

  it("strips code fences before parsing", () => {
    const fenced = "```json\n" + good + "\n```";
    const res = parseDraftResponse(fenced, view().emptyFillable);
    expect(res.ok).toBe(true);
  });

  it("errors on invalid JSON", () => {
    const res = parseDraftResponse("not json at all", view().emptyFillable);
    expect(res.ok).toBe(false);
  });

  it("errors when description or guide is empty", () => {
    const empty = JSON.stringify({ description_ecommerce_html: "", website_description_html: "<p>x</p>" });
    const res = parseDraftResponse(empty, view().emptyFillable);
    expect(res.ok).toBe(false);
  });
});
