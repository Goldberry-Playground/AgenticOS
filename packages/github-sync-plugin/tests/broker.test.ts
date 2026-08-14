import { describe, it, expect, vi } from "vitest";
import { makeBrokerTokenProvider, staticTokenProvider } from "../src/broker.js";

function brokerFetch(token: string, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => ({ token }) });
}

function brokerFetchExpiring(token: string, expiresAtMs: number) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ token, expires_at: new Date(expiresAtMs).toISOString() }),
  });
}

describe("makeBrokerTokenProvider", () => {
  it("requests a repo-scoped token with owner+repo query params", async () => {
    const fetchMock = brokerFetch("ghs_abc");
    const getToken = makeBrokerTokenProvider("http://gh-token-broker:9099", "Goldberry-Playground", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const token = await getToken("odoocker-goldberrygrove");
    expect(token).toBe("ghs_abc");

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/token");
    expect(url.searchParams.get("owner")).toBe("Goldberry-Playground");
    expect(url.searchParams.get("repo")).toBe("odoocker-goldberrygrove");
  });

  it("caches per repo until the TTL elapses, then refetches", async () => {
    const fetchMock = brokerFetch("tok1");
    let clock = 1_000;
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      ttlMs: 1000,
      now: () => clock,
    });

    await getToken("repo");
    await getToken("repo"); // cached — no second fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += 1001; // past TTL
    await getToken("repo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes before the token's real expires_at, not the flat TTL (GOL-799)", async () => {
    let clock = 1_000_000;
    // Broker hands back a token with only 6 min of life left (its disk cache
    // serves anything with >5 min). The flat 50-min client TTL would hold it
    // ~44 min past expiry → GitHub 401 "Bad credentials".
    const fetchMock = brokerFetchExpiring("near-dead", clock + 6 * 60 * 1000);
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      ttlMs: 50 * 60 * 1000,
      now: () => clock,
    });

    await getToken("repo");
    await getToken("repo"); // still comfortably before expiry — cached
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 5 min later we are inside the 2-min skew of the 6-min expiry → re-mint.
    clock += 5 * 60 * 1000;
    await getToken("repo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the flat TTL when the broker omits expires_at (pre-GOL-799)", async () => {
    let clock = 1_000;
    const fetchMock = brokerFetch("legacy"); // no expires_at field
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      ttlMs: 1000,
      now: () => clock,
    });
    await getToken("repo");
    clock += 500;
    await getToken("repo"); // within flat TTL — cached
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock += 600; // past flat TTL
    await getToken("repo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps separate cache entries per repo", async () => {
    const fetchMock = brokerFetch("t");
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await getToken("repo-a");
    await getToken("repo-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends an Authorization: Bearer header when an apiKey is supplied (M3/GOL-666)", async () => {
    const fetchMock = brokerFetch("ghs_abc");
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiKey: "broker-secret",
    });
    await getToken("repo");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer broker-secret");
  });

  it("omits the Authorization header when no apiKey is set", async () => {
    const fetchMock = brokerFetch("ghs_abc");
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await getToken("repo");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("throws on a non-OK broker response (no token leaked in the message)", async () => {
    const fetchMock = brokerFetch("", false, 404);
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(getToken("repo")).rejects.toThrow("token broker -> 404");
  });

  it("throws when the broker returns no token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(getToken("repo")).rejects.toThrow("returned no token");
  });

  it("invalidate() evicts the cached token so the next call re-mints (GOL-1425)", async () => {
    const fetchMock = brokerFetch("tok1");
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await getToken("repo");
    await getToken("repo"); // cached — no second fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);

    getToken.invalidate?.("repo"); // the token got revoked before its cached expiry
    await getToken("repo"); // must re-mint from the broker, not serve the dead token
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidate() only evicts the named repo, keeping other entries cached", async () => {
    const fetchMock = brokerFetch("t");
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await getToken("repo-a");
    await getToken("repo-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    getToken.invalidate?.("repo-a");
    await getToken("repo-a"); // re-mints
    await getToken("repo-b"); // still cached
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("staticTokenProvider", () => {
  it("returns the same token for any repo", async () => {
    const getToken = staticTokenProvider("pat_123");
    expect(await getToken("a")).toBe("pat_123");
    expect(await getToken("b")).toBe("pat_123");
  });
});
