/**
 * Turn a product's recorded facts into storefront content.
 *
 * Two pure halves, no network:
 *   - {@link buildSystemPrompt} / {@link buildUserPrompt} render the drafting
 *     brief that gets handed to the drafting agent (GOL-2424 Option A: the LLM
 *     call runs inside a Paperclip agent on the Claude subscription, not a
 *     metered Anthropic key).
 *   - {@link parseDraftResponse} validates + sanitises the agent's fenced JSON
 *     reply back into a {@link DraftResult}.
 *
 * The agent may fill *empty* required char facts, but only from
 * {@link FILLABLE_FACT_FIELDS} and only with a cited (http/https) extension-
 * service source — never typed/facet fields (zones, sun, layer) which come from
 * the USDA fetch step and human review.
 */
import { sanitizeDraftHtml } from "./sanitize.js";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

/** Empty required char facts the drafter may fill with a cited source. */
export const FILLABLE_FACT_FIELDS = [
  "grove_mature_size",
  "grove_mature_spread",
  "grove_spacing",
  "grove_soil",
  "grove_pollination",
  "grove_years_to_fruit",
  "grove_chill_hours",
] as const;
export type FillableField = (typeof FILLABLE_FACT_FIELDS)[number];

/** A field label map so the prompt reads naturally. */
const FIELD_LABELS: Record<string, string> = {
  grove_botanical_name: "Botanical name",
  grove_zone_min: "USDA zone min",
  grove_zone_max: "USDA zone max",
  grove_layer: "Food-forest layer",
  grove_sun: "Sun",
  grove_mature_size: "Mature height",
  grove_mature_spread: "Mature spread",
  grove_spacing: "Plant spacing",
  grove_soil: "Soil",
  grove_pollination: "Pollination",
  grove_years_to_fruit: "Years to fruit",
  grove_chill_hours: "Chill hours",
  grove_growth_rate: "Growth rate",
  grove_bloom_season: "Bloom season",
  grove_harvest_season: "Harvest season",
  grove_watering: "Watering",
  grove_wildlife: "Wildlife",
};

export interface ProductView {
  id: number;
  name: string;
  botanicalName: string;
  category: string;
  shippingTier: string;
  /** field name → human-readable current value ("" if empty). */
  facts: Record<string, string>;
  /** subset of FILLABLE_FACT_FIELDS that are currently empty. */
  emptyFillable: FillableField[];
}

export interface FilledFact {
  field: FillableField;
  value: string;
  sourceName: string;
  sourceUrl: string;
}

export interface DraftResult {
  descriptionEcommerce: string;
  websiteDescription: string;
  filledFacts: FilledFact[];
  sources: { name: string; url: string }[];
}

const ALLOWED_TAGS_HINT = "p, h2, h3, ul, ol, li, strong, em, a[href]";

export function buildSystemPrompt(houseRules: string): string {
  return [
    "You are the content writer for At The Grove Nursery, a syntropic agroforestry nursery.",
    "You write accurate, warm, plain storefront copy and practical care guides for edible/useful plants,",
    "grounded ONLY in the facts you are given plus reputable university extension-service references.",
    "",
    "Hard rules:",
    `- Output HTML limited to these tags only: ${ALLOWED_TAGS_HINT}. No other tags, no inline styles, no classes.`,
    "- Never invent facts. If a value is not provided and you cannot cite a reputable extension-service",
    "  source (e.g. a state university Extension), leave it out rather than guess.",
    "- Only fill the empty fields explicitly listed as fillable; cite a real http/https source URL for each.",
    "- Anchor links must be http/https/mailto only.",
    "- Respond with a single JSON object and nothing else (no markdown fences, no commentary).",
    houseRules ? `\nHouse rules (authoritative — follow exactly):\n${houseRules}` : "",
  ].join("\n");
}

export function buildUserPrompt(p: ProductView): string {
  const factLines = Object.entries(p.facts)
    .map(([k, v]) => `- ${FIELD_LABELS[k] ?? k} (${k}): ${v || "(empty)"}`)
    .join("\n");
  const fillable = p.emptyFillable.length
    ? p.emptyFillable.map((f) => `- ${FIELD_LABELS[f]} (${f})`).join("\n")
    : "(none — do not fill any facts)";
  return [
    `Product: ${p.name}`,
    `Botanical name: ${p.botanicalName}`,
    `Category: ${p.category}`,
    `Shipping: ${p.shippingTier}`,
    "",
    "Known facts:",
    factLines,
    "",
    "Empty required facts you MAY fill (only these, each with a cited extension-service source):",
    fillable,
    "",
    // GOL-2544: the care guide must speak to the grower's spacing/timeline
    // decisions, so call out the size/pollination/timeline facts explicitly.
    "When these are known, the care guide must state them plainly: mature height and spread (for spacing),",
    "pollination requirements (self-fertile vs. needs a pollinator partner), and years to fruit/harvest.",
    "",
    "Return JSON with exactly these keys:",
    "{",
    '  "description_ecommerce_html": "2-3 short storefront paragraphs, <p> tags",',
    '  "website_description_html": "care guide with <h2>/<h3> sections: Site & soil, Planting, First-year care, Pruning, Harvest",',
    '  "filled_facts": [{"field": "<odoo field name>", "value": "<value>", "source_name": "<e.g. NC State Extension>", "source_url": "https://..."}],',
    '  "sources": [{"name": "<source>", "url": "https://..."}]',
    "}",
    "If you fill no facts, use an empty filled_facts array. sources must list every reference you used.",
  ].join("\n");
}

function stripFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1]!.trim();
  // Fall back to the first {...} block if the model added prose around it.
  const brace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (brace >= 0 && lastBrace > brace) return t.slice(brace, lastBrace + 1);
  return t;
}

const SAFE_URL = /^https?:\/\//i;
const FILLABLE_SET: ReadonlySet<string> = new Set(FILLABLE_FACT_FIELDS);

/**
 * Validate + sanitise a drafting agent's raw JSON reply into a {@link DraftResult}.
 *
 * `emptyFillable` is the set of fields the request said were fillable; a fill for
 * any other field (or a fill without a real http(s) source) is silently dropped.
 * Returns an error result (never throws) when the JSON is missing/invalid or the
 * required description/care-guide came back empty — the caller surfaces the exact
 * error back to the agent and never writes partial content.
 */
export function parseDraftResponse(raw: string, emptyFillable: FillableField[]): Result<DraftResult> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFences(raw)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "reply did not contain valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "reply JSON was not an object" };
  }

  const descriptionEcommerce = sanitizeDraftHtml(String(parsed.description_ecommerce_html ?? ""));
  const websiteDescription = sanitizeDraftHtml(String(parsed.website_description_html ?? ""));
  if (!descriptionEcommerce.trim() || !websiteDescription.trim()) {
    return { ok: false, error: "reply was missing description_ecommerce_html or website_description_html" };
  }

  // Only accept fills for empty, whitelisted fields with a real http(s) source.
  const emptySet = new Set<string>(emptyFillable);
  const filledFacts: FilledFact[] = [];
  const rawFacts = Array.isArray(parsed.filled_facts) ? parsed.filled_facts : [];
  for (const item of rawFacts) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const field = String(f.field ?? "");
    const value = String(f.value ?? "").trim();
    const sourceUrl = String(f.source_url ?? "").trim();
    const sourceName = String(f.source_name ?? "").trim();
    if (!FILLABLE_SET.has(field) || !emptySet.has(field)) continue;
    if (!value || !SAFE_URL.test(sourceUrl)) continue;
    filledFacts.push({ field: field as FillableField, value, sourceName: sourceName || sourceUrl, sourceUrl });
  }

  const sources: { name: string; url: string }[] = [];
  const rawSources = Array.isArray(parsed.sources) ? parsed.sources : [];
  for (const item of rawSources) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const url = String(s.url ?? "").trim();
    if (!SAFE_URL.test(url)) continue;
    sources.push({ name: String(s.name ?? url).trim() || url, url });
  }

  return { ok: true, data: { descriptionEcommerce, websiteDescription, filledFacts, sources } };
}
