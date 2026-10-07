import "server-only";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { MCP_VAULT_TOOLS } from "./tools";
import { DEFAULT_MCP_PORT, resolveMcpPort } from "./port";
import type { McpToolDef } from "./types";

const DASHBOARD_BASE = process.env.AGENTICOS_DASHBOARD_BASE ?? "http://127.0.0.1:3000";

/**
 * Outcome of a bridge boot attempt.
 *
 * `ok: false` is a normal, survivable outcome — see {@link startMcpServer}.
 */
export type McpBootResult =
  | { ok: true; port: number; close: () => Promise<void> }
  | { ok: false; port: number; reason: "port-in-use" | "listen-failed"; error: Error };

let booting: Promise<McpBootResult> | null = null;

/**
 * Boot the vault MCP bridge once per process.
 *
 * Returns a result instead of throwing, and never leaves its promise pending.
 * `instrumentation.ts` awaits this before Next will serve a single request, so
 * a promise that never settles here parks the entire dashboard in a silent
 * hang (GOL-3060) — no 500, no crash, just requests that never return.
 */
export function bootMcpServer(): Promise<McpBootResult> {
  booting ??= startMcpServer(resolveMcpPort());
  return booting;
}

/**
 * Bind the bridge to `port` on loopback.
 *
 * The promise settles on `listening` **or** on `error`. Listening for `error`
 * is the whole fix: `server.listen()` reports `EADDRINUSE` asynchronously as an
 * `error` event, so a listen whose only continuation is the `listening`
 * callback hangs forever on a busy port — and, with no `error` listener
 * attached, also throws an `uncaughtException` on the way past.
 *
 * A failed bind degrades rather than propagating. The bridge is auxiliary: the
 * dashboard renders fine without it (`mcpServerUrl` is only a client config
 * value), so losing it must not cost us the web server.
 *
 * Exported for the double-boot test; app code should call
 * {@link bootMcpServer}.
 */
export function startMcpServer(port: number): Promise<McpBootResult> {
  const server = createServer(handleRequest);

  return new Promise<McpBootResult>((resolve) => {
    const onError = (err: Error & { code?: string }) => {
      server.removeListener("listening", onListening);
      server.close();

      const reason = err.code === "EADDRINUSE" ? "port-in-use" : "listen-failed";
      if (reason === "port-in-use") {
        console.warn(
          `MCP vault server DISABLED (degraded mode): 127.0.0.1:${port} is already in use. ` +
            `The dashboard will serve normally; vault MCP tools are unavailable in this instance. ` +
            `Set AGENTICOS_MCP_PORT to a free port to run a second dashboard on this host.`,
        );
      } else {
        console.error(
          `MCP vault server DISABLED (degraded mode): failed to bind 127.0.0.1:${port}. ` +
            `The dashboard will serve normally; vault MCP tools are unavailable in this instance.`,
          err,
        );
      }
      resolve({ ok: false, port, reason, error: err });
    };

    const onListening = () => {
      server.removeListener("error", onError);
      // Keep an `error` handler attached for the server's whole life. Without
      // one, any post-listen socket error is an unhandled 'error' event, which
      // Node escalates to an uncaughtException.
      server.on("error", (err) => {
        console.error(`MCP vault server error on 127.0.0.1:${port}:`, err);
      });

      const bound = actualPort(server) ?? port;
      console.log(`MCP vault server listening on 127.0.0.1:${bound}`);
      if (bound !== DEFAULT_MCP_PORT) {
        console.log(
          `MCP vault server is NOT on the default port ${DEFAULT_MCP_PORT}; ` +
            `point config \`mcpServerUrl\` at http://127.0.0.1:${bound} for clients to reach it.`,
        );
      }
      resolve({ ok: true, port: bound, close: () => closeServer(server) });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function actualPort(server: Server): number | null {
  const addr = server.address();
  return addr && typeof addr === "object" ? addr.port : null;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Test seam: drop the once-per-process memo so a fresh boot can be observed. */
export function resetMcpServerForTests(): void {
  booting = null;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === "/tools" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ tools: MCP_VAULT_TOOLS.map(serializeTool) }));
    return;
  }
  if (req.url === "/invoke" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { name, args } = JSON.parse(body) as { name: string; args: Record<string, unknown> };
      const tool = MCP_VAULT_TOOLS.find((t) => t.name === name);
      if (!tool) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown tool: ${name}` }));
        return;
      }
      const result = await invokeProxy(tool, args);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
}

function serializeTool(tool: McpToolDef) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

async function invokeProxy(tool: McpToolDef, args: Record<string, unknown>): Promise<unknown> {
  const { method, path: routePath, query } = tool.proxyTo;
  const url = new URL(routePath, DASHBOARD_BASE);
  if (query && method === "GET") {
    for (const key of query) {
      const v = args[key];
      if (v === undefined || v === null) continue;
      url.searchParams.set(key, Array.isArray(v) ? v.join(",") : String(v));
    }
  }
  const init: RequestInit = { method };
  if (method === "POST") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(args);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Proxy ${routePath} returned ${res.status}`);
  return await res.json();
}
