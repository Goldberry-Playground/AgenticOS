/**
 * Minimal XML-RPC codec for talking to Odoo's `/xmlrpc/2/*` endpoints.
 *
 * Odoo's external API is XML-RPC (see the QA connection runbook). Plugin workers
 * are sandboxed to `fetch` (http.outbound) with no npm deps beyond the SDK, so
 * rather than pull an XML-RPC library we serialise/parse the small value subset
 * Odoo actually exchanges: string, int/i4, boolean, double, array, struct, nil,
 * and dateTime/base64 (decoded as strings). This module is pure — no I/O — so it
 * is exhaustively unit-tested against canonical Odoo response shapes.
 */

export type XmlRpcValue =
  | string
  | number
  | boolean
  | null
  | XmlRpcValue[]
  | { [key: string]: XmlRpcValue };

export class XmlRpcFault extends Error {
  constructor(
    readonly faultCode: number,
    readonly faultString: string,
  ) {
    super(`XML-RPC fault ${faultCode}: ${faultString}`);
    this.name = "XmlRpcFault";
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Serialise a single JS value to an XML-RPC `<value>...</value>` element. */
export function serializeValue(v: XmlRpcValue): string {
  if (v === null || v === undefined) return "<value><nil/></value>";
  if (typeof v === "boolean") return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? `<value><int>${v}</int></value>`
      : `<value><double>${v}</double></value>`;
  }
  if (typeof v === "string") return `<value><string>${escapeXml(v)}</string></value>`;
  if (Array.isArray(v)) {
    return `<value><array><data>${v.map(serializeValue).join("")}</data></array></value>`;
  }
  // struct
  const members = Object.entries(v)
    .map(([k, val]) => `<member><name>${escapeXml(k)}</name>${serializeValue(val)}</member>`)
    .join("");
  return `<value><struct>${members}</struct></value>`;
}

/** Build a full `<methodCall>` document. */
export function buildMethodCall(method: string, params: XmlRpcValue[]): string {
  const paramXml = params.map((p) => `<param>${serializeValue(p)}</param>`).join("");
  return (
    `<?xml version="1.0"?>` +
    `<methodCall><methodName>${escapeXml(method)}</methodName>` +
    `<params>${paramXml}</params></methodCall>`
  );
}

// ── Parsing ────────────────────────────────────────────────────────────────
// A tiny recursive-descent reader over the response string. We deliberately do
// not build a general DOM; we only read the tags Odoo emits, skipping insignificant
// whitespace between them.

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

class Reader {
  private i = 0;
  constructor(private readonly s: string) {}

  private skipWs(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }

  /** True if the next non-whitespace token is exactly the given open/close tag. */
  peekTag(tag: string): boolean {
    this.skipWs();
    return this.s.startsWith(`<${tag}>`, this.i) || this.s.startsWith(`<${tag}/>`, this.i);
  }

  /** Consume `<tag>` (or the self-closing `<tag/>`, returning true if self-closed). */
  expectOpen(tag: string): boolean {
    this.skipWs();
    if (this.s.startsWith(`<${tag}/>`, this.i)) {
      this.i += tag.length + 3;
      return true;
    }
    if (!this.s.startsWith(`<${tag}>`, this.i)) {
      throw new Error(`XML-RPC parse: expected <${tag}> at ${this.i}: ${this.s.slice(this.i, this.i + 40)}`);
    }
    this.i += tag.length + 2;
    return false;
  }

  expectClose(tag: string): void {
    this.skipWs();
    if (!this.s.startsWith(`</${tag}>`, this.i)) {
      throw new Error(`XML-RPC parse: expected </${tag}> at ${this.i}: ${this.s.slice(this.i, this.i + 40)}`);
    }
    this.i += tag.length + 3;
  }

  /** Read raw character data up to the next `<`. */
  readText(): string {
    const start = this.i;
    while (this.i < this.s.length && this.s[this.i] !== "<") this.i++;
    return unescapeXml(this.s.slice(start, this.i));
  }

  readValue(): XmlRpcValue {
    this.expectOpen("value");
    this.skipWs();
    let out: XmlRpcValue;
    // A bare <value>text</value> with no type tag is a string (XML-RPC spec).
    if (this.s[this.i] !== "<") {
      out = this.readText();
      this.expectClose("value");
      return out;
    }
    const typed = (tag: string, fn: () => XmlRpcValue): boolean => {
      if (this.peekTag(tag)) {
        const selfClosed = this.expectOpen(tag);
        out = selfClosed ? fn() : (() => { const r = fn(); this.expectClose(tag); return r; })();
        return true;
      }
      return false;
    };
    if (
      typed("nil", () => null) ||
      typed("boolean", () => this.readText() === "1") ||
      typed("int", () => Number(this.readText())) ||
      typed("i4", () => Number(this.readText())) ||
      typed("double", () => Number(this.readText())) ||
      typed("string", () => this.readText()) ||
      typed("dateTime.iso8601", () => this.readText()) ||
      typed("base64", () => this.readText()) ||
      typed("array", () => this.readArray()) ||
      typed("struct", () => this.readStruct())
    ) {
      this.expectClose("value");
      return out!;
    }
    throw new Error(`XML-RPC parse: unknown value type at ${this.i}: ${this.s.slice(this.i, this.i + 40)}`);
  }

  private readArray(): XmlRpcValue[] {
    this.expectOpen("data");
    const items: XmlRpcValue[] = [];
    while (this.peekTag("value")) items.push(this.readValue());
    this.expectClose("data");
    return items;
  }

  private readStruct(): { [k: string]: XmlRpcValue } {
    const obj: { [k: string]: XmlRpcValue } = {};
    while (this.peekTag("member")) {
      this.expectOpen("member");
      this.expectOpen("name");
      const name = this.readText();
      this.expectClose("name");
      obj[name] = this.readValue();
      this.expectClose("member");
    }
    return obj;
  }
}

/**
 * Parse an XML-RPC `<methodResponse>`. Returns the single response value, or
 * throws {@link XmlRpcFault} for a `<fault>` (e.g. an Odoo AccessError).
 */
export function parseMethodResponse(xml: string): XmlRpcValue {
  const reader = new Reader(xml.replace(/<\?xml[^>]*\?>/, ""));
  reader.expectOpen("methodResponse");
  if (reader.peekTag("fault")) {
    reader.expectOpen("fault");
    const fault = reader.readValue();
    if (fault && typeof fault === "object" && !Array.isArray(fault)) {
      const code = Number(fault.faultCode ?? 0);
      const str = String(fault.faultString ?? "unknown fault");
      throw new XmlRpcFault(code, str);
    }
    throw new XmlRpcFault(0, "malformed fault");
  }
  reader.expectOpen("params");
  reader.expectOpen("param");
  const value = reader.readValue();
  return value;
}
