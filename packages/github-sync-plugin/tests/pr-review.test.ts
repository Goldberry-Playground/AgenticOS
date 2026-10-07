import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  anyFrontendMatch,
  buildChangesRequestedPing,
  buildReReviewPing,
  buildReviewIssueBody,
  buildReviewIssuesCreatedPing,
  buildSelfReviewSkipPing,
  buildSignoffPing,
  CHECK_CONTEXT,
  classifyHeadChange,
  collectAuthorSignals,
  decideReviewAction,
  DEFAULT_FRONTEND_PATHS,
  filterSelfAuthoredReviewers,
  globToRegExp,
  isActionablePrAction,
  isNullBodyStatusError,
  isSelfAuthored,
  parseCoAuthorTrailers,
  parseGithubPrEvent,
  prReviewMarker,
  REQUIRED_REVIEWER,
  shortSha,
  type GithubPrEvent,
  type ReviewerAssignment,
} from "../src/pr-review.js";
import { verifyGithubSignature } from "../src/inbound.js";

const prEvent = (over: Record<string, unknown> = {}, prOver: Record<string, unknown> = {}) => ({
  action: "opened",
  number: 260,
  repository: { full_name: "Goldberry-Playground/AgenticOS" },
  pull_request: {
    number: 260,
    title: "Add dashboard widget",
    draft: false,
    html_url: "https://github.com/Goldberry-Playground/AgenticOS/pull/260",
    head: { sha: "abc1234def5678" },
    ...prOver,
  },
  ...over,
});

describe("parseGithubPrEvent", () => {
  it("maps a native pull_request payload", () => {
    const ev = parseGithubPrEvent(prEvent());
    expect(ev).toEqual({
      action: "opened",
      draft: false,
      repo: "Goldberry-Playground/AgenticOS",
      number: 260,
      title: "Add dashboard widget",
      headSha: "abc1234def5678",
      url: "https://github.com/Goldberry-Playground/AgenticOS/pull/260",
      before: "",
      after: "",
    });
  });

  it("reads draft flag and tolerates a string number", () => {
    expect(parseGithubPrEvent(prEvent({}, { draft: true }))?.draft).toBe(true);
    expect(parseGithubPrEvent(prEvent({}, { number: "42" }))?.number).toBe(42);
  });

  it("returns null without repo, positive number, or head sha", () => {
    expect(parseGithubPrEvent(prEvent({ repository: {} }))).toBeNull();
    expect(parseGithubPrEvent(prEvent({}, { number: 0 }))).toBeNull();
    expect(parseGithubPrEvent(prEvent({}, { head: {} }))).toBeNull();
    expect(parseGithubPrEvent("nope")).toBeNull();
  });

  it("captures before/after on a synchronize delivery", () => {
    const ev = parseGithubPrEvent(
      prEvent({ action: "synchronize", before: "oldsha111", after: "newsha222" }),
    );
    expect(ev?.before).toBe("oldsha111");
    expect(ev?.after).toBe("newsha222");
  });

  it("defaults before/after to empty strings when absent", () => {
    const ev = parseGithubPrEvent(prEvent());
    expect(ev?.before).toBe("");
    expect(ev?.after).toBe("");
  });
});

describe("isActionablePrAction — PR action filtering", () => {
  it("acts on opened/reopened/ready_for_review/synchronize", () => {
    for (const a of ["opened", "reopened", "ready_for_review", "synchronize"]) {
      expect(isActionablePrAction(a)).toBe(true);
    }
  });
  it("ignores edited/closed/labeled/assigned/etc.", () => {
    for (const a of ["edited", "closed", "labeled", "assigned", "converted_to_draft", ""]) {
      expect(isActionablePrAction(a)).toBe(false);
    }
  });
});

describe("globToRegExp / anyFrontendMatch — frontendPaths matching", () => {
  it("**/*.tsx matches nested and top-level .tsx", () => {
    const re = globToRegExp("**/*.tsx");
    expect(re.test("apps/dashboard/components/Button.tsx")).toBe(true);
    expect(re.test("Button.tsx")).toBe(true);
    expect(re.test("apps/api/server.ts")).toBe(false);
  });

  it("apps/dashboard/** matches anything under the dir but not siblings", () => {
    const re = globToRegExp("apps/dashboard/**");
    expect(re.test("apps/dashboard/page.ts")).toBe(true);
    expect(re.test("apps/dashboard/nested/deep/x.json")).toBe(true);
    expect(re.test("apps/dashboardx/page.ts")).toBe(false);
    expect(re.test("apps/api/page.ts")).toBe(false);
  });

  it("single * stays within a path segment", () => {
    const re = globToRegExp("apps/*/index.ts");
    expect(re.test("apps/api/index.ts")).toBe(true);
    expect(re.test("apps/a/b/index.ts")).toBe(false);
  });

  it("anyFrontendMatch triggers Iris on a frontend change, not on a pure backend PR", () => {
    expect(anyFrontendMatch(["apps/api/server.ts", "apps/dashboard/App.tsx"], DEFAULT_FRONTEND_PATHS)).toBe(true);
    expect(anyFrontendMatch(["styles/theme.css"], DEFAULT_FRONTEND_PATHS)).toBe(true);
    expect(anyFrontendMatch(["packages/core/lib.ts", "README.md"], DEFAULT_FRONTEND_PATHS)).toBe(false);
    expect(anyFrontendMatch([], DEFAULT_FRONTEND_PATHS)).toBe(false);
  });
});

describe("decideReviewAction — idempotency per head SHA", () => {
  it("creates when the reviewer has never seen the PR", () => {
    expect(decideReviewAction(null, "sha-a")).toBe("create");
  });
  it("no-ops on a redelivery at the same head SHA", () => {
    expect(decideReviewAction("sha-a", "sha-a")).toBe("noop");
  });
  it("reopens when the head SHA changed (new commits / synchronize)", () => {
    expect(decideReviewAction("sha-a", "sha-b")).toBe("reopen");
  });
});

describe("HMAC verification (github-pr shares the appWebhookSecret path)", () => {
  const SECRET = "app-secret";
  const RAW = JSON.stringify(prEvent());
  const SIG = `sha256=${createHmac("sha256", SECRET).update(RAW, "utf8").digest("hex")}`;

  it("accepts a correctly-signed pull_request body and rejects tampering", () => {
    expect(verifyGithubSignature(RAW, SECRET, SIG)).toBe(true);
    expect(verifyGithubSignature(RAW + " ", SECRET, SIG)).toBe(false);
    expect(verifyGithubSignature(RAW, "wrong", SIG)).toBe(false);
    expect(verifyGithubSignature(RAW, SECRET, undefined)).toBe(false);
  });
});

describe("review issue + marker content", () => {
  const ev: GithubPrEvent = {
    action: "opened",
    draft: false,
    repo: "Goldberry-Playground/AgenticOS",
    number: 260,
    title: "Add widget",
    headSha: "abc1234def",
    url: "https://github.com/Goldberry-Playground/AgenticOS/pull/260",
    before: "",
    after: "",
  };

  it("embeds the loop-prevention marker keyed on (repo, PR, head sha)", () => {
    const marker = prReviewMarker(ev.repo, ev.number, ev.headSha);
    expect(marker).toBe("<!-- pr-review: Goldberry-Playground/AgenticOS#260@abc1234def -->");
    expect(buildReviewIssueBody("ada", ev, ["a.ts"])).toContain(marker);
  });

  it("names the reviewer's check-run context in the body", () => {
    expect(buildReviewIssueBody("ada", ev, ["a.ts"])).toContain(CHECK_CONTEXT.ada);
    expect(buildReviewIssueBody("iris", ev, ["a.tsx"])).toContain(CHECK_CONTEXT.iris);
  });

  it("truncates a huge changed-file list with a summary line", () => {
    const files = Array.from({ length: 60 }, (_, i) => `f${i}.ts`);
    const body = buildReviewIssueBody("ada", ev, files);
    expect(body).toContain("Changed files (60)");
    expect(body).toContain("…and 10 more");
  });
});

describe("state-change pings", () => {
  const ev: GithubPrEvent = {
    action: "opened",
    draft: false,
    repo: "org/repo",
    number: 7,
    title: "t",
    headSha: "deadbeefcafe",
    url: "https://x/pull/7",
    before: "",
    after: "",
  };
  it("created ping lists reviewers", () => {
    expect(buildReviewIssuesCreatedPing(ev, ["ada", "iris"])).toContain("Ada + Iris");
    expect(buildReviewIssuesCreatedPing(ev, ["ada"])).toContain("org/repo#7");
  });
  it("re-review ping shows the short SHA", () => {
    const msg = buildReReviewPing(ev, ["ada"]);
    expect(msg).toContain(shortSha(ev.headSha));
    expect(msg).toContain("new commits");
  });
  it("sign-off + changes-requested pings name the context/reviewer", () => {
    expect(buildSignoffPing(["ada"], "org/repo", 7)).toContain("agent-review/ada");
    expect(buildSignoffPing(["iris", "ada"], "org/repo", 7)).toContain("agent-review/iris + agent-review/ada");
    expect(buildChangesRequestedPing("iris", "org/repo", 7)).toContain("Iris requested changes");
  });
});

describe("isNullBodyStatusError (GOL-179 ops-ping 204 handling)", () => {
  it("treats a 204 No Content Response-constructor throw as success", () => {
    // The exact shape the SDK's http.fetch throws when Discord acks with 204.
    expect(isNullBodyStatusError(new Error("Response constructor: Invalid response status code 204"))).toBe(true);
  });
  it("also covers the other null-body statuses (205, 304)", () => {
    expect(isNullBodyStatusError(new Error("Invalid response status code 205"))).toBe(true);
    expect(isNullBodyStatusError(new Error("Invalid response status code 304"))).toBe(true);
  });
  it("does not swallow real failures", () => {
    expect(isNullBodyStatusError(new Error("fetch failed: ECONNREFUSED"))).toBe(false);
    expect(isNullBodyStatusError(new Error("Invalid response status code 500"))).toBe(false);
    expect(isNullBodyStatusError("timeout")).toBe(false);
  });
});

describe("classifyHeadChange", () => {
  const webflowMerge = { parents: ["beforesha", "basesha"], committerLogin: "web-flow" };

  it("classifies a GitHub Update-branch merge as base-sync", () => {
    expect(classifyHeadChange({ before: "beforesha", head: webflowMerge })).toBe("base-sync");
  });

  it("classifies an ordinary single-parent push as author-work", () => {
    expect(
      classifyHeadChange({
        before: "beforesha",
        head: { parents: ["beforesha"], committerLogin: "agenticos-developer[bot]" },
      }),
    ).toBe("author-work");
  });

  it("classifies a locally-authored merge as author-work (may carry conflict resolutions)", () => {
    expect(
      classifyHeadChange({
        before: "beforesha",
        head: { parents: ["beforesha", "basesha"], committerLogin: "EngineeringMoonBear" },
      }),
    ).toBe("author-work");
  });

  it("classifies a force-push (first parent is not `before`) as author-work", () => {
    expect(
      classifyHeadChange({
        before: "beforesha",
        head: { parents: ["someothersha", "basesha"], committerLogin: "web-flow" },
      }),
    ).toBe("author-work");
  });

  it("fails toward author-work when the head commit could not be fetched", () => {
    expect(classifyHeadChange({ before: "beforesha", head: null })).toBe("author-work");
  });

  it("fails toward author-work when `before` is unknown", () => {
    expect(classifyHeadChange({ before: "", head: webflowMerge })).toBe("author-work");
  });

  it("classifies an octopus merge as author-work", () => {
    expect(
      classifyHeadChange({
        before: "beforesha",
        head: { parents: ["beforesha", "b", "c"], committerLogin: "web-flow" },
      }),
    ).toBe("author-work");
  });
});

describe("self-review guard (GOL-2720)", () => {
  const ADA = "ada-agent-uuid";
  const IRIS = "iris-agent-uuid";
  const bothReviewers: ReviewerAssignment[] = [
    { reviewer: "ada", agentId: ADA },
    { reviewer: "iris", agentId: IRIS },
  ];
  const identities = {
    ada: ["ada@goldberrygrove.farm"],
    iris: ["iris@goldberrygrove.farm", "Frontend - Iris"],
  };

  describe("collectAuthorSignals", () => {
    it("collects + normalizes emails, names and logins across commits, plus the opener login", () => {
      const signals = collectAuthorSignals(
        [
          { email: "Iris@GoldberryGrove.Farm", name: "Frontend - Iris", login: "agenticos-developer[bot]" },
          { email: "", name: "  ", login: "" },
        ],
        "AgenticOS-Developer[bot]",
      );
      expect(signals.has("iris@goldberrygrove.farm")).toBe(true);
      expect(signals.has("frontend - iris")).toBe(true);
      expect(signals.has("agenticos-developer[bot]")).toBe(true);
      // empty facets dropped, not added as ""
      expect(signals.has("")).toBe(false);
    });
  });

  describe("parseCoAuthorTrailers (GOL-2976)", () => {
    it("extracts name + email from Co-authored-by trailers (key case-insensitive)", () => {
      const trailers = parseCoAuthorTrailers(
        [
          "fix(dashboard): reflow header",
          "",
          "Co-authored-by: Ada <ada@goldberrygrove.farm>",
          "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>",
        ].join("\n"),
      );
      expect(trailers).toEqual([
        { name: "Ada", email: "ada@goldberrygrove.farm" },
        { name: "Claude Opus 5 (1M context)", email: "noreply@anthropic.com" },
      ]);
    });
    it("tolerates a trailer with only a name or only an email, and empty input", () => {
      expect(parseCoAuthorTrailers("Co-authored-by: ada-engineer[bot]")).toEqual([
        { name: "ada-engineer[bot]", email: "" },
      ]);
      expect(parseCoAuthorTrailers("Co-authored-by: <ada@goldberrygrove.farm>")).toEqual([
        { name: "", email: "ada@goldberrygrove.farm" },
      ]);
      expect(parseCoAuthorTrailers(undefined)).toEqual([]);
      expect(parseCoAuthorTrailers("no trailers here")).toEqual([]);
    });
  });

  describe("isSelfAuthored", () => {
    const signals = collectAuthorSignals([
      { email: "iris@goldberrygrove.farm", name: "Frontend - Iris", login: "" },
    ]);
    it("is true when a configured identity matches (case-insensitive)", () => {
      expect(isSelfAuthored("iris", identities, signals)).toBe(true);
    });
    it("is false for a reviewer who did not author", () => {
      expect(isSelfAuthored("ada", identities, signals)).toBe(false);
    });
    it("is false when no identities are configured (guard inert)", () => {
      expect(isSelfAuthored("iris", undefined, signals)).toBe(false);
      expect(isSelfAuthored("iris", {}, signals)).toBe(false);
    });

    // --- GOL-2976: shared-worktree git identity bleed regression -----------------
    // The implementing agent commits in a worktree whose git `user.email` belongs to
    // a sibling agent, so the git author facets are mis-attributed. The agent's own
    // `Co-authored-by:` trailer (written by its process, not from `user.email`) still
    // identifies the real author and must defeat the bleed.
    it("detects the real author from a Co-authored-by trailer when user.email bled", () => {
      const bled = collectAuthorSignals([
        {
          // Worktree carried Terra's identity — author facets are mis-attributed.
          email: "terra@goldberrygrove.farm",
          name: "DevOps - Terra",
          login: "agenticos-developer[bot]",
          // But the acting agent (Iris) stamped her own trailer.
          message: "fix(ui): tidy header\n\nCo-authored-by: Frontend - Iris <iris@goldberrygrove.farm>",
        },
      ]);
      expect(isSelfAuthored("iris", identities, bled)).toBe(true);
    });
    it("does not treat the bled sibling identity as the reviewer's own authorship", () => {
      // Ada is NOT an author here (Iris implemented); the bled Terra facets must not
      // make Ada look like an author either.
      const bled = collectAuthorSignals([
        {
          email: "terra@goldberrygrove.farm",
          name: "DevOps - Terra",
          login: "agenticos-developer[bot]",
          message: "fix(ui): tidy header\n\nCo-authored-by: Frontend - Iris <iris@goldberrygrove.farm>",
        },
      ]);
      expect(isSelfAuthored("ada", identities, bled)).toBe(false);
    });
    it("shared model/Paperclip trailers never match an agent-specific identity", () => {
      const signals = collectAuthorSignals([
        {
          email: "terra@goldberrygrove.farm",
          name: "DevOps - Terra",
          login: "",
          message:
            "chore: bump\n\nCo-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>\nCo-authored-by: Paperclip <noreply@paperclip.ing>",
        },
      ]);
      expect(isSelfAuthored("ada", identities, signals)).toBe(false);
      expect(isSelfAuthored("iris", identities, signals)).toBe(false);
    });
  });

  // End-to-end of the bleed regression through the actual skip decision (GOL-2976).
  // Realistic topology from PR #806: the real author's worktree carried a THIRD
  // agent's git identity (Terra, who is not a reviewer), so the git author facets
  // point at nobody relevant. Without the trailer the guard reads author=∅ → treats
  // the required reviewer as independent → leaves the real author (Iris) to review
  // her own frontend code. The acting agent's `Co-authored-by:` trailer restores the
  // real author so her supplementary twin is correctly skipped.
  //
  // NOTE (coordination): a bleed that mis-attributes the git author TO the REQUIRED
  // reviewer (Ada) is NOT fixable here — trailer parsing only ADDS author signals, it
  // cannot prove a git-author signal is false (a real co-author looks identical). That
  // false-positive direction is closed by Terra's commit-time identity assertion
  // (GOL-2976 fix #1); this guard is the defence-in-depth for the bleed-AWAY case.
  describe("identity-bleed skip decision (GOL-2976)", () => {
    const reviewers: ReviewerAssignment[] = [
      { reviewer: "ada", agentId: ADA },
      { reviewer: "iris", agentId: IRIS },
    ];
    const bledToThirdAgent = collectAuthorSignals([
      {
        email: "terra@goldberrygrove.farm", // bled — worktree carried Terra's identity
        name: "DevOps - Terra",
        login: "agenticos-developer[bot]",
        message: "feat(ui): new widget\n\nCo-authored-by: Frontend - Iris <iris@goldberrygrove.farm>",
      },
    ]);
    it("skips Iris (real author) even though the git author facets say Terra", () => {
      const { toReview, skipped } = filterSelfAuthoredReviewers(reviewers, (r) =>
        isSelfAuthored(r, identities, bledToThirdAgent),
      );
      expect(toReview.map((r) => r.reviewer)).toEqual(["ada"]);
      expect(skipped).toEqual([{ reviewer: "iris", coveredBy: REQUIRED_REVIEWER }]);
    });
  });

  describe("filterSelfAuthoredReviewers", () => {
    it("skips a supplementary self-author (Iris) when the required reviewer is independent", () => {
      const { toReview, skipped } = filterSelfAuthoredReviewers(bothReviewers, (r) => r === "iris");
      expect(toReview.map((r) => r.reviewer)).toEqual(["ada"]);
      expect(skipped).toEqual([{ reviewer: "iris", coveredBy: REQUIRED_REVIEWER }]);
    });

    it("never skips the required reviewer, even when Ada authored (single-lead model)", () => {
      const { toReview, skipped } = filterSelfAuthoredReviewers(bothReviewers, (r) => r === "ada");
      // Ada (required) is kept; Iris is not an author, so kept too.
      expect(toReview.map((r) => r.reviewer)).toEqual(["ada", "iris"]);
      expect(skipped).toEqual([]);
    });

    it("does NOT skip Iris when the required reviewer is ALSO an author (no independent coverage)", () => {
      const { toReview, skipped } = filterSelfAuthoredReviewers(bothReviewers, () => true);
      expect(toReview.map((r) => r.reviewer)).toEqual(["ada", "iris"]);
      expect(skipped).toEqual([]);
    });

    it("keeps everyone when nobody authored the PR", () => {
      const { toReview, skipped } = filterSelfAuthoredReviewers(bothReviewers, () => false);
      expect(toReview).toEqual(bothReviewers);
      expect(skipped).toEqual([]);
    });

    it("keeps a lone required reviewer even if flagged as author (never wedge the required check)", () => {
      const only: ReviewerAssignment[] = [{ reviewer: "ada", agentId: ADA }];
      const { toReview, skipped } = filterSelfAuthoredReviewers(only, () => true);
      expect(toReview).toEqual(only);
      expect(skipped).toEqual([]);
    });
  });

  describe("buildSelfReviewSkipPing", () => {
    it("names the skipped reviewer, its author status, and the covering reviewer", () => {
      const ev = parseGithubPrEvent(prEvent()) as GithubPrEvent;
      const ping = buildSelfReviewSkipPing(ev, [{ reviewer: "iris", coveredBy: "ada" }]);
      expect(ping).toContain("self-review skipped");
      expect(ping).toContain("iris (author) → covered by ada");
    });
  });
});
