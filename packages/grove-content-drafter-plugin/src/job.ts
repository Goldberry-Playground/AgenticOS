/**
 * The content-drafter run: one product per invocation.
 *
 * 1. find the oldest product.template with grove_draft_state = 'requested'
 * 2. read its facts + provenance
 * 3. draft the storefront description + care guide (and any empty fillable facts)
 * 4. write them back, stamp provenance for agent-filled facts, set draft_state
 *    'drafted', leave grove_guide_ready / grove_facts_reviewed FALSE, and post a
 *    chatter note listing every source
 *
 * A failure at any step leaves the product in 'requested' and posts the error to
 * chatter; the next poll retries. One product per run keeps drafts reviewable
 * and the LLM/Perenual budgets bounded.
 */
import type { OdooClient, OdooRecord } from "./odoo-client.js";
import type { LlmClient, ProductView, FillableField } from "./drafter.js";
import { draftContent, FILLABLE_FACT_FIELDS } from "./drafter.js";
import type { XmlRpcValue } from "./xmlrpc.js";

const FACT_FIELDS = [
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

const READ_FIELDS = [
  "name",
  "categ_id",
  "grove_shipping_tier",
  "grove_facts_provenance",
  "description_ecommerce",
  "website_description",
  ...FACT_FIELDS,
];

export interface ContentDraftDeps {
  odoo: OdooClient;
  llm: LlmClient;
  houseRules: string;
  dryRun: boolean;
  now: Date;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

export interface ContentDraftSummary {
  picked: number;
  productId: number | null;
  drafted: boolean;
  dryRun: boolean;
  filledFactCount: number;
  error?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Odoo scalars come back as false/0/"" when empty; normalise to a display string. */
function factToString(v: XmlRpcValue | undefined): string {
  if (v === false || v === null || v === undefined) return "";
  if (typeof v === "number") return v === 0 ? "" : String(v);
  return String(v);
}

function toProductView(id: number, rec: OdooRecord): ProductView {
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

export async function runContentDraft(deps: ContentDraftDeps): Promise<ContentDraftSummary> {
  const { odoo, llm, houseRules, dryRun, now, logger } = deps;
  const empty: ContentDraftSummary = { picked: 0, productId: null, drafted: false, dryRun, filledFactCount: 0 };

  const search = await odoo.searchRequested(1);
  if (!search.ok) return { ...empty, error: `search failed: ${search.error}` };
  const id = search.data[0];
  if (id === undefined) return empty;

  const read = await odoo.read(id, READ_FIELDS);
  if (!read.ok) return { ...empty, picked: 1, productId: id, error: `read failed: ${read.error}` };

  const product = toProductView(id, read.data);
  const draft = await draftContent(llm, houseRules, product);
  if (!draft.ok) {
    // Leave state 'requested'; surface the error to the reviewer.
    await odoo.postNote(
      id,
      `<p><strong>Content draft failed.</strong> ${escapeHtml(draft.error)} — left as requested; will retry.</p>`,
    );
    return { picked: 1, productId: id, drafted: false, dryRun, filledFactCount: 0, error: draft.error };
  }

  if (dryRun) {
    logger?.info("content-drafter dry-run (no write)", {
      productId: id,
      name: product.name,
      filledFacts: draft.data.filledFacts.map((f) => f.field),
      sources: draft.data.sources.map((s) => s.url),
    });
    return { picked: 1, productId: id, drafted: false, dryRun: true, filledFactCount: draft.data.filledFacts.length };
  }

  // Assemble the write. Provenance for agent-filled facts is merged onto the
  // existing map; stamping it clears the human Facts-reviewed sign-off (enforced
  // both here and by the Odoo model's write()).
  const nowIso = now.toISOString();
  const existingProv =
    read.data.grove_facts_provenance && typeof read.data.grove_facts_provenance === "object" &&
    !Array.isArray(read.data.grove_facts_provenance)
      ? { ...(read.data.grove_facts_provenance as Record<string, XmlRpcValue>) }
      : {};

  const vals: Record<string, XmlRpcValue> = {
    description_ecommerce: draft.data.descriptionEcommerce,
    website_description: draft.data.websiteDescription,
    grove_draft_state: "drafted",
    grove_facts_reviewed: false,
  };
  for (const f of draft.data.filledFacts) {
    vals[f.field] = f.value;
    existingProv[f.field] = { source: "agent", ref: f.sourceUrl, at: nowIso };
  }
  if (draft.data.filledFacts.length > 0) {
    vals.grove_facts_provenance = existingProv;
  }

  const wrote = await odoo.write(id, vals);
  if (!wrote.ok) {
    await odoo.postNote(
      id,
      `<p><strong>Content draft write failed.</strong> ${escapeHtml(wrote.error)} — left as requested; will retry.</p>`,
    );
    return { picked: 1, productId: id, drafted: false, dryRun, filledFactCount: 0, error: wrote.error };
  }

  await odoo.postNote(id, renderSourcesNote(draft.data.filledFacts, draft.data.sources));
  logger?.info("content-drafter drafted", { productId: id, filledFacts: draft.data.filledFacts.length });
  return {
    picked: 1,
    productId: id,
    drafted: true,
    dryRun: false,
    filledFactCount: draft.data.filledFacts.length,
  };
}

function renderSourcesNote(
  filled: { field: string; value: string; sourceName: string; sourceUrl: string }[],
  sources: { name: string; url: string }[],
): string {
  const parts: string[] = ["<p><strong>Content drafted by grove-content-drafter.</strong> Review and tick Facts reviewed + Guide approved to publish.</p>"];
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
