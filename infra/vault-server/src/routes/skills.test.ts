import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerSkillsRoute } from "./skills.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

describe("GET /skills", () => {
  beforeEach(() => resetStoreForTests());

  it("returns parsed skill frontmatter from wiki/Skills/", async () => {
    const app = Fastify();
    registerSkillsRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      wikiSubdir: "wiki",
      syncthingUrl: undefined,
      syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault",
    });

    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalRegistered).toBeGreaterThanOrEqual(1);
    const triage = body.skills.find((s: { name: string }) => s.name === "triage");
    expect(triage).toBeTruthy();
    expect(triage.description).toMatch(/Triage incoming/);
    expect(triage.triggers).toEqual(["inbox-add"]);
    expect(triage.usedBy).toEqual(["curator"]);
    expect(triage.path).toBe("wiki/Skills/triage.md");

    await app.close();
  });

  it("reads skill_name / skill_description written by the vault skills mirror", async () => {
    const app = Fastify();
    registerSkillsRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      wikiSubdir: "wiki",
      syncthingUrl: undefined,
      syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault",
    });

    const body = (await app.inject({ method: "GET", url: "/skills" })).json();
    const mirrored = body.skills.find((s: { name: string }) => s.name === "vault-style");
    expect(mirrored).toBeTruthy();
    expect(mirrored.description).toMatch(/skills-vault sync/);

    await app.close();
  });

  it("finds skills nested in domain subfolders (recursive walk)", async () => {
    const app = Fastify();
    registerSkillsRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      wikiSubdir: "wiki",
      syncthingUrl: undefined,
      syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault",
    });

    const res = await app.inject({ method: "GET", url: "/skills" });
    const body = res.json();
    const nested = body.skills.find(
      (s: { name: string }) => s.name === "nested-skill",
    );
    expect(nested).toBeTruthy();
    expect(nested.path).toBe("wiki/Skills/Software/nested-skill.md");

    await app.close();
  });

  it("defaults triggers/usedBy to [] when frontmatter omits them", async () => {
    const app = Fastify();
    registerSkillsRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      wikiSubdir: "wiki",
      syncthingUrl: undefined,
      syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault",
    });

    const res = await app.inject({ method: "GET", url: "/skills" });
    const body = res.json();
    const bare = body.skills.find((s: { name: string }) => s.name === "bare");
    expect(bare).toBeTruthy();
    expect(bare.triggers).toEqual([]);
    expect(bare.usedBy).toEqual([]);

    await app.close();
  });

  it("defaults the wiki subdir to 'wiki' when unset", async () => {
    const app = Fastify();
    registerSkillsRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      syncthingUrl: undefined,
      syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault",
    });

    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(200);
    expect(res.json().totalRegistered).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it("returns an empty list when the skills directory is missing", async () => {
    const app = Fastify();
    registerSkillsRoute(app, {
      port: 7777,
      vaultRoot: "/nonexistent",
      wikiSubdir: "wiki",
      syncthingUrl: undefined,
      syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault",
    });

    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ totalRegistered: 0, skills: [] });

    await app.close();
  });
});
