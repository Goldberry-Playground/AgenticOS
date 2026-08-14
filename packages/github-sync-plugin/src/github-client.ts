import type { TokenProvider } from "./broker.js";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; status?: number; errors?: GitHubFieldError[] };
export type Result<T> = Ok<T> | Err;

/**
 * A single entry from GitHub's `errors[]` array on a 4xx (typically 422
 * "Validation Failed"). GitHub drops this detail into the response body but the
 * top-level `message` alone ("Validation Failed") is useless for root-cause, so
 * we surface it on the `Err` return. Fields are all optional because GitHub
 * varies the shape by `code` (e.g. `custom` carries `message`, field errors
 * carry `field`).
 */
export interface GitHubFieldError {
  resource?: string;
  field?: string;
  code?: string;
  message?: string;
}

export interface GitHubClientConfig {
  org: string;
  /** Static bearer token. Provide this OR `getToken`. */
  token?: string;
  /** Per-repo token provider (e.g. the gh-token-broker). Takes precedence over `token`. */
  getToken?: TokenProvider;
  timeoutMs?: number;
  baseUrl?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  htmlUrl: string;
  labels: string[];
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
}

export interface UpdateIssueInput {
  title?: string;
  body?: string;
  state?: "open" | "closed";
  labels?: string[];
}

const API_BASE = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Small write-capable GitHub REST client. Mirrors github-plugin's
 * `Result<T>` discriminated-union contract and 8s request timeout.
 */
export class GitHubClient {
  private readonly getToken: TokenProvider;
  private readonly org: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(config: GitHubClientConfig) {
    if (config.getToken) {
      this.getToken = config.getToken;
    } else if (config.token != null) {
      const t = config.token;
      this.getToken = async () => t;
    } else {
      throw new Error("GitHubClient requires either `token` or `getToken`");
    }
    this.org = config.org;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = (config.baseUrl ?? API_BASE).replace(/\/$/, "");
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    repo: string,
    pathAndQuery: string,
    body?: unknown,
  ): Promise<Result<T>> {
    // A cached installation token can be revoked (App suspended, key rotated,
    // permissions changed) BEFORE its cached expiry — every write with it then
    // gets GitHub's 401 "Bad credentials" for the rest of the cache TTL
    // (GOL-1425). So on a 401 we evict the token via the provider and retry ONCE
    // with a freshly minted one. Only providers that expose `invalidate` (the
    // broker) can be re-minted; a static token can't, so it makes a single try.
    const canRetry = typeof this.getToken.invalidate === "function";
    const maxAttempts = canRetry ? 2 : 1;
    let lastErr: Result<T> | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await this.attempt<T>(method, repo, pathAndQuery, body);
      if (res.ok || res.status !== 401 || attempt === maxAttempts) return res;
      // First 401 with a re-mintable provider: evict and try again.
      this.getToken.invalidate?.(repo);
      lastErr = res;
    }
    return lastErr ?? { ok: false, error: "request failed" };
  }

  private async attempt<T>(
    method: "GET" | "POST" | "PATCH",
    repo: string,
    pathAndQuery: string,
    body?: unknown,
  ): Promise<Result<T>> {
    let token: string;
    try {
      token = await this.getToken(repo);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "token unavailable",
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${pathAndQuery}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      // Read the body as text FIRST, then attempt JSON.parse. A bodyless or
      // non-JSON error response (an edge/proxy 401, an HTML 5xx) makes `res.json()`
      // throw — which used to jump to the catch below and DROP the HTTP status,
      // surfacing as an empty `error` at the call site (GOL-802: the transient
      // broker-token 401 window logged a completely empty error for exactly this
      // reason). Parsing defensively keeps the status and always yields a non-empty
      // error string.
      const rawBody = await res.text();
      let json = {} as T & { message?: string; errors?: GitHubFieldError[] };
      if (rawBody) {
        try {
          json = JSON.parse(rawBody);
        } catch {
          // Non-JSON body — leave `json` empty; the raw text feeds the error below.
        }
      }
      if (!res.ok) {
        const errors = Array.isArray(json.errors) ? json.errors : undefined;
        // Fold GitHub's errors[] into the human-readable string so callers that
        // only log `error` still get the field/code, and expose the structured
        // array + status for callers that can act on it (payload sanitizing).
        const detail = errors?.length
          ? errors
              .map((e) =>
                [e.resource, e.field, e.code, e.message]
                  .filter(Boolean)
                  .join("."),
              )
              .join("; ")
          : undefined;
        // Always land a non-empty, status-bearing error even when GitHub gives no
        // JSON `message` (fall back to the status + a raw-body snippet).
        const base =
          json.message ??
          (rawBody ? `HTTP ${res.status}: ${rawBody.slice(0, 200)}` : `HTTP ${res.status}`);
        return {
          ok: false,
          status: res.status,
          error: detail ? `${base} (${detail})` : base,
          ...(errors ? { errors } : {}),
        };
      }
      return { ok: true, data: json };
    } catch (err) {
      // Transport-level failure (no HTTP status): DNS/connection error, or the 8s
      // timeout aborting the request. Callers treat a status-less Err as transient.
      const error =
        err instanceof Error
          ? err.name === "AbortError"
            ? `request timed out after ${this.timeoutMs}ms`
            : err.message
          : "github unreachable";
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
    }
  }

  private parseIssue(raw: Record<string, any>): GitHubIssue {
    return {
      number: Number(raw.number),
      title: String(raw.title ?? ""),
      body: typeof raw.body === "string" ? raw.body : "",
      state: raw.state === "closed" ? "closed" : "open",
      htmlUrl: String(raw.html_url ?? ""),
      labels: Array.isArray(raw.labels)
        ? raw.labels.map((l: any) => (typeof l === "string" ? l : String(l?.name ?? ""))).filter(Boolean)
        : [],
    };
  }

  /** Create a new issue in `<org>/<repo>`. */
  async createIssue(repo: string, input: CreateIssueInput): Promise<Result<GitHubIssue>> {
    const res = await this.request<Record<string, any>>(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/issues`,
      {
        title: input.title,
        body: input.body,
        ...(input.labels ? { labels: input.labels } : {}),
      },
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }

  /** Update an existing issue (title/body/state/labels) by number. */
  async updateIssue(
    repo: string,
    num: number,
    input: UpdateIssueInput,
  ): Promise<Result<GitHubIssue>> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.body !== undefined) patch.body = input.body;
    if (input.state !== undefined) patch.state = input.state;
    if (input.labels !== undefined) patch.labels = input.labels;

    const res = await this.request<Record<string, any>>(
      "PATCH",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}`,
      patch,
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }

  /** Fetch a single issue by number. */
  async getIssue(repo: string, num: number): Promise<Result<GitHubIssue>> {
    const res = await this.request<Record<string, any>>(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}`,
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }

  /**
   * List a repo's issues (GOL-1206 inbound-close reconcile sweep). GitHub's
   * `/issues` endpoint returns BOTH issues and pull requests — a PR item carries
   * a `pull_request` object — so any item with that key is dropped: this sweep
   * only reconciles *issue* closures back onto Paperclip mirrors (PR closes drive
   * the review/CI pipelines, not the mirror). Paginated at 100/page and capped at
   * `maxPages` to bound cost; `truncated` reports whether the cap cut the scan
   * short. `since` (ISO 8601) filters to issues updated at/after that instant so an
   * hourly sweep only re-examines recently-touched issues; `sort=updated&desc`
   * keeps the freshest closures in the first page(s).
   */
  async listIssues(
    repo: string,
    opts: { state: "open" | "closed" | "all"; since?: string; maxPages?: number },
  ): Promise<Result<{ issues: GitHubIssue[]; truncated: boolean }>> {
    const PER_PAGE = 100;
    const maxPages = opts.maxPages ?? 5;
    const issues: GitHubIssue[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const qs = new URLSearchParams({
        state: opts.state,
        per_page: String(PER_PAGE),
        page: String(page),
        sort: "updated",
        direction: "desc",
      });
      if (opts.since) qs.set("since", opts.since);
      const res = await this.request<Array<Record<string, any>>>(
        "GET",
        repo,
        `/repos/${this.org}/${repo}/issues?${qs.toString()}`,
      );
      if (!res.ok) return res;
      const batch = Array.isArray(res.data) ? res.data : [];
      for (const raw of batch) {
        if (raw && raw.pull_request) continue; // PRs are issues in GitHub's model — skip
        issues.push(this.parseIssue(raw));
      }
      if (batch.length < PER_PAGE) return { ok: true, data: { issues, truncated: false } };
    }
    return { ok: true, data: { issues, truncated: true } };
  }

  /**
   * List a PR's changed-file paths (GOL-158). Paginated at 100/page, capped at
   * MAX_FILE_PAGES to bound cost; the `truncated` flag says whether the cap was
   * hit so the caller can log it (frontendPaths matching stays correct — a match
   * in the first pages is enough; a giant PR that only touches frontend beyond
   * page N is the rare miss we accept for a bounded request budget).
   */
  async listPullFiles(
    repo: string,
    num: number,
  ): Promise<Result<{ files: string[]; truncated: boolean }>> {
    const MAX_FILE_PAGES = 10; // 10 * 100 = up to 1000 files
    const PER_PAGE = 100;
    const files: string[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const res = await this.request<Array<Record<string, any>>>(
        "GET",
        repo,
        `/repos/${this.org}/${repo}/pulls/${num}/files?per_page=${PER_PAGE}&page=${page}`,
      );
      if (!res.ok) return res;
      const batch = Array.isArray(res.data) ? res.data : [];
      for (const f of batch) {
        if (f && typeof f.filename === "string") files.push(f.filename);
      }
      if (batch.length < PER_PAGE) return { ok: true, data: { files, truncated: false } };
    }
    return { ok: true, data: { files, truncated: true } };
  }

  /**
   * Create a check-run on `headSha` (GOL-158 sign-off mechanism). Pass no
   * `conclusion` to seed/reset a pending run (`status: "in_progress"`); pass a
   * conclusion to complete it. Requires the App's `checks:write` permission.
   */
  async createCheckRun(
    repo: string,
    input: {
      name: string;
      headSha: string;
      conclusion?: "success" | "failure" | "neutral";
      title: string;
      summary: string;
      detailsUrl?: string;
    },
  ): Promise<Result<{ id: number }>> {
    const body: Record<string, unknown> = {
      name: input.name,
      head_sha: input.headSha,
      output: { title: input.title, summary: input.summary },
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
    };
    if (input.conclusion) {
      body.status = "completed";
      body.conclusion = input.conclusion;
      body.completed_at = new Date().toISOString();
    } else {
      body.status = "in_progress";
    }
    const res = await this.request<Record<string, any>>(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/check-runs`,
      body,
    );
    if (!res.ok) return res;
    return { ok: true, data: { id: Number(res.data.id) } };
  }

  /**
   * Fetch a PR's author + head SHA + state (GOL-305). The CI-fix loop gates on
   * `authorLogin === agenticos-developer[bot]` (agent-authored PRs only) and needs
   * the head SHA to key idempotency. `merged` distinguishes a merged PR from a
   * plain close.
   */
  async getPull(
    repo: string,
    num: number,
  ): Promise<Result<{ number: number; title: string; authorLogin: string; headSha: string; htmlUrl: string; state: "open" | "closed"; draft: boolean; merged: boolean }>> {
    const res = await this.request<Record<string, any>>(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/pulls/${num}`,
    );
    if (!res.ok) return res;
    const raw = res.data;
    return {
      ok: true,
      data: {
        number: Number(raw.number),
        title: String(raw.title ?? ""),
        authorLogin: String(raw.user?.login ?? ""),
        headSha: String(raw.head?.sha ?? ""),
        htmlUrl: String(raw.html_url ?? ""),
        state: raw.state === "closed" ? "closed" : "open",
        draft: raw.draft === true,
        merged: raw.merged === true,
      },
    };
  }

  /**
   * Fetch a single commit's parents + committer. Used by the `synchronize`
   * classifier to tell a GitHub-generated base-sync merge (Update branch) from
   * real author commits: GitHub's update-branch produces a 2-parent merge whose
   * first parent is the previous PR head and whose committer is `web-flow`.
   * Requires only `contents:read`.
   */
  async getCommit(
    repo: string,
    sha: string,
  ): Promise<Result<{ sha: string; parents: string[]; committerLogin: string }>> {
    const res = await this.request<Record<string, any>>(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/commits/${sha}`,
    );
    if (!res.ok) return res;
    const raw = res.data;
    const parents = Array.isArray(raw.parents) ? raw.parents : [];
    return {
      ok: true,
      data: {
        sha: String(raw.sha ?? ""),
        parents: parents.map((p: Record<string, any>) => String(p?.sha ?? "")),
        committerLogin: String(raw.committer?.login ?? ""),
      },
    };
  }

  /**
   * List the check-runs for a commit ref (GOL-305). Used to derive the aggregate CI
   * state on a PR head SHA regardless of whether a `check_suite` or `workflow_run`
   * event triggered us. Single page at 100 (a suite rarely exceeds that); `output`
   * gives a short human excerpt for the fix issue without downloading job logs.
   * Requires the App's `checks:read` permission.
   */
  async listCommitCheckRuns(
    repo: string,
    sha: string,
  ): Promise<Result<Array<{ name: string; status: string; conclusion: string | null; detailsUrl?: string; summary?: string }>>> {
    const res = await this.request<Record<string, any>>(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/commits/${sha}/check-runs?per_page=100`,
    );
    if (!res.ok) return res;
    const runs = Array.isArray(res.data?.check_runs) ? res.data.check_runs : [];
    return {
      ok: true,
      data: runs.map((r: any) => {
        const output = r?.output ?? {};
        const summary =
          typeof output.summary === "string" && output.summary
            ? output.summary
            : typeof output.title === "string"
              ? output.title
              : undefined;
        return {
          name: String(r?.name ?? ""),
          status: String(r?.status ?? ""),
          conclusion: typeof r?.conclusion === "string" ? r.conclusion : null,
          ...(typeof r?.details_url === "string" && r.details_url ? { detailsUrl: r.details_url } : {}),
          ...(summary ? { summary } : {}),
        };
      }),
    };
  }

  /** Comment on an issue or PR (PRs share the issues comments endpoint). */
  async createIssueComment(repo: string, num: number, body: string): Promise<Result<{ id: number }>> {
    const res = await this.request<Record<string, any>>(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}/comments`,
      { body },
    );
    if (!res.ok) return res;
    return { ok: true, data: { id: Number(res.data.id) } };
  }
}
