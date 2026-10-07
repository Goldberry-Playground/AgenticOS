/**
 * Next awaits `register()` before it will serve a single request, so anything
 * in here that rejects — or worse, never settles — parks the whole dashboard
 * in a silent hang: the process logs `✓ Ready`, stays alive, and every HTTP
 * request waits forever (GOL-3060).
 *
 * So boot of the auxiliary services is best-effort by construction: settle
 * every task, log the failures, and always return. Neither the scheduler nor
 * the vault MCP bridge is needed to render a page.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { bootScheduler } = await import("@/lib/scheduler/scheduler");
    const { bootMcpServer } = await import("@/lib/mcp-vault/server");

    // allSettled, not all: `all` rejects as soon as either task does, which
    // escapes `register()` and leaves Next without a serving signal.
    const tasks: [string, Promise<unknown>][] = [
      ["scheduler", bootScheduler()],
      ["vault MCP bridge", bootMcpServer()],
    ];
    const results = await Promise.allSettled(tasks.map(([, p]) => p));

    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.error(
          `AgenticOS boot: ${tasks[i][0]} failed to start; continuing in degraded mode.`,
          result.reason,
        );
      }
    });
  } catch (err) {
    // A failed dynamic import would otherwise reject `register()` itself.
    console.error("AgenticOS boot: instrumentation failed; continuing in degraded mode.", err);
  }
}
