import { describe, it, expect } from "vitest";
import { runDigest } from "../src/digest/job.js";
import { renderMetaBlock, renderExtractionComment } from "../src/receipt-meta.js";
import type { ReceiptMeta, ReceiptExtraction } from "../src/types.js";

function receipt(n: number, payment: "card" | "cash"): { meta: ReceiptMeta; extraction: ReceiptExtraction } {
  return {
    meta: {
      v: 1, spacesKey: `receipts/2026/07/r${n}.jpg`, discordChannelId: "c",
      discordMessageId: `m${n}`, discordAttachmentId: `a${n}`,
      poster: "hannah", postedAt: "2026-07-02T15:04:05Z", caption: "",
    },
    extraction: {
      v: 1, vendor: `Vendor${n}`, date: "2026-07-02", total: 10 * n,
      payment_method: payment, line_items: [], suggested_category: "Supplies",
      confidence: 0.9, flags: [],
    },
  };
}

function makeDeps(items: Array<ReturnType<typeof receipt>>) {
  const dms: string[] = [];
  const deps = {
    issues: {
      listInReview: async () =>
        items.map((it, i) => ({ id: `i${i}`, title: `RCPT ${i}`, description: renderMetaBlock(it.meta) })),
      listComments: async (issueId: string) => {
        const idx = Number(issueId.slice(1));
        return ["some chatter", renderExtractionComment(items[idx]!.extraction)];
      },
    },
    discord: { dmUser: async (_u: string, content: string) => { dms.push(content); return { ok: true as const, data: {} }; } },
    archive: { presignGet: async (key: string) => `https://signed/${key}` },
    config: { joshDiscordUserId: "josh", presignExpirySeconds: 604800 },
    log: () => undefined,
  };
  return { deps, dms };
}

describe("runDigest", () => {
  it("sends one DM listing every in_review receipt with fresh links", async () => {
    const { deps, dms } = makeDeps([receipt(1, "card"), receipt(2, "cash")]);
    const out = await runDigest(deps);
    expect(out).toEqual({ receipts: 2, sent: true });
    expect(dms).toHaveLength(1);
    expect(dms[0]).toContain("Vendor1");
    expect(dms[0]).toContain("https://signed/receipts/2026/07/r1.jpg");
    expect(dms[0]).toContain("Quick Add"); // cash receipt marked
  });

  it("sends nothing when queue is empty", async () => {
    const { deps, dms } = makeDeps([]);
    const out = await runDigest(deps);
    expect(out).toEqual({ receipts: 0, sent: false });
    expect(dms).toHaveLength(0);
  });

  it("includes issues whose extraction comment is missing as needs-attention", async () => {
    const { deps, dms } = makeDeps([receipt(1, "card")]);
    deps.issues.listComments = async () => ["no extraction here"];
    const out = await runDigest(deps);
    expect(out.receipts).toBe(1);
    expect(dms[0]).toContain("needs attention");
  });

  it("paginates into multiple DMs under 2000 chars when URLs are long", async () => {
    const items = Array.from({ length: 8 }, (_, i) => receipt(i + 1, "card"));
    const { deps, dms } = makeDeps(items);
    deps.archive.presignGet = async (key: string) => `https://signed/${key}?sig=${"x".repeat(400)}`;
    const out = await runDigest(deps);
    expect(out).toEqual({ receipts: 8, sent: true });
    expect(dms.length).toBeGreaterThan(1);
    for (const dm of dms) expect(dm.length).toBeLessThanOrEqual(2000);
    expect(dms[0]).toContain("Receipt attach pass");
    expect(dms.at(-1)).toContain("After attaching in FarmRaise");
  });
});
