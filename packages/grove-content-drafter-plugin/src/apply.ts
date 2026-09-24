/**
 * Odoo read/write half of the content-drafter. Both phases share it:
 *   - the request phase reads a product's facts to build the drafting brief;
 *   - the receive phase writes the agent's validated draft back.
 *
 * All Odoo writes stay here in the plugin — the drafting agent never gets Odoo
 * credentials (GOL-2424 Option A). The write mirrors the Odoo model's own
 * invariant: stamping agent-filled provenance clears the human Facts-reviewed
 * sign-off, and the product lands in draft_state='drafted' for review.
 */
import type { OdooClient, OdooRecord } from "./odoo-client.js";
import type { DraftResult, FillableField, ProductView } from "./drafter.js";
import { FILLABLE_FACT_FIELDS } from "./drafter.js";
import type { XmlRpcValue } from "./xmlrpc.js";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export const FACT_FIELDS = [
  "grove_botanical_name",
  "grove_zone_min",
  "grove_zone_max",
  "grove_layer",
  "grove_sun",
  "grove_mature_size",
  "grove_mature_spread",
  "grove_spacing",
  "grove_soil",
  "grove_pollination",
  "grove_years_to_fruit",
  "grove_chill_hours",
  "grove_growth_rate",
  "grove_bloom_season",
  "grove_harvest_season",
  "grove_watering",
  "grove_wildlife",
];

export const READ_FIELDS = [
  "name",
  "categ_id",
  "write_date",
  "grove_shipping_tier",
  "grove_facts_provenance",
  "description_ecommerce",
  "website_description",
  ...FACT_FIELDS,
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Odoo scalars come back as false/0/"" when empty; normalise to a display string. */
export function factToString(v: XmlRpcValue | undefined): string {
  if (v === false || v === null || v === undefined) return "";
  if (typeof v === "number") return v === 0 ? "" : String(v);
  return String(v);
}

export function toProductView(id: number, rec: OdooRecord): ProductView {
  const facts: Record<string, string> = {};
  for (const f of FACT_FIELDS) facts[f] = factToString(rec[f]);
  const emptyFillable = (FILLABLE_FACT_FIELDS as readonly string[]).filter(
    (f) => !facts[f],
  ) as FillableField[];
  const categ = rec.categ_id;
  const category = Array.isArray(categ) && categ.length === 2 ? String(categ[1]) : "";
  return {
    id,
    name: factToString(rec.name),
    botanicalName: facts.grove_botanical_name ?? "",
    category,
    shippingTier: factToString(rec.grove_shipping_tier),
    facts,
    emptyFillable,
  };
}

/**
 * Write a validated draft back to one product template: description +
 * care guide + any cited fills, merged provenance, draft_state='drafted',
 * grove_facts_reviewed=false. Posts the sources note on success. The provenance
 * for the product's *existing* facts is passed in so we merge rather than clobber.
 */
export async function applyDraftToOdoo(
  odoo: OdooClient,
  productId: number,
  existingProvenanceRaw: XmlRpcValue | undefined,
  draft: DraftResult,
  now: Date,
): Promise<Result<{ filledFactCount: number }>> {
  const nowIso = now.toISOString();
  const existingProv =
    existingProvenanceRaw && typeof existingProvenanceRaw === "object" && !Array.isArray(existingProvenanceRaw)
      ? { ...(existingProvenanceRaw as Record<string, XmlRpcValue>) }
      : {};

  const vals: Record<string, XmlRpcValue> = {
    description_ecommerce: draft.descriptionEcommerce,
    website_description: draft.websiteDescription,
    grove_draft_state: "drafted",
    grove_facts_reviewed: false,
  };
  for (const f of draft.filledFacts) {
    vals[f.field] = f.value;
    existingProv[f.field] = { source: "agent", ref: f.sourceUrl, at: nowIso };
  }
  if (draft.filledFacts.length > 0) {
    vals.grove_facts_provenance = existingProv;
  }

  const wrote = await odoo.write(productId, vals);
  if (!wrote.ok) return { ok: false, error: wrote.error };

  await odoo.postNote(productId, renderSourcesNote(draft.filledFacts, draft.sources));
  return { ok: true, data: { filledFactCount: draft.filledFacts.length } };
}

export function renderSourcesNote(
  filled: { field: string; value: string; sourceName: string; sourceUrl: string }[],
  sources: { name: string; url: string }[],
): string {
  const parts: string[] = [
    "<p><strong>Content drafted by grove-content-drafter.</strong> Review and tick Facts reviewed + Guide approved to publish.</p>",
  ];
  if (filled.length) {
    parts.push("<p>Filled facts (cited):</p><ul>");
    for (const f of filled) {
      parts.push(
        `<li>${escapeHtml(f.field)}: ${escapeHtml(f.value)} — <a href="${escapeHtml(f.sourceUrl)}">${escapeHtml(f.sourceName)}</a></li>`,
      );
    }
    parts.push("</ul>");
  }
  if (sources.length) {
    parts.push("<p>Sources used:</p><ul>");
    for (const s of sources) parts.push(`<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a></li>`);
    parts.push("</ul>");
  }
  return parts.join("");
}
