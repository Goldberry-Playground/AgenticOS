/**
 * gh-token-broker client — mints short-lived, repo-scoped GitHub App installation
 * tokens so the plugin never holds a static PAT and can write to ANY repo the
 * "AgenticOS Developer" App is installed on, across multiple orgs.
 *
 * The broker (scripts/agent-git/github-app-token.mjs, compose service
 * `gh-token-broker`) exposes:
 *   GET {brokerUrl}/token?owner=<owner>&repo=<repo>
 *     -> { "token": "<installation-token>", "expires_at": "<ISO-8601>" }
 *
 * Installation tokens live ~1h, but the broker keeps its OWN disk cache and will
 * serve a token with as little as 5 min of life left. So a naive flat 50-min
 * client cache can hold a token PAST its real expiry, and every write with it
 * gets GitHub's 401 "Bad credentials" (GOL-799: stranded `agent-review/*`
 * sign-off checks). We therefore cache until the token's real `expires_at`
 * (minus a safety skew), capped at `ttlMs` — never past the moment GitHub stops
 * honouring it. Older brokers that omit `expires_at` fall back to the flat TTL.
 */

/**
 * Resolves a repo-scoped token, cached until near expiry. The optional
 * `invalidate` evicts a cached token so the NEXT call re-mints from the broker —
 * GitHubClient calls it when a request comes back 401, because an installation
 * token can be revoked (App suspended, key rotated, permissions changed) BEFORE
 * its cached `expires_at`, and a stacked cache would otherwise keep serving the
 * dead token for the rest of its TTL (GOL-1425). Static providers omit it.
 */
export interface TokenProvider {
  (repo: string): Promise<string>;
  invalidate?(repo: string): void;
}

/**
 * Refresh a cached token this many ms BEFORE its GitHub `expires_at`, to absorb
 * clock skew between this container and GitHub plus the request's own latency.
 */
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

export interface BrokerOptions {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Cache lifetime per token. Default 50 min (tokens expire at ~60). */
  ttlMs?: number;
  /** Per-request timeout. Default 5s. */
  timeoutMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /**
   * Bearer presented to the broker (M3, PR #356). The broker REFUSES every
   * request without a matching `Authorization: Bearer` — an unauthenticated
   * mint returns HTTP 401 `{"error":"unauthorized"}`, which the pipeline
   * surfaces as "failed to fetch PR changed files". Plugin workers are
   * sandboxed away from host process.env, so this MUST arrive via ctx.config
   * (GithubSyncConfig.tokenBrokerApiKey), not the GH_BROKER_API_KEY env var.
   */
  apiKey?: string;
}

/**
 * Build a per-repo token provider for a single `owner`. Each call resolves a
 * repo-scoped installation token, cached until near expiry. Throws if the broker
 * is unreachable or returns no token — callers handle the failed Result downstream.
 */
export function makeBrokerTokenProvider(
  brokerUrl: string,
  owner: string,
  opts: BrokerOptions = {},
): TokenProvider {
  const ttlMs = opts.ttlMs ?? 50 * 60 * 1000;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const now = opts.now ?? (() => Date.now());
  const doFetch = opts.fetchImpl ?? fetch;
  const apiKey = (opts.apiKey ?? "").trim();
  const base = brokerUrl.replace(/\/$/, "");
  const cache = new Map<string, { token: string; expiresAt: number }>();

  const provider: TokenProvider = async (repo: string): Promise<string> => {
    const key = `${owner}/${repo}`.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.token;

    const url = new URL(`${base}/token`);
    url.searchParams.set("owner", owner);
    url.searchParams.set("repo", repo);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url.toString(), {
        signal: controller.signal,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) throw new Error(`token broker -> ${res.status}`);
      const body = (await res.json()) as { token?: string; expires_at?: string };
      if (!body.token) throw new Error("token broker returned no token");
      // Never cache past the token's real GitHub expiry (minus skew): the broker
      // may hand back a token with only minutes of life left (GOL-799). Cap at
      // ttlMs so a long-lived token still gets periodically refreshed. Brokers
      // that omit `expires_at` (pre-GOL-799) fall back to the flat TTL.
      const ttlExpiry = now() + ttlMs;
      const realExpiry = body.expires_at
        ? Date.parse(body.expires_at) - EXPIRY_SKEW_MS
        : NaN;
      const expiresAt = Number.isFinite(realExpiry)
        ? Math.min(ttlExpiry, realExpiry)
        : ttlExpiry;
      // A token already inside the skew window is still returned to this caller,
      // but not cached — the next call re-mints rather than serving a near-dead one.
      if (expiresAt > now()) cache.set(key, { token: body.token, expiresAt });
      return body.token;
    } finally {
      clearTimeout(timer);
    }
  };

  // Evict a repo's cached token after a 401 so the next mint re-fetches from the
  // broker instead of re-serving a token GitHub has already rejected (GOL-1425).
  provider.invalidate = (repo: string): void => {
    cache.delete(`${owner}/${repo}`.toLowerCase());
  };

  return provider;
}

/** Wrap a static token as a TokenProvider (fallback when no broker is configured). */
export function staticTokenProvider(token: string): TokenProvider {
  return async () => token;
}
