import { describe, it, expect, vi, afterEach } from "vitest";
import { GitHubClient } from "../src/github-client.js";

function mockFetch(body: unknown, ok = true, status = 200) {
  // `request()` reads `res.text()` then JSON.parses it (so a non-JSON error body
  // never drops the status — GOL-802). A string `body` is passed through verbatim
  // to exercise the non-JSON path; anything else is serialized.
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => text,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("GitHubClient.createIssue", () => {
  it("POSTs to the repo issues endpoint with auth + body and parses the result", async () => {
    const fetchMock = mockFetch({
      number: 42,
      title: "Hello",
      body: "World",
      state: "open",
      html_url: "https://github.com/o/r/issues/42",
      labels: [{ name: "synced-from-paperclip" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.createIssue("r", {
      title: "Hello",
      body: "World",
      labels: ["synced-from-paperclip"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ number: 42, state: "open", labels: ["synced-from-paperclip"] });
    }

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Hello",
      body: "World",
      labels: ["synced-from-paperclip"],
    });
  });

  it("returns an error Result on HTTP failure", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Bad creds" }, false, 401));
    const client = new GitHubClient({ token: "bad", org: "o", timeoutMs: 5000 });
    const result = await client.createIssue("r", { title: "x", body: "y" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Bad creds");
  });

  it("keeps the status and a non-empty error on a bodyless / non-JSON error response (GOL-802)", async () => {
    // A broker/edge 401 (or an HTML 5xx) with no JSON body used to make res.json()
    // throw, dropping the status and surfacing an EMPTY `error` at the call site.
    // Reading text-first preserves the status and yields a non-empty error.
    vi.stubGlobal("fetch", mockFetch("", false, 401)); // empty string body
    const client = new GitHubClient({ token: "bad", org: "o", timeoutMs: 5000 });
    const result = await client.createCheckRun("r", {
      name: "agent-review/ada",
      headSha: "sha1",
      conclusion: "success",
      title: "t",
      summary: "s",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe("HTTP 401");
    }
  });

  it("includes a raw-body snippet when a non-JSON error body is present (GOL-802)", async () => {
    vi.stubGlobal("fetch", mockFetch("<html>502 Bad Gateway</html>", false, 502));
    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.createCheckRun("r", {
      name: "agent-review/ada",
      headSha: "sha1",
      conclusion: "success",
      title: "t",
      summary: "s",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toContain("HTTP 502");
      expect(result.error).toContain("502 Bad Gateway");
    }
  });

  it("surfaces status + GitHub errors[] and folds them into the message on a 422 (GOL-793)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          message: "Validation Failed",
          errors: [
            { resource: "Issue", field: "state", code: "invalid" },
          ],
        },
        false,
        422,
      ),
    );
    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.updateIssue("r", 210, { state: "open", title: "T" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.errors).toEqual([
        { resource: "Issue", field: "state", code: "invalid" },
      ]);
      // errors[] detail is folded into the human-readable string so log lines
      // that only carry `error` still reveal the failing field.
      expect(result.error).toBe("Validation Failed (Issue.state.invalid)");
    }
  });
});

describe("GitHubClient.updateIssue", () => {
  it("PATCHes only the provided fields", async () => {
    const fetchMock = mockFetch({
      number: 7,
      title: "T",
      body: "B",
      state: "closed",
      html_url: "https://github.com/o/r/issues/7",
      labels: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.updateIssue("r", 7, { state: "closed", title: "T" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.state).toBe("closed");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues/7");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ state: "closed", title: "T" });
  });
});

describe("GitHubClient with a getToken provider (broker mode)", () => {
  it("resolves a per-repo token and sends it as the bearer", async () => {
    const fetchMock = mockFetch({
      number: 1,
      title: "T",
      body: "B",
      state: "open",
      html_url: "https://github.com/o/r/issues/1",
      labels: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const getToken = vi.fn(async (repo: string) => `tok-for-${repo}`);
    const client = new GitHubClient({ org: "o", getToken });
    await client.createIssue("r", { title: "T", body: "B" });

    expect(getToken).toHaveBeenCalledWith("r");
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-for-r");
  });

  it("returns an error Result if the token provider throws", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = new GitHubClient({
      org: "o",
      getToken: async () => {
        throw new Error("token broker -> 404");
      },
    });
    const result = await client.getIssue("r", 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("token broker -> 404");
  });
});

describe("GitHubClient.listPullFiles", () => {
  it("returns filenames from a single page (not truncated)", async () => {
    const fetchMock = mockFetch([{ filename: "a.ts" }, { filename: "apps/dashboard/x.tsx" }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "t", org: "o" });
    const res = await client.listPullFiles("r", 12);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.files).toEqual(["a.ts", "apps/dashboard/x.tsx"]);
      expect(res.data.truncated).toBe(false);
    }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/o/r/pulls/12/files?per_page=100&page=1");
    // A short page stops pagination — exactly one request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates an API error Result", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Not Found" }, false, 404));
    const client = new GitHubClient({ token: "t", org: "o" });
    const res = await client.listPullFiles("r", 12);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Not Found");
  });
});

describe("GitHubClient.createCheckRun", () => {
  it("POSTs a pending (in_progress) run when no conclusion is given", async () => {
    const fetchMock = mockFetch({ id: 999 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "t", org: "o" });
    const res = await client.createCheckRun("r", {
      name: "agent-review/ada",
      headSha: "sha1",
      title: "pending",
      summary: "waiting",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(999);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/check-runs");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ name: "agent-review/ada", head_sha: "sha1", status: "in_progress" });
    expect(body.conclusion).toBeUndefined();
  });

  it("POSTs a completed run with the conclusion when given", async () => {
    const fetchMock = mockFetch({ id: 1 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "t", org: "o" });
    await client.createCheckRun("r", { name: "agent-review/iris", headSha: "s", conclusion: "failure", title: "x", summary: "y" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.status).toBe("completed");
    expect(body.conclusion).toBe("failure");
    expect(typeof body.completed_at).toBe("string");
  });
});

describe("GitHubClient.createIssueComment", () => {
  it("POSTs the comment body to the issues comments endpoint", async () => {
    const fetchMock = mockFetch({ id: 5 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "t", org: "o" });
    const res = await client.createIssueComment("r", 260, "changes requested: ...");
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues/260/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ body: "changes requested: ..." });
  });
});

describe("GitHubClient.getIssue", () => {
  it("GETs the issue by number", async () => {
    const fetchMock = mockFetch({
      number: 5,
      title: "G",
      body: "",
      state: "open",
      html_url: "https://github.com/o/r/issues/5",
      labels: ["a", { name: "b" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.getIssue("r", 5);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.labels).toEqual(["a", "b"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues/5");
    expect(init.method).toBe("GET");
  });
});

describe("GitHubClient.getPull (GOL-305)", () => {
  it("parses author login, head SHA, state and merged flag", async () => {
    const fetchMock = mockFetch({
      number: 42,
      title: "Fix worker",
      user: { login: "agenticos-developer[bot]" },
      head: { sha: "abc1234" },
      html_url: "https://github.com/o/r/pull/42",
      state: "open",
      draft: false,
      merged: false,
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.getPull("r", 42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        number: 42,
        title: "Fix worker",
        authorLogin: "agenticos-developer[bot]",
        headSha: "abc1234",
        htmlUrl: "https://github.com/o/r/pull/42",
        state: "open",
        draft: false,
        merged: false,
      });
    }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/o/r/pulls/42");
  });
});

describe("GitHubClient.listCommitCheckRuns (GOL-305)", () => {
  it("maps check_runs to name/status/conclusion + an output excerpt + details_url", async () => {
    const fetchMock = mockFetch({
      total_count: 2,
      check_runs: [
        { name: "build", status: "completed", conclusion: "failure", details_url: "https://x/logs", output: { summary: "boom" } },
        { name: "lint", status: "completed", conclusion: "success", output: { title: "ok" } },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.listCommitCheckRuns("r", "deadbeef");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        { name: "build", status: "completed", conclusion: "failure", detailsUrl: "https://x/logs", summary: "boom" },
        { name: "lint", status: "completed", conclusion: "success", summary: "ok" },
      ]);
    }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/o/r/commits/deadbeef/check-runs?per_page=100");
  });

  it("tolerates a missing check_runs array", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.listCommitCheckRuns("r", "sha");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });
});

describe("GitHubClient.getCommit", () => {
  it("returns parent SHAs in order and the committer login", async () => {
    const fetchMock = mockFetch({
      sha: "mergesha",
      parents: [{ sha: "beforesha" }, { sha: "basesha" }],
      committer: { login: "web-flow" },
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.getCommit("r", "mergesha");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        sha: "mergesha",
        parents: ["beforesha", "basesha"],
        committerLogin: "web-flow",
      });
    }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/o/r/commits/mergesha");
  });

  it("tolerates a missing committer and absent parents", async () => {
    vi.stubGlobal("fetch", mockFetch({ sha: "s" }));
    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.getCommit("r", "s");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ sha: "s", parents: [], committerLogin: "" });
  });

  it("propagates a request failure", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Not Found" }, false, 404));
    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.getCommit("r", "nope");
    expect(result.ok).toBe(false);
  });
});

describe("GitHubClient.listIssues", () => {
  it("filters out pull requests and passes state/since/sort query params (GOL-1206)", async () => {
    // GitHub's /issues endpoint returns PRs as issues (they carry `pull_request`);
    // the sweep must never treat a PR close as an issue mirror close.
    const fetchMock = mockFetch([
      { number: 10, title: "real issue", state: "closed", html_url: "u", labels: [] },
      { number: 11, title: "a PR", state: "closed", html_url: "u", labels: [], pull_request: { url: "p" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.listIssues("r", { state: "all", since: "2026-08-01T00:00:00Z", maxPages: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.truncated).toBe(false);
      expect(result.data.issues.map((i) => i.number)).toEqual([10]); // PR #11 dropped
    }
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/repos/o/r/issues");
    expect(url.searchParams.get("state")).toBe("all");
    expect(url.searchParams.get("since")).toBe("2026-08-01T00:00:00Z");
    expect(url.searchParams.get("sort")).toBe("updated");
    expect(url.searchParams.get("direction")).toBe("desc");
  });

  it("reports truncated=true when every page is full up to the cap", async () => {
    // A full page (100 items) forces another fetch; capping at maxPages=1 with a
    // full page means the scan was cut short.
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: "x",
      state: "closed",
      html_url: "u",
      labels: [],
    }));
    vi.stubGlobal("fetch", mockFetch(fullPage));
    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.listIssues("r", { state: "closed", maxPages: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.issues).toHaveLength(100);
      expect(result.data.truncated).toBe(true);
    }
  });

  it("propagates a list failure (transient auth/network)", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Bad credentials" }, false, 401));
    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.listIssues("r", { state: "all" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Bad credentials");
  });
});

describe("GitHubClient cache-invalidation on 401 (GOL-1425)", () => {
  // A re-mintable provider (has `invalidate`) that hands out a fresh token string
  // each call, so we can assert the retry used a different (re-minted) token.
  function reMintableProvider() {
    let n = 0;
    const p = vi.fn(async () => `tok-${++n}`) as unknown as {
      (repo: string): Promise<string>;
      invalidate: (repo: string) => void;
    };
    p.invalidate = vi.fn();
    return p;
  }

  // Sequential fetch: yields queued responses in order (one per attempt).
  function seqFetch(...responses: Array<{ body: unknown; ok: boolean; status: number }>) {
    let i = 0;
    return vi.fn().mockImplementation(async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      return { ok: r.ok, status: r.status, json: async () => r.body, text: async () => text };
    });
  }

  it("evicts the token and retries once with a freshly minted token on 401", async () => {
    const fetchMock = seqFetch(
      { body: { message: "Bad credentials" }, ok: false, status: 401 },
      { body: { number: 7, title: "t", body: "b", state: "open", html_url: "u", labels: [] }, ok: true, status: 200 },
    );
    vi.stubGlobal("fetch", fetchMock);
    const getToken = reMintableProvider();
    const client = new GitHubClient({ getToken, org: "o", timeoutMs: 5000 });

    const result = await client.createIssue("r", { title: "t", body: "b" });

    expect(result.ok).toBe(true);
    expect(getToken.invalidate).toHaveBeenCalledWith("r");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First attempt used tok-1, the retry a freshly minted tok-2.
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>).Authorization).toBe("Bearer tok-2");
  });

  it("gives up after one retry if the second attempt also 401s", async () => {
    const fetchMock = seqFetch(
      { body: { message: "Bad credentials" }, ok: false, status: 401 },
      { body: { message: "Bad credentials" }, ok: false, status: 401 },
    );
    vi.stubGlobal("fetch", fetchMock);
    const getToken = reMintableProvider();
    const client = new GitHubClient({ getToken, org: "o", timeoutMs: 5000 });

    const result = await client.createIssue("r", { title: "t", body: "b" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken.invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-401 failures (a re-mint would not help)", async () => {
    const fetchMock = seqFetch({ body: { message: "Validation Failed" }, ok: false, status: 422 });
    vi.stubGlobal("fetch", fetchMock);
    const getToken = reMintableProvider();
    const client = new GitHubClient({ getToken, org: "o", timeoutMs: 5000 });

    const result = await client.createIssue("r", { title: "t", body: "b" });

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken.invalidate).not.toHaveBeenCalled();
  });

  it("a static token (no invalidate) makes a single attempt on 401", async () => {
    const fetchMock = seqFetch({ body: { message: "Bad credentials" }, ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "static", org: "o", timeoutMs: 5000 });

    const result = await client.createIssue("r", { title: "t", body: "b" });

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
