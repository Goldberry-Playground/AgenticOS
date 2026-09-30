import { describe, it, expect } from "vitest";
import manifest from "../src/manifest.js";

// Regression guard (2026-09-30): the Odoo product form promises the requester
// "the drafter polls every 15 min; expect a draft within ~20 min". The request
// job used to be nightly (`0 7 * * *`), so a click sat up to a day with nothing
// on the board. Keep the request cadence within that promise.

function job(key: string) {
  const found = (manifest.jobs ?? []).find((j) => j.jobKey === key);
  if (!found) throw new Error(`job ${key} missing from manifest`);
  return found;
}

/** Minutes between runs for a `*\/N * * * *` schedule; null for anything else. */
function everyNMinutes(schedule: string): number | null {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(schedule.trim());
  return m ? Number(m[1]) : null;
}

describe("grove-content-drafter manifest schedules", () => {
  it("opens draft requests at least every 15 minutes (matches the Odoo form's promise)", () => {
    const minutes = everyNMinutes(job("content-draft-request").schedule);
    expect(minutes).not.toBeNull();
    expect(minutes!).toBeLessThanOrEqual(15);
  });

  it("keeps the reply sweep frequent too, so a draft lands within ~20 min of the reply", () => {
    const minutes = everyNMinutes(job("content-draft-sweep").schedule);
    expect(minutes).not.toBeNull();
    expect(minutes!).toBeLessThanOrEqual(20);
  });
});
