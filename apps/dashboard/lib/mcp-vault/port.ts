/**
 * Port resolution for the vault MCP bridge.
 *
 * Deliberately free of `server-only` and of any Node-only import so that
 * `lib/config/schema.ts` — which is pulled into the client bundle — can share
 * the default without duplicating the literal. Before GOL-3060 the port was a
 * bare `const PORT = 7610` in `server.ts` and the same literal was typed out
 * twice more in `schema.ts`; three copies with nothing keeping them in step.
 */

export const DEFAULT_MCP_PORT = 7610;

/** Default value for the `mcpServerUrl` config field. */
export const DEFAULT_MCP_SERVER_URL = `http://127.0.0.1:${DEFAULT_MCP_PORT}`;

/**
 * Resolve the port the bridge should bind, honoring `AGENTICOS_MCP_PORT`.
 *
 * An override lets two dashboards share a box — the hard-coded 7610 is why a
 * second instance used to collide (GOL-3060). A malformed value falls back to
 * the default rather than throwing: boot must never fail on a typo in an env
 * var for an auxiliary bridge.
 *
 * `0` is allowed and means "any free port" (useful in tests).
 */
export function resolveMcpPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AGENTICOS_MCP_PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MCP_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.warn(
      `AGENTICOS_MCP_PORT="${raw}" is not a valid port (expected an integer 0-65535); ` +
        `falling back to ${DEFAULT_MCP_PORT}.`,
    );
    return DEFAULT_MCP_PORT;
  }
  return port;
}
