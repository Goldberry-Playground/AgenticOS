import { describe, it, expect } from "vitest";
import { SweepGate } from "../src/sweep-gate.js";

/** A promise you resolve by hand, so the test controls when each "sweep" ends. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("SweepGate", () => {
  it("runs a lone sweep immediately and returns its result", async () => {
    const gate = new SweepGate();
    await expect(gate.run(async () => 42)).resolves.toEqual({ outcome: "ran", result: 42 });
    expect(gate.busy).toBe(false);
  });

  it("serialises an overlapping sweep behind the running one instead of interleaving", async () => {
    const gate = new SweepGate();
    const order: string[] = [];
    const first = deferred();
    const p1 = gate.run(async () => {
      order.push("1:start");
      await first.promise;
      order.push("1:end");
      return 1;
    });
    await tick();
    const p2 = gate.run(async () => {
      order.push("2:start");
      return 2;
    });
    await tick();
    // The second must NOT have started while the first is still in flight.
    expect(order).toEqual(["1:start"]);
    first.resolve();
    await expect(p1).resolves.toEqual({ outcome: "ran", result: 1 });
    await expect(p2).resolves.toEqual({ outcome: "ran", result: 2 });
    expect(order).toEqual(["1:start", "1:end", "2:start"]);
  });

  it("coalesces a third request while one runs and one waits — it is covered by the waiter", async () => {
    const gate = new SweepGate();
    const first = deferred();
    let runs = 0;
    const p1 = gate.run(async () => {
      runs++;
      await first.promise;
    });
    await tick();
    const p2 = gate.run(async () => {
      runs++;
    });
    const p3 = gate.run(async () => {
      runs++;
    });
    await expect(p3).resolves.toEqual({ outcome: "coalesced" });
    first.resolve();
    await p1;
    await p2;
    expect(runs).toBe(2);
    expect(gate.busy).toBe(false);
  });

  it("keeps queuing after a sweep fails: the error goes to its caller, the chain stays usable", async () => {
    const gate = new SweepGate();
    const first = deferred();
    const p1 = gate.run(async () => {
      await first.promise;
    });
    await tick();
    // The exact shape GOL-3352 is about: a scheduled tick spinning in its scope
    // retry, about to fail, while an event sweep arrives. The event sweep must
    // run AFTER the failure, not be dropped because something was "already running".
    const p2 = gate.run(async () => "covered");
    first.reject(new Error("invocation scope denied"));
    await expect(p1).rejects.toThrow("invocation scope denied");
    await expect(p2).resolves.toEqual({ outcome: "ran", result: "covered" });
    await expect(gate.run(async () => "later")).resolves.toEqual({ outcome: "ran", result: "later" });
  });
});
