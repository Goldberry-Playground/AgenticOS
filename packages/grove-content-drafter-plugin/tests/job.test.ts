import { describe, it, expect, vi } from "vitest";
import { runContentDraft } from "../src/job.js";
import type { LlmClient } from "../src/drafter.js";

const NOW = new Date("2026-09-22T12:00:00.000Z");

function record(overrides: Record<string, unknown> = {}) {
  return {
    name: "Chicago Hardy Fig",
    categ_id: [4, "Plants / Fruit"],
    grove_shipping_tier: "bareroot",
    grove_facts_provenance: { grove_zone_min: { source: "usda", ref: "FICA", at: "2026-09-20T00:00:00Z" } },
    description_ecommerce: false,
    website_description: false,
    grove_botanical_name: "Ficus carica",
    grove_zone_min: 6,
    grove_zone_max: 9,
    grove_layer: "shrub",
    grove_sun: "full",
    grove_mature_size: "10-15 ft",
    grove_mature_spread: false,
    grove_spacing: false,
    grove_soil: false,
    grove_pollination: "Self-fertile",
    grove_years_to_fruit: "1-2 years",
    grove_chill_hours: "100",
    ...overrides,
  };
}

function fakeOdoo(over: Record<string, any> = {}) {
  return {
    searchRequested: vi.fn().mockResolvedValue({ ok: true, data: [42] }),
    read: vi.fn().mockResolvedValue({ ok: true, data: record() }),
    write: vi.fn().mockResolvedValue({ ok: true, data: true }),
    postNote: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    ...over,
  };
}

const goodDraft = JSON.stringify({
  description_ecommerce_html: "<p>A cold-hardy fig.</p>",
  website_description_html: "<h2>Site & soil</h2><p>Full sun, well-drained soil.</p>",
  filled_facts: [
    { field: "grove_soil", value: "Well-drained loam", source_name: "NC State Ext", source_url: "https://ext.ncsu.edu/fig" },
  ],
  sources: [{ name: "NC State Ext", url: "https://ext.ncsu.edu/fig" }],
});
const goodLlm: LlmClient = { complete: async () => ({ ok: true, data: goodDraft }) };

describe("runContentDraft", () => {
  it("does nothing when no product is requested", async () => {
    const odoo = fakeOdoo({ searchRequested: vi.fn().mockResolvedValue({ ok: true, data: [] }) });
    const s = await runContentDraft({ odoo: odoo as any, llm: goodLlm, houseRules: "", dryRun: false, now: NOW });
    expect(s.picked).toBe(0);
    expect(odoo.read).not.toHaveBeenCalled();
    expect(odoo.write).not.toHaveBeenCalled();
  });

  it("drafts and writes back with merged provenance and drafted state", async () => {
    const odoo = fakeOdoo();
    const s = await runContentDraft({ odoo: odoo as any, llm: goodLlm, houseRules: "", dryRun: false, now: NOW });
    expect(s.drafted).toBe(true);
    expect(s.filledFactCount).toBe(1);
    expect(odoo.write).toHaveBeenCalledOnce();
    const [id, vals] = odoo.write.mock.calls[0];
    expect(id).toBe(42);
    expect(vals.grove_draft_state).toBe("drafted");
    expect(vals.grove_facts_reviewed).toBe(false);
    expect(vals.description_ecommerce).toContain("cold-hardy fig");
    expect(vals.grove_soil).toBe("Well-drained loam");
    // provenance keeps the prior USDA entry and adds the agent one.
    expect(vals.grove_facts_provenance.grove_zone_min.source).toBe("usda");
    expect(vals.grove_facts_provenance.grove_soil).toEqual({
      source: "agent",
      ref: "https://ext.ncsu.edu/fig",
      at: NOW.toISOString(),
    });
    expect(odoo.postNote).toHaveBeenCalledOnce();
    const note = odoo.postNote.mock.calls[0][1] as string;
    expect(note).toContain("ext.ncsu.edu/fig");
  });

  it("dry-run reads and drafts but never writes or posts", async () => {
    const odoo = fakeOdoo();
    const s = await runContentDraft({ odoo: odoo as any, llm: goodLlm, houseRules: "", dryRun: true, now: NOW });
    expect(s.dryRun).toBe(true);
    expect(s.drafted).toBe(false);
    expect(odoo.read).toHaveBeenCalledOnce();
    expect(odoo.write).not.toHaveBeenCalled();
    expect(odoo.postNote).not.toHaveBeenCalled();
  });

  it("leaves state requested and posts the error when drafting fails", async () => {
    const odoo = fakeOdoo();
    const badLlm: LlmClient = { complete: async () => ({ ok: false, error: "model 500" }) };
    const s = await runContentDraft({ odoo: odoo as any, llm: badLlm, houseRules: "", dryRun: false, now: NOW });
    expect(s.drafted).toBe(false);
    expect(s.error).toBe("model 500");
    expect(odoo.write).not.toHaveBeenCalled();
    expect(odoo.postNote).toHaveBeenCalledOnce();
    expect(odoo.postNote.mock.calls[0][1]).toContain("failed");
  });

  it("posts the error when the write fails", async () => {
    const odoo = fakeOdoo({ write: vi.fn().mockResolvedValue({ ok: false, error: "AccessError" }) });
    const s = await runContentDraft({ odoo: odoo as any, llm: goodLlm, houseRules: "", dryRun: false, now: NOW });
    expect(s.drafted).toBe(false);
    expect(s.error).toBe("AccessError");
    expect(odoo.postNote).toHaveBeenCalledOnce();
  });

  it("omits provenance write when no facts were filled", async () => {
    const odoo = fakeOdoo();
    const noFill = JSON.stringify({
      description_ecommerce_html: "<p>x</p>",
      website_description_html: "<p>y</p>",
      filled_facts: [],
      sources: [],
    });
    const llm: LlmClient = { complete: async () => ({ ok: true, data: noFill }) };
    await runContentDraft({ odoo: odoo as any, llm, houseRules: "", dryRun: false, now: NOW });
    const [, vals] = odoo.write.mock.calls[0];
    expect(vals.grove_facts_provenance).toBeUndefined();
    expect(vals.grove_draft_state).toBe("drafted");
  });
});
