import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerStatsRoute } from "./stats.js";
import { resetStoreForTests } from "../lib/vault-store.js";
import type { Config } from "../config.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

const config: Config = {
  port: 7777,
  vaultRoot: fixtureRoot,
  syncthingUrl: undefined,
  syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault",
};

describe("GET /stats", () => {
  beforeEach(() => {
    resetStoreForTests();
  });

  it("reports the real page count after building the index", async () => {
    const app = Fastify();
    registerStatsRoute(app, config);

    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Fixture wiki/ has HELLO.md + farming/notes.md + the skills pages under
    // wiki/Skills/ (triage.md, bare.md, vault-style-skill.md,
    // Software/nested-skill.md). Skills live under the wiki subtree, so the
    // store's page index counts them too.
    expect(body.pageCount).toBe(6);
    expect(typeof body.builtAt).toBe("number");
    expect(body.builtAt).toBeGreaterThan(0);

    await app.close();
  });
});
