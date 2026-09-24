import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Boot-scope invariant (GOL-2371, AC: "no unguarded execSync at module/boot
 * scope"). The GOL-2279 outage was a boot-time `child_process` execSync that
 * threw and killed the worker for ~5 days. A synchronous, unguarded child-process
 * call at module load / setup scope is the exact hazard, so guard against a
 * regression re-introducing one anywhere in the plugin's source.
 */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function srcFiles(): string[] {
  return readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(srcDir, f));
}

describe("worker boot-scope hardening", () => {
  it("no plugin source imports child_process or calls execSync/spawnSync", () => {
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      // Scan code only: comments legitimately cite the 2026-09-09 execSync incident.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      if (/child_process|execSync|spawnSync/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("worker.ts runs a single top-level side effect (runWorker) — everything else is a def", () => {
    const text = readFileSync(join(srcDir, "worker.ts"), "utf8");
    // Exactly one runWorker(...) call, and it is the last statement.
    const runWorkerCalls = text.match(/^runWorker\(/gm) ?? [];
    expect(runWorkerCalls.length).toBe(1);
    expect(text.trimEnd().endsWith("runWorker(plugin, import.meta.url);")).toBe(true);
  });

  it("setup delegates init to bootWithRetry (never a bare throw out of setup)", () => {
    const text = readFileSync(join(srcDir, "worker.ts"), "utf8");
    expect(text).toMatch(/await bootWithRetry\(/);
  });
});
