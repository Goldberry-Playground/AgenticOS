/**
 * Minimal Anthropic Messages client (fetch only, no SDK) implementing
 * {@link LlmClient}. Kept dependency-free so the plugin worker bundle stays lean
 * and sandbox-friendly (http.outbound). Never logs the API key.
 */
import type { LlmClient, Result } from "./drafter.js";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  baseUrl?: string;
}

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
}

export class AnthropicClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 4096;
    this.timeoutMs = config.timeoutMs ?? 60000;
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  async complete(system: string, user: string): Promise<Result<string>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      const json = (await res.json()) as AnthropicMessageResponse;
      if (!res.ok) {
        return { ok: false, error: json.error?.message ?? `Anthropic HTTP ${res.status}` };
      }
      const text = (json.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("")
        .trim();
      if (!text) return { ok: false, error: "Anthropic returned no text content" };
      return { ok: true, data: text };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Anthropic unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
}
