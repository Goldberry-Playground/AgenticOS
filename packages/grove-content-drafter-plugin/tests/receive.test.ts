import { describe, it, expect, vi } from "vitest";
import { processReply, extractDraftJson, type ReceiveDeps } from "../src/receive.js";
import type { DrafterConfig, IssuePort, RequestState, StatePort } from "../src/ports.js";

const NOW = new Date("2026-09-24T06:00:00.000Z");
const ISSUE = "iss-1";
const PRODUCT = 42;

function cfg(over: Partial<DrafterConfig> = {}): DrafterConfig {
  return {
    odooBaseUrl: "https://odoo.qa",
    odooDb: "odoo",
    odooUsername: "content-drafter",
    odooPassword: "pw",
    houseRules: "",
    companyId: "co-1",
    groveProjectId: "proj-1",
    drafterAgentId: "sora",
    maxDraftsPerRun: 5,
    replyTimeoutHours: 12,
    dryRun: false,
    ...over,
  };
}

function openState(over: Partial<RequestState> = {}): RequestState {
  return {
    productId: PRODUCT,
    marker: `product.template#${PRODUCT}@2026-09-20 00:00:00`,
    status: "open",
    attempts: 0,
    rePinged: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    ...over,
  };
}

function productRecord(over: Record<string, unknown> = {}) {
  return {
    name: "Chicago Hardy Fig",
    categ_id: [4, "Plants / Fruit"],
    write_date: "2026-09-20 00:00:00",
    grove_shipping_tier: "bareroot",
    grove_facts_provenance: { grove_zone_min: { source: "usda", ref: "FICA", at: "2026-09-20T00:00:00Z" } },
    description_ecommerce: false,
    website_description: false,
    grove_botanical_name: "Ficus carica",
    grove_soil: false,
    ...over,
  };
}

const goodDraft = JSON.stringify({
  description_ecommerce_html: "<p>A cold-hardy fig.</p>",
  website_description_html: "<h2>Site & soil</h2><p>Well-drained soil.</p>",
  filled_facts: [
    { field: "grove_soil", value: "Well-drained loam", source_name: "NC State Ext", source_url: "https://ext.ncsu.edu/fig" },
  ],
  sources: [{ name: "NC State Ext", url: "https://ext.ncsu.edu/fig" }],
});

function fakeOdoo(over: Record<string, any> = {}) {
  return {
    read: vi.fn().mockResolvedValue({ ok: true, data: productRecord() }),
    write: vi.fn().mockResolvedValue({ ok: true, data: true }),
    postNote: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    ...over,
  } as any;
}

function fakeIssues(comments: { authorAgentId: string | null; body: string; createdAt: string }[], over: Partial<IssuePort> = {}): IssuePort {
  return {
    openRequestExistsForProduct: vi.fn(),
    createRequestIssue: vi.fn(),
    get: vi.fn(),
    listOwnRequests: vi.fn(),
    listComments: vi.fn().mockResolvedValue(comments),
    postComment: vi.fn().mockResolvedValue(undefined),
    wakeAssignee: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as any;
}

function fakeState(initial: RequestState | null, over: Partial<StatePort> = {}): { state: StatePort; saved: RequestState[] } {
  const saved: RequestState[] = [];
  const state: StatePort = {
    getRequest: vi.fn().mockResolvedValue(initial),
    setRequest: vi.fn(async (_id: string, s: RequestState) => {
      saved.push(structuredClone(s));
    }),
    getDraftedVersion: vi.fn().mockResolvedValue(null),
    setDraftedVersion: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as any;
  return { state, saved };
}

function deps(odoo: any, issues: IssuePort, state: StatePort, c = cfg()): ReceiveDeps {
  return { odoo, issues, state, cfg: c, now: NOW, logger: { info: () => {} } };
}

describe("extractDraftJson", () => {
  it("pulls the last fenced json block out of a chatty comment", () => {
    const body = "Here you go!\n\n```json\n" + goodDraft + "\n```\n\nLet me know.";
    expect(JSON.parse(extractDraftJson(body)).description_ecommerce_html).toContain("cold-hardy");
  });
});

describe("processReply", () => {
  const reply = (createdAt = "2026-09-24T05:00:00.000Z", body = "```json\n" + goodDraft + "\n```") => ({
    authorAgentId: "sora",
    body,
    createdAt,
  });

  it("writes the validated draft, records the version, and closes the issue", async () => {
    const odoo = fakeOdoo();
    const issues = fakeIssues([reply()]);
    const { state } = fakeState(openState());
    const out = await processReply(deps(odoo, issues, state), ISSUE);
    expect(out.status).toBe("drafted");
    expect(odoo.write).toHaveBeenCalledOnce();
    const [id, vals] = odoo.write.mock.calls[0];
    expect(id).toBe(PRODUCT);
    expect(vals.grove_draft_state).toBe("drafted");
    expect(vals.grove_facts_reviewed).toBe(false);
    expect(vals.grove_soil).toBe("Well-drained loam");
    expect(vals.grove_facts_provenance.grove_zone_min.source).toBe("usda"); // merged, not clobbered
    expect(state.setDraftedVersion).toHaveBeenCalledWith("pt#42", openState().marker);
    expect(issues.setStatus).toHaveBeenCalledWith(ISSUE, "done");
  });

  it("dry-run validates + closes but never writes Odoo or records the version", async () => {
    const odoo = fakeOdoo();
    const issues = fakeIssues([reply()]);
    const { state } = fakeState(openState());
    const out = await processReply(deps(odoo, issues, state, cfg({ dryRun: true })), ISSUE);
    expect(out.status).toBe("drafted");
    if (out.status === "drafted") expect(out.dryRun).toBe(true);
    expect(odoo.write).not.toHaveBeenCalled();
    expect(state.setDraftedVersion).not.toHaveBeenCalled();
    expect(issues.setStatus).toHaveBeenCalledWith(ISSUE, "done");
  });

  it("waits when there is no reply from the drafting agent yet", async () => {
    const odoo = fakeOdoo();
    const issues = fakeIssues([{ authorAgentId: "someone-else", body: "hi", createdAt: "2026-09-24T05:00:00.000Z" }]);
    const { state } = fakeState(openState());
    const out = await processReply(deps(odoo, issues, state), ISSUE);
    expect(out.status).toBe("waiting");
    expect(odoo.read).not.toHaveBeenCalled();
    expect(odoo.write).not.toHaveBeenCalled();
  });

  it("comments the validation error and wakes the agent on an invalid reply", async () => {
    const odoo = fakeOdoo();
    const issues = fakeIssues([reply("2026-09-24T05:00:00.000Z", "no json here, sorry")]);
    const { state, saved } = fakeState(openState());
    const out = await processReply(deps(odoo, issues, state), ISSUE);
    expect(out.status).toBe("invalid");
    if (out.status === "invalid") expect(out.gaveUp).toBe(false);
    expect(odoo.write).not.toHaveBeenCalled();
    expect(issues.postComment).toHaveBeenCalledOnce();
    expect(issues.wakeAssignee).toHaveBeenCalledOnce();
    expect(saved.at(-1)!.attempts).toBe(1);
  });

  it("blocks the request after the retry cap of invalid replies", async () => {
    const odoo = fakeOdoo();
    const issues = fakeIssues([reply("2026-09-24T05:00:00.000Z", "still not json")]);
    const { state } = fakeState(openState({ attempts: 1 }));
    const out = await processReply(deps(odoo, issues, state), ISSUE);
    expect(out.status).toBe("invalid");
    if (out.status === "invalid") expect(out.gaveUp).toBe(true);
    expect(issues.setStatus).toHaveBeenCalledWith(ISSUE, "blocked");
    expect(issues.wakeAssignee).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-drafted request is ignored", async () => {
    const odoo = fakeOdoo();
    const issues = fakeIssues([reply()]);
    const { state } = fakeState(openState({ status: "drafted" }));
    const out = await processReply(deps(odoo, issues, state), ISSUE);
    expect(out.status).toBe("ignored");
    expect(odoo.write).not.toHaveBeenCalled();
  });

  it("does not re-process a reply already handled (lastReplyAt guard)", async () => {
    const odoo = fakeOdoo();
    const at = "2026-09-24T05:00:00.000Z";
    const issues = fakeIssues([reply(at)]);
    const { state } = fakeState(openState({ lastReplyAt: at }));
    const out = await processReply(deps(odoo, issues, state), ISSUE);
    expect(out.status).toBe("waiting");
    expect(odoo.write).not.toHaveBeenCalled();
  });
});
