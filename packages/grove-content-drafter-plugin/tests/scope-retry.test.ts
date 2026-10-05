import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isInvocationScopeError, withScopeRetry } from "../src/scope-retry.js";

/** The exact host message, copied from server.log (2026-10-02, GOL-2927). */
const HOST_MSG =
  'Plugin "f071f43f-b860-4629-88ad-70823426de2f" is not allowed to perform "issues.list": ' +
  "the worker referenced a missing, expired, or unknown invocation scope";

function scopeError(): Error {
  return new Error(HOST_MSG);
}

/** Deterministic test harness: no real timers, no real jitter. */
function harness() {
  const sleeps: number[] = [];
  return {
    sleeps,
    opts: {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      random: () => 0.5, // jitter factor exactly 1.0 → delays are the raw schedule
    },
  };
}

describe("isInvocationScopeError", () => {
  it("matches the real host denial message", () => {
    expect(isInvocationScopeError(scopeError())).toBe(true);
  });

  it("matches wording variants so a host rename does not silently disable the retry", () => {
    expect(isInvocationScopeError(new Error("unknown invocation scope"))).toBe(true);
    expect(isInvocationScopeError(new Error("the invocation scope has EXPIRED"))).toBe(true);
    expect(isInvocationScopeError(new Error("missing invocation scope"))).toBe(true);
  });

  it("does NOT match the host's other denials, which are permanent, not transient", () => {
    // Same `not allowed to perform` prefix, different cause: a capability gap and
    // a cross-company scope violation. Retrying either is pure waste and would
    // mask a real misconfiguration.
    expect(
      isInvocationScopeError(
        new Error('Plugin "x" is not allowed to perform "issues.create": missing capability "issues:write"'),
      ),
    ).toBe(false);
    expect(
      isInvocationScopeError(
        new Error('Plugin "x" is not allowed to perform "issues.list": requested company "a" but the current invocation is scoped to company "b"'),
      ),
    ).toBe(false);
    expect(isInvocationScopeError(new Error("ECONNRESET"))).toBe(false);
    expect(isInvocationScopeError("boom")).toBe(false);
    expect(isInvocationScopeError(undefined)).toBe(false);
  });
});

describe("withScopeRetry", () => {
  it("returns the value with no sleeping when the first attempt succeeds", async () => {
    const h = harness();
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withScopeRetry("issues.list", fn, h.opts)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it("retries past a transient scope denial and returns the eventual value", async () => {
    const h = harness();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(scopeError())
      .mockRejectedValueOnce(scopeError())
      .mockResolvedValue(["issue"]);
    await expect(withScopeRetry("issues.list", fn, h.opts)).resolves.toEqual(["issue"]);
    expect(fn).toHaveBeenCalledTimes(3);
    // Backoff actually happened — a retry that hammers with no wait cannot win,
    // because the competing dispatch has to settle first.
    expect(h.sleeps).toEqual([250, 500]);
  });

  it("rethrows a NON-scope error immediately — exactly one attempt, zero sleeps", async () => {
    // The mutation this pins down: retrying every error would still make the
    // test above pass, while silently multiplying real failures (and, on a write,
    // re-sending a call that may already have landed).
    const h = harness();
    const fn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(withScopeRetry("issues.create", fn, h.opts)).rejects.toThrow("ECONNRESET");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it("rethrows the scope error once the budget is spent, and warns", async () => {
    const h = harness();
    const warn = vi.fn();
    const fn = vi.fn().mockRejectedValue(scopeError());
    await expect(
      withScopeRetry("issues.list", fn, { ...h.opts, attempts: 3, logger: { warn } }),
    ).rejects.toThrow(/invocation scope/);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(h.sleeps).toEqual([250, 500]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("retry budget exhausted"),
      expect.objectContaining({ label: "issues.list", attempts: 3 }),
    );
  });

  it("logs a recovery line only when a retry was actually needed", async () => {
    const h = harness();
    const info = vi.fn();
    await withScopeRetry("issues.list", vi.fn().mockResolvedValue(1), { ...h.opts, logger: { info } });
    expect(info).not.toHaveBeenCalled();

    const fn = vi.fn().mockRejectedValueOnce(scopeError()).mockResolvedValue(1);
    await withScopeRetry("issues.list", fn, { ...h.opts, logger: { info } });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("recovered after invocation-scope retry"),
      expect.objectContaining({ label: "issues.list", attempt: 2, waitedMs: 250 }),
    );
  });

  it("caps the backoff and keeps the whole budget far under the 5-minute runJob timeout", async () => {
    const h = harness();
    const fn = vi.fn().mockRejectedValue(scopeError());
    await expect(withScopeRetry("issues.list", fn, h.opts)).rejects.toThrow(/invocation scope/);
    // Default schedule: 7 attempts, doubling from 250ms, capped at 8s.
    expect(fn).toHaveBeenCalledTimes(7);
    expect(h.sleeps).toEqual([250, 500, 1000, 2000, 4000, 8000]);
    const total = h.sleeps.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(60_000);
  });

  it("jitters the delays so two colliding scope-less jobs do not re-collide in lockstep", async () => {
    const low = harness();
    const high = harness();
    low.opts.random = () => 0;
    high.opts.random = () => 1;
    const opts = { attempts: 2 };
    await expect(withScopeRetry("a", vi.fn().mockRejectedValue(scopeError()), { ...opts, ...low.opts })).rejects.toThrow();
    await expect(withScopeRetry("a", vi.fn().mockRejectedValue(scopeError()), { ...opts, ...high.opts })).rejects.toThrow();
    expect(low.sleeps).toEqual([188]); // 250 * 0.75
    expect(high.sleeps).toEqual([313]); // 250 * 1.25
    expect(low.sleeps[0]).not.toBe(high.sleeps[0]);
  });
});

describe("worker.ts host-port wiring (static)", () => {
  // worker.ts calls runWorker() at module scope, so it cannot be imported in a
  // unit test. This guards the thing that actually matters: that no gated host
  // call is left outside withScopeRetry when someone adds a new port method.
  //
  // The check is count-based on purpose. A "is there a retry( somewhere nearby"
  // heuristic passes vacuously — the previous method's retry( is within any
  // sane lookbehind window — and was verified to NOT catch an unwrapped call.
  // Requiring `retry("label", () => ctx.X(` to immediately enclose every call
  // site does catch it.
  const src = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
  const RETRY_WRAP = String.raw`retry\(\s*"[^"]+",\s*\(\)\s*=>\s*`;

  it("routes every ctx.issues.* call through retry()", () => {
    const total = src.match(/ctx\.issues\.\w+\(/g) ?? [];
    const wrapped = src.match(new RegExp(RETRY_WRAP + String.raw`ctx\.issues\.\w+\(`, "g")) ?? [];
    expect(total.length).toBe(8); // the 8 host calls behind IssuePort
    expect(wrapped.length, "an unwrapped ctx.issues.* call would be rejected by the host mid-job").toBe(total.length);
  });

  it("routes every company-scoped ctx.state.* call through retry()", () => {
    // Only `scopeKind: "company"` state resolves to a company scope in the SDK's
    // requestedCompanyScope(), so only those two are gated; the issue-scoped pair
    // is intentionally left bare.
    const total = src.match(/ctx\.state\.(?:get|set)\(/g) ?? [];
    const wrapped = src.match(new RegExp(RETRY_WRAP + String.raw`ctx\.state\.(?:get|set)\(`, "g")) ?? [];
    expect(total.length).toBe(4);
    expect(wrapped.length).toBe(2);
    // And it is the company-scoped pair that is wrapped, not the issue-scoped one.
    for (const m of wrapped) {
      expect(m).toMatch(/drafted-version/);
    }
  });
});
