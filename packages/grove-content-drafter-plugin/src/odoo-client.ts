/**
 * Odoo XML-RPC client scoped to what the content-drafter routine needs:
 * authenticate as the Content Drafter user, search/read product templates whose
 * draft was requested, and write the drafted content + a chatter note back.
 *
 * The client is deliberately thin: every method returns a {@link Result} so the
 * job can decide whether to leave the product in `requested` (and post the error
 * to chatter) or advance it to `drafted`. It never logs credentials.
 */
import {
  buildMethodCall,
  parseMethodResponse,
  XmlRpcFault,
  type XmlRpcValue,
} from "./xmlrpc.js";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export interface OdooClientConfig {
  baseUrl: string;
  db: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

/** A raw product.template record as read over XML-RPC (Odoo field → value). */
export type OdooRecord = Record<string, XmlRpcValue>;

export class OdooClient {
  private readonly baseUrl: string;
  private readonly db: string;
  private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private uid: number | null = null;

  constructor(config: OdooClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.db = config.db;
    this.username = config.username;
    this.password = config.password;
    this.timeoutMs = config.timeoutMs ?? 20000;
  }

  private async call(endpoint: string, method: string, params: XmlRpcValue[]): Promise<Result<XmlRpcValue>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "text/xml" },
        body: buildMethodCall(method, params),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} from ${endpoint}` };
      return { ok: true, data: parseMethodResponse(text) };
    } catch (err) {
      if (err instanceof XmlRpcFault) return { ok: false, error: err.message };
      return { ok: false, error: err instanceof Error ? err.message : "odoo unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resolve and cache the uid for the configured Content Drafter user. */
  async authenticate(): Promise<Result<number>> {
    if (this.uid !== null) return { ok: true, data: this.uid };
    const res = await this.call("/xmlrpc/2/common", "authenticate", [
      this.db,
      this.username,
      this.password,
      {},
    ]);
    if (!res.ok) return res;
    const uid = res.data;
    if (typeof uid !== "number" || uid === 0) {
      return { ok: false, error: "authentication failed (check the Content Drafter credentials)" };
    }
    this.uid = uid;
    return { ok: true, data: uid };
  }

  /** `execute_kw(model, method, args, kwargs)` as the authenticated user. */
  async execute<T = XmlRpcValue>(
    model: string,
    method: string,
    args: XmlRpcValue[],
    kwargs: Record<string, XmlRpcValue> = {},
  ): Promise<Result<T>> {
    const auth = await this.authenticate();
    if (!auth.ok) return auth;
    const res = await this.call("/xmlrpc/2/object", "execute_kw", [
      this.db,
      auth.data,
      this.password,
      model,
      method,
      args,
      kwargs,
    ]);
    if (!res.ok) return res;
    return { ok: true, data: res.data as T };
  }

  /** IDs of product templates whose content draft was requested (oldest first). */
  async searchRequested(limit = 1): Promise<Result<number[]>> {
    const res = await this.execute<XmlRpcValue[]>(
      "product.template",
      "search",
      [[["grove_draft_state", "=", "requested"]]],
      { limit, order: "write_date asc" },
    );
    if (!res.ok) return res;
    return { ok: true, data: (res.data as number[]) ?? [] };
  }

  /** Read a fixed field set for one product template. */
  async read(id: number, fields: string[]): Promise<Result<OdooRecord>> {
    const res = await this.execute<XmlRpcValue[]>("product.template", "read", [[id], fields]);
    if (!res.ok) return res;
    const rows = res.data as OdooRecord[];
    if (!rows || rows.length === 0) return { ok: false, error: `product ${id} not found` };
    return { ok: true, data: rows[0]! };
  }

  async write(id: number, vals: Record<string, XmlRpcValue>): Promise<Result<boolean>> {
    const res = await this.execute<boolean>("product.template", "write", [[id], vals]);
    if (!res.ok) return res;
    return { ok: true, data: Boolean(res.data) };
  }

  /** Post an internal note (mail.mt_note) to the product chatter. */
  async postNote(id: number, bodyHtml: string): Promise<Result<number>> {
    const res = await this.execute<number>(
      "product.template",
      "message_post",
      [[id]],
      { body: bodyHtml, message_type: "comment", subtype_xmlid: "mail.mt_note" },
    );
    if (!res.ok) return res;
    return { ok: true, data: Number(res.data) };
  }
}
