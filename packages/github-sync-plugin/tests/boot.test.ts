import { describe, it, expect, vi } from "vitest";
import { bootWithRetry, type BootLogger } from "../src/boot.js";

function fakeLogger(): BootLogger & { warns: number; errors: number } {
  return {
    warns: 0,
    errors: 0,
    warn() {
      this.warns++;
    },
    error() {
      this.errors++;
    },
  };
}

describe("bootWithRetry", () => {
  it("returns immediately when init succeeds on the first attempt", async () => {
    const logger = fakeLogger();
    const init = vi.fn(async () => {});
    const sleep = vi.fn(async () => {});
    await bootWithRetry(init, { logger, sleep });
    expect(init).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logger.warns).toBe(0);
    expect(logger.errors).toBe(0);
  });

  it("retries with exponential backoff and recovers when a later attempt succeeds", async () => {
    const logger = fakeLogger();
    let calls = 0;
    const init = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error(`boot blip ${calls}`);
    });
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    await bootWithRetry(init, { logger, baseDelayMs: 1000, sleep });

    expect(init).toHaveBeenCalledTimes(3); // failed, failed, succeeded
    expect(delays).toEqual([1000, 2000]); // backoff doubled between the two failures
    expect(logger.warns).toBe(2); // one warn per failed-then-retried attempt
    expect(logger.errors).toBe(0); // never exhausted
  });

  it("does NOT throw when every attempt fails, and pages via onExhausted once", async () => {
    const logger = fakeLogger();
    const init = vi.fn(async () => {
      throw new Error("execSync crash at boot");
    });
    const sleep = vi.fn(async () => {});
    const onExhausted = vi.fn(async () => {});

    // The core guarantee: a fatal boot never rethrows out of setup (GOL-2279).
    await expect(
      bootWithRetry(init, { logger, maxAttempts: 4, sleep, onExhausted }),
    ).resolves.toBeUndefined();

    expect(init).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3); // backoff before attempts 2,3,4 (not after the last)
    expect(logger.errors).toBe(1);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted.mock.calls[0]?.[1]).toBe(4); // attempts count passed through
  });

  it("swallows an onExhausted failure — paging is best-effort, never fatal", async () => {
    const logger = fakeLogger();
    const init = vi.fn(async () => {
      throw new Error("dead");
    });
    const onExhausted = vi.fn(async () => {
      throw new Error("ops webhook unreachable");
    });
    await expect(
      bootWithRetry(init, { logger, maxAttempts: 1, sleep: async () => {}, onExhausted }),
    ).resolves.toBeUndefined();
    expect(logger.errors).toBe(1);
  });
});
