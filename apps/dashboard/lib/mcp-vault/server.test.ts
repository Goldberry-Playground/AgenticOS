import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_VAULT_TOOLS } from "./tools";
import { resetMcpServerForTests, startMcpServer } from "./server";
import { DEFAULT_MCP_PORT, DEFAULT_MCP_SERVER_URL, resolveMcpPort } from "./port";
import { DEFAULT_CONFIG } from "@/lib/config/schema";

describe("MCP vault tool registry", () => {
  it("contains exactly 11 tools", () => {
    expect(MCP_VAULT_TOOLS).toHaveLength(11);
  });

  it("each tool has a unique name", () => {
    const names = MCP_VAULT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("each tool has a valid proxy target", () => {
    for (const tool of MCP_VAULT_TOOLS) {
      expect(["GET", "POST"]).toContain(tool.proxyTo.method);
      expect(tool.proxyTo.path).toMatch(/^\/api\//);
    }
  });

  it("the 9 Curator-whitelisted tools are all present", () => {
    const allowed = [
      "vault.page.read", "vault.tree.list", "vault.search", "vault.backlinks",
      "vault.inbox.list", "vault.inbox.item", "vault.inbox.commit",
      "vault.inbox.discard", "lint.run",
    ];
    for (const name of allowed) {
      expect(MCP_VAULT_TOOLS.find((t) => t.name === name)).toBeDefined();
    }
  });
});

/**
 * GOL-3060: a second dashboard on one box used to hang every HTTP request
 * forever. `server.listen()` reports EADDRINUSE as an async `error` event, and
 * the old boot only ever resolved from the `listening` callback — so on a busy
 * port the promise never settled, `register()` never returned, and Next never
 * started serving. These tests pin the two properties that matter: the boot
 * always settles, and a busy port degrades instead of taking the app down.
 */
describe("MCP vault server boot (double-boot)", () => {
  const BOOT_TIMEOUT = 5_000;
  let warnings: string[] = [];

  beforeEach(() => {
    warnings = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetMcpServerForTests();
  });

  it("binds a free port on first boot and reports the bound port", async () => {
    // Port 0 = let the OS pick a free one, so the test never collides with a
    // real dashboard already running on this host.
    const first = await startMcpServer(0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.port).toBeGreaterThan(0);
    await first.close();
  });

  it("settles (does not hang) and degrades when the port is already in use", async () => {
    const first = await startMcpServer(0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    try {
      // The assertion is as much about *terminating* as about the value: before
      // the fix this promise never settled and the test would time out.
      const second = await Promise.race([
        startMcpServer(first.port),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), BOOT_TIMEOUT)),
      ]);

      expect(second).not.toBe("timeout");
      expect(second).toMatchObject({ ok: false, reason: "port-in-use", port: first.port });

      // One clear degraded-mode line, naming the port and the way out.
      const logged = warnings.join("\n");
      expect(logged).toContain("MCP vault server DISABLED");
      expect(logged).toContain(String(first.port));
      expect(logged).toContain("AGENTICOS_MCP_PORT");
    } finally {
      await first.close();
    }
  });

  it("leaves the first instance serving after the second one fails to bind", async () => {
    const first = await startMcpServer(0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    try {
      const second = await startMcpServer(first.port);
      expect(second.ok).toBe(false);

      // The collision must not have knocked over the healthy bridge.
      const res = await fetch(`http://127.0.0.1:${first.port}/tools`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tools: unknown[] };
      expect(body.tools).toHaveLength(MCP_VAULT_TOOLS.length);
    } finally {
      await first.close();
    }
  });
});

describe("resolveMcpPort", () => {
  it("defaults to 7610 when unset or blank", () => {
    expect(resolveMcpPort({})).toBe(DEFAULT_MCP_PORT);
    expect(resolveMcpPort({ AGENTICOS_MCP_PORT: "   " })).toBe(DEFAULT_MCP_PORT);
  });

  it("honors a valid override so two dashboards can coexist", () => {
    expect(resolveMcpPort({ AGENTICOS_MCP_PORT: "7611" })).toBe(7611);
    expect(resolveMcpPort({ AGENTICOS_MCP_PORT: "0" })).toBe(0);
  });

  it("falls back to the default on a malformed value rather than failing boot", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["abc", "-1", "70000", "7610.5", ""]) {
      expect(resolveMcpPort({ AGENTICOS_MCP_PORT: bad })).toBe(DEFAULT_MCP_PORT);
    }
    warnSpy.mockRestore();
  });

  it("keeps the config default URL in step with the port", () => {
    expect(DEFAULT_MCP_SERVER_URL).toBe(`http://127.0.0.1:${DEFAULT_MCP_PORT}`);
    expect(DEFAULT_CONFIG.mcpServerUrl).toBe(DEFAULT_MCP_SERVER_URL);
  });
});
