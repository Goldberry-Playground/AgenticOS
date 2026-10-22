import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPageWriteRoute } from "./page-write.js";

let tmp: string;
const cfg = () => ({ vaultRoot: tmp, wikiSubdir: "wiki" }) as any;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vs-pagewrite-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("PUT /page", () => {
  it("writes content under wiki/_meta and returns the path", async () => {
    const app = Fastify();
    registerPageWriteRoute(app, cfg());
    const res = await app.inject({
      method: "PUT",
      url: "/page",
      payload: { path: "wiki/_meta/dev-pr-digest.md", content: "# Digest\n" },
    });
    expect(res.statusCode).toBe(200);
    const written = await fs.readFile(
      path.join(tmp, "wiki/_meta/dev-pr-digest.md"),
      "utf8",
    );
    expect(written).toBe("# Digest\n");
  });

  it("rejects path traversal", async () => {
    const app = Fastify();
    registerPageWriteRoute(app, cfg());
    const res = await app.inject({
      method: "PUT",
      url: "/page",
      payload: { path: "wiki/_meta/../../escape.md", content: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects path containing a null byte", async () => {
    const app = Fastify();
    registerPageWriteRoute(app, cfg());
    const res = await app.inject({
      method: "PUT",
      url: "/page",
      payload: { path: "wiki/_meta/x\0.md", content: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects writes outside the allowed subtree", async () => {
    const app = Fastify();
    registerPageWriteRoute(app, cfg());
    const res = await app.inject({
      method: "PUT",
      url: "/page",
      payload: { path: "wiki/Software/note.md", content: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a path that resolves to the allowed root itself", async () => {
    const app = Fastify();
    registerPageWriteRoute(app, cfg());
    const res = await app.inject({
      method: "PUT",
      url: "/page",
      payload: { path: "wiki/_meta/", content: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});
