/**
 * Enforce the grove-sites guide allow-list on agent-drafted HTML.
 *
 * Spec §C.4: the drafter may only emit `p, h2, h3, ul, ol, li, strong, em,
 * a[href]`. This mirrors `apps/nursery/lib/sanitize.ts` in grove-sites, but is a
 * *tighter* set — the storefront sanitizer (sanitize-html) re-sanitises on
 * render, so this is a formatting normaliser + first trust boundary, not the
 * only one. Any tag outside the list is dropped (its text content is kept); all
 * attributes are stripped except `href` on `<a>`, which must be http/https/mailto.
 * `<script>`/`<style>` blocks are removed content-and-all.
 */

const ALLOWED_TAGS = new Set(["p", "h2", "h3", "ul", "ol", "li", "strong", "em", "a"]);
const SAFE_SCHEME = /^(https?:|mailto:)/i;

/**
 * Apply a removal regex repeatedly until it reaches a fixed point. A single
 * pass over nested or overlapping constructs (e.g. `<scr<script>ipt>`) can
 * leave a residual match once the inner match is removed; iterating to a stable
 * string closes that gap (CodeQL js/incomplete-multi-character-sanitization).
 */
function stripToFixedPoint(input: string, pattern: RegExp): string {
  let out = input;
  let prev: string;
  do {
    prev = out;
    out = out.replace(pattern, "");
  } while (out !== prev);
  return out;
}

function safeHref(attrs: string): string | null {
  const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!m) return null;
  const raw = (m[2] ?? m[3] ?? "").trim();
  // Reject anything not clearly http(s)/mailto (blocks javascript:, data:, etc.).
  // Protocol-relative (//host) and relative URLs are dropped too — guide links
  // are external references and should be absolute.
  if (!SAFE_SCHEME.test(raw)) return null;
  return raw.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeDraftHtml(input: string): string {
  if (!input) return "";
  let html = input;
  // Strip script/style/comments entirely (tag + content). Iterate to a fixed
  // point so nested/overlapping constructs can't reconstruct a live match after
  // the first removal pass.
  html = stripToFixedPoint(html, /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi);
  html = stripToFixedPoint(html, /<!--[\s\S]*?-->/g);

  return html.replace(/<\/?([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (_full, rawName, attrs) => {
    const name = String(rawName).toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return ""; // drop the tag, keep surrounding text
    const isClose = _full.startsWith("</");
    if (isClose) return `</${name}>`;
    if (name === "a") {
      const href = safeHref(attrs);
      return href ? `<a href="${href}">` : "<a>";
    }
    return `<${name}>`; // strip all attributes on other allowed tags
  });
}
