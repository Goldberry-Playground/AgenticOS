import { describe, it, expect, vi } from "vitest";
import { runRequestBatch } from "../src/request.js";
import { versionMarker, productOriginId, type DrafterConfig, type IssuePort, type StatePort } from "../src/ports.js";

const NOW = new Date("2026-09-24T00:00:00.000Z");

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
    dryRun: true,
    ...over,
  };
}

function record(id: number, over: Record<string, unknown> = {}) {
  return {
    name: `Product ${id}`,
    categ_id: [4, "Plants / Fruit"],
    write_date: "2026-09-20 00:00:00",
    grove_shipping_tier: "bareroot",
    grove_facts_provenance: false,
    description_ecommerce: false,
    website_description: false,
    grove_botanical_name: "Ficus carica",
    grove_soil: false,
    ...over,
  };
}

function fakeOdoo(ids: number[]) {
  return {
    searchRequested: vi.fn().mockResolvedValue({ ok: true, data: ids }),
    read: vi.fn(async (id: number) => ({ ok: true, data: record(id) })),
  } as any;
}

function fakeIssues(over: Partial<IssuePort> = {}): IssuePort {
  return {
    openRequestExistsForProduct: vi.fn().mockResolvedValue(false),
    createRequestIssue: vi.fn(async () => ({ id: `iss-${Math.random().toString(36).slice(2)}` })),
    get: vi.fn(),
    listOwnRequests: vi.fn(),
    listComments: vi.fn(),
    postComment: vi.fn(),
    wakeAssignee: vi.fn(),
    setStatus: vi.fn(),
    ...over,
  } as any;
}

function fakeState(over: Partial<StatePort> = {}): StatePort {
  return {
    getRequest: vi.fn().mockResolvedValue(null),
    setRequest: vi.fn().mockResolvedValue(undefined),
    getDraftedVersion: vi.fn().mockResolvedValue(null),
    setDraftedVersion: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as any;
}

describe("runRequestBatch", () => {
  it("opens one request issue per requested product and records state", async () => {
    const odoo = fakeOdoo([1, 2]);
    const issues = fakeIssues();
    const state = fakeState();
    const s = await runRequestBatch({ odoo, issues, state, cfg: cfg(), now: NOW });
    expect(s.requested).toBe(2);
    expect(issues.createRequestIssue).toHaveBeenCalledTimes(2);
    // origin id is product-scoped for the "one open per product" guard
    const firstCall = (issues.createRequestIssue as any).mock.calls[0][0];
    expect(firstCall.originId).toBe(productOriginId(1));
    expect(firstCall.description).toContain("content-draft: product.template#1@");
    expect(state.setRequest).toHaveBeenCalledTimes(2);
    const savedState = (state.setRequest as any).mock.calls[0][1];
    expect(savedState.status).toBe("open");
    expect(savedState.productId).toBe(1);
  });

  it("respects maxDraftsPerRun as the Odoo search limit (batch cap)", async () => {
    const odoo = fakeOdoo([1]);
    await runRequestBatch({ odoo, issues: fakeIssues(), state: fakeState(), cfg: cfg({ maxDraftsPerRun: 3 }), now: NOW });
    expect(odoo.searchRequested).toHaveBeenCalledWith(3);
  });

  it("skips a product that already has an open request (one open per product)", async () => {
    const issues = fakeIssues({ openRequestExistsForProduct: vi.fn().mockResolvedValue(true) });
    const s = await runRequestBatch({ odoo: fakeOdoo([7]), issues, state: fakeState(), cfg: cfg(), now: NOW });
    expect(s.requested).toBe(0);
    expect(s.skippedOpen).toBe(1);
    expect(issues.createRequestIssue).not.toHaveBeenCalled();
  });

  it("skips a product+version already drafted, but re-requests a changed version", async () => {
    const drafted = versionMarker(9, "2026-09-20 00:00:00");
    const state = fakeState({ getDraftedVersion: vi.fn().mockResolvedValue(drafted) });
    const sameVersion = await runRequestBatch({ odoo: fakeOdoo([9]), issues: fakeIssues(), state, cfg: cfg(), now: NOW });
    expect(sameVersion.skippedDrafted).toBe(1);
    expect(sameVersion.requested).toBe(0);

    // A newer write_date changes the marker → a fresh request is opened.
    const odoo2 = {
      searchRequested: vi.fn().mockResolvedValue({ ok: true, data: [9] }),
      read: vi.fn(async () => ({ ok: true, data: record(9, { write_date: "2026-09-23 12:00:00" }) })),
    } as any;
    const issues2 = fakeIssues();
    const changed = await runRequestBatch({ odoo: odoo2, issues: issues2, state, cfg: cfg(), now: NOW });
    expect(changed.requested).toBe(1);
    expect(issues2.createRequestIssue).toHaveBeenCalledOnce();
  });
});
