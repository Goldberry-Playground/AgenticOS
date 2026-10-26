import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";

/** Only this subtree may be written by plugins (generated artifacts). */
const ALLOWED_PREFIX = "wiki/_meta/";

interface Body {
  path?: string;
  content?: string;
}

export function registerPageWriteRoute(app: FastifyInstance, config: Config): void {
  app.put("/page", async (req, reply) => {
    const { path: relPath, content } = (req.body ?? {}) as Body;
    if (typeof relPath !== "string" || typeof content !== "string") {
      return reply.code(400).send({ error: "path and content are required" });
    }
    // Reject traversal on the RAW path (before normalize collapses `..`).
    if (relPath.split("/").some((seg) => seg === "..")) {
      return reply.code(400).send({ error: "invalid path" });
    }
    // Reject null bytes and CRLF characters that bypass fs checks or split paths.
    if (relPath.includes("\0") || /[\r\n]/.test(relPath)) {
      return reply.code(400).send({ error: "invalid path" });
    }
    const normalized = path.posix.normalize(relPath);
    if (!normalized.startsWith(ALLOWED_PREFIX)) {
      return reply
        .code(403)
        .send({ error: `writes restricted to ${ALLOWED_PREFIX}` });
    }
    // Containment check on the RESOLVED path, so the sink is provably inside
    // the allowed subtree (also what CodeQL's js/path-injection recognises).
    const allowedRoot = path.resolve(config.vaultRoot, ALLOWED_PREFIX);
    const abs = path.resolve(config.vaultRoot, normalized);
    if (!abs.startsWith(allowedRoot + path.sep)) {
      return reply
        .code(403)
        .send({ error: `writes restricted to ${ALLOWED_PREFIX}` });
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Atomic write + world-readable (the soak's permission lesson).
    const tmp = `${abs}.tmp`;
    await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o644 });
    await fs.rename(tmp, abs);
    await fs.chmod(abs, 0o644);
    return reply.code(200).send({ path: normalized });
  });
}
