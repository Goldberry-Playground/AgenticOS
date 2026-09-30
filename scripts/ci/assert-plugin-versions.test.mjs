// assert-plugin-versions.test.mjs — GOL-2686 / GOL-2496 / GOL-804
//
// Offline harness for scripts/assert-plugin-versions.mjs. No droplet, no board
// key, no 1Password: a throwaway localhost HTTP server plays the role of the
// paperclip API and decides, per request, whether to refuse, 5xx, serve a stale
// registry, or serve a converged one.
//
// The behaviours the plugins deploy depends on:
//   1. converged on the first sample        -> exit 0, cheap
//   2. API refusing at first, then serving  -> exit 0 (GOL-2686: the step ahead
//      force-recreated paperclip-server, so :3100 is still binding)
//   3. API 5xx at first, then serving       -> exit 0 (half-booted server)
//   4. API never answers                    -> exit 1, and the message names the
//      base URL + the underlying cause, NOT the bare undici `fetch failed` that
//      was run 36662917269's entire diagnosis
//   5. genuine version drift that never settles -> exit 1 with DRIFT (the GOL-804
//      hard gate must still bite; making transport errors retryable must not
//      have made anything else retryable-forever)
//   6. a transport blip must not be reportable as convergence -> a run whose
//      LAST sample fails must never exit 0 on the strength of an earlier one
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "assert-plugin-versions.mjs");
const KEY = "agenticos.github-sync-plugin";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) return console.log(`  ok   ${name}`);
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};

const body = (version, status = "ready") =>
  JSON.stringify([{ pluginKey: KEY, version, status, packagePath: "/paperclip/plugins/github-sync-plugin" }]);

// `plan` is consumed one entry per request: "refuse" closes the socket (the
// closest in-process stand-in for ECONNREFUSED), a number is an HTTP status with
// no useful body, and a string is a version served 200. Once the plan is spent
// the last entry repeats, so "never converges" needs no unbounded array.
function serve(plan) {
  const seen = [];
  const server = createServer((req, res) => {
    const step = plan[Math.min(seen.length, plan.length - 1)];
    seen.push(step);
    if (step === "refuse") return req.socket.destroy();
    if (typeof step === "number") {
      res.writeHead(step, { "content-type": "text/plain" });
      return res.end("boot in progress");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body(step));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, seen, port: server.address().port }),
    );
  });
}

// A port nothing is listening on: bind one, learn its number, then release it.
// Guessing a low port instead (e.g. 1) makes undici reject with `bad port` rather
// than a real connection refusal, which would not exercise the path we care about.
async function deadPort() {
  const { server, port } = await serve([]);
  await new Promise((r) => server.close(r));
  return port;
}

// Run the script against a base URL. `down: true` means never start a server at
// all, so the port is genuinely refusing for the whole run.
function run({ plan, expect = "0.16.9", timeoutMs = 2000, pollMs = 50, down = false }) {
  return (async () => {
    const s = down ? null : await serve(plan);
    const port = down ? await deadPort() : s.port;
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        PAPERCLIP_BASE: `http://127.0.0.1:${port}`,
        BOARD_KEY: "test-key",
        EXPECT: `${KEY}=${expect}`,
        PENDING: "",
        ASSERT_TIMEOUT_MS: String(timeoutMs),
        ASSERT_POLL_MS: String(pollMs),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const code = await new Promise((r) => child.on("close", r));
    if (s) await new Promise((r) => s.server.close(r));
    return { code, out, requests: s ? s.seen.length : 0 };
  })();
}

console.log("assert-plugin-versions.test.mjs");

// 1 — happy path stays a single cheap sample.
{
  const r = await run({ plan: ["0.16.9"] });
  check("converged on first sample exits 0", r.code === 0, `code=${r.code} out=${r.out}`);
  check("converged costs exactly one request", r.requests === 1, `requests=${r.requests}`);
}

// 2 — the regression this test exists for: refused, then serving.
{
  const r = await run({ plan: ["refuse", "refuse", "0.16.9"] });
  check("refused-then-serving exits 0 (GOL-2686)", r.code === 0, `code=${r.code} out=${r.out}`);
  check("refused-then-serving retried", r.requests >= 3, `requests=${r.requests}`);
}

// 3 — a half-booted server 5xxing must read as "not ready", not as a hard error.
{
  const r = await run({ plan: [503, 502, "0.16.9"] });
  check("5xx-then-serving exits 0", r.code === 0, `code=${r.code} out=${r.out}`);
}

// 4 — never answers: RED, and the message must be actionable.
{
  const r = await run({ down: true, timeoutMs: 600, pollMs: 50 });
  check("never-answers exits nonzero", r.code !== 0, `code=${r.code}`);
  check("never-answers names the base URL", /127\.0\.0\.1:\d+\/api\/plugins/.test(r.out), r.out);
  check(
    "never-answers names the underlying cause, not just 'fetch failed'",
    /ECONNREFUSED|EACCES|ERR_|refused/i.test(r.out),
    r.out,
  );
  check(
    "never-answers is reported as unverifiable, not as drift",
    /could NOT be verified/.test(r.out) && !/DRIFT/.test(r.out),
    r.out,
  );
}

// 5 — the GOL-804 hard gate still bites on real, persistent drift.
{
  const r = await run({ plan: ["0.16.8"], expect: "0.16.9", timeoutMs: 400, pollMs: 50 });
  check("persistent version drift exits nonzero", r.code !== 0, `code=${r.code}`);
  check("persistent version drift reports DRIFT", /DRIFT/.test(r.out), r.out);
  check("drift message names both versions", /0\.16\.8/.test(r.out) && /0\.16\.9/.test(r.out), r.out);
}

// 6 — converged, then the API drops. The final reading is a failure, so the run
// must NOT exit 0 on the earlier good sample. (Guards the stale-`res` hazard the
// transport retry introduces: `res` is cleared on every caught error.)
{
  const r = await run({ plan: ["0.16.8", "refuse"], expect: "0.16.9", timeoutMs: 400, pollMs: 50 });
  check("a failing last sample never reports convergence", r.code !== 0, `code=${r.code} out=${r.out}`);
  check("a failing last sample is not reported as converged", !/all 1 converged/.test(r.out), r.out);
}

if (failures) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall assertions passed");
