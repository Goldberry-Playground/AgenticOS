import { describe, it, expect, afterEach } from "vitest";
import { dataSource } from "./data-source";

describe("dataSource()", () => {
  const originalValue = process.env.DASHBOARD_DATA_SOURCE;

  afterEach(() => {
    // Restore the original env var state after each test.
    if (originalValue === undefined) {
      delete process.env.DASHBOARD_DATA_SOURCE;
    } else {
      process.env.DASHBOARD_DATA_SOURCE = originalValue;
    }
  });

  it('returns "hermes" when DASHBOARD_DATA_SOURCE is unset', () => {
    delete process.env.DASHBOARD_DATA_SOURCE;
    expect(dataSource()).toBe("hermes");
  });

  it('returns "hermes" when DASHBOARD_DATA_SOURCE is "hermes"', () => {
    process.env.DASHBOARD_DATA_SOURCE = "hermes";
    expect(dataSource()).toBe("hermes");
  });

  it('returns "hermes" when DASHBOARD_DATA_SOURCE is some other value', () => {
    process.env.DASHBOARD_DATA_SOURCE = "x";
    expect(dataSource()).toBe("hermes");
  });

  it('returns "paperclip" when DASHBOARD_DATA_SOURCE is exactly "paperclip"', () => {
    process.env.DASHBOARD_DATA_SOURCE = "paperclip";
    expect(dataSource()).toBe("paperclip");
  });
});
