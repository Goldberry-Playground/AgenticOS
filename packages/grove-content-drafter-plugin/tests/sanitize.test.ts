import { describe, it, expect } from "vitest";
import { sanitizeDraftHtml } from "../src/sanitize.js";

describe("sanitizeDraftHtml", () => {
  it("keeps the allow-listed tags", () => {
    const html = "<p>Hi <strong>there</strong> <em>friend</em></p><h2>Care</h2><ul><li>one</li></ul>";
    expect(sanitizeDraftHtml(html)).toBe(html);
  });

  it("drops disallowed tags but keeps their text", () => {
    expect(sanitizeDraftHtml("<div><p>keep</p></div>")).toBe("<p>keep</p>");
    expect(sanitizeDraftHtml("<h1>Big</h1>")).toBe("Big");
    expect(sanitizeDraftHtml("<span style='x'>t</span>")).toBe("t");
  });

  it("strips all attributes except href on anchors", () => {
    expect(sanitizeDraftHtml('<p class="x" onclick="hack()">t</p>')).toBe("<p>t</p>");
    expect(sanitizeDraftHtml('<a href="https://ex.com" onclick="x">link</a>')).toBe('<a href="https://ex.com">link</a>');
  });

  it("rejects unsafe anchor schemes, keeping the text", () => {
    expect(sanitizeDraftHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeDraftHtml('<a href="/relative">x</a>')).toBe("<a>x</a>");
    expect(sanitizeDraftHtml('<a href="mailto:a@b.com">m</a>')).toBe('<a href="mailto:a@b.com">m</a>');
  });

  it("removes script/style blocks content-and-all", () => {
    expect(sanitizeDraftHtml("<p>ok</p><script>evil()</script>")).toBe("<p>ok</p>");
    expect(sanitizeDraftHtml("<style>.a{}</style><p>ok</p>")).toBe("<p>ok</p>");
  });

  it("removes nested/overlapping constructs that survive a single pass", () => {
    // A single global pass removes the inner `<!-- -->` and leaves the outer
    // fragments joined into a live `<!-- -->`; the fixed-point loop removes it.
    expect(sanitizeDraftHtml("<!-<!-- -->- -->keep")).toBe("keep");
    // No live <script tag should survive, even when nested.
    const nested = sanitizeDraftHtml("<p>ok</p><script><script>evil()</script></script>");
    expect(nested).toBe("<p>ok</p>");
    expect(nested.toLowerCase()).not.toContain("<script");
  });

  it("returns empty for empty input", () => {
    expect(sanitizeDraftHtml("")).toBe("");
  });
});
