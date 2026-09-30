// test-assert-plugin-versions.mjs — GOL-804 unit test
//
// Proves assert-plugin-versions.mjs, against a mock board API:
//   1. passes when every expected plugin is installed at the built version + healthy,
//   2. FAILS (nonzero) when any plugin's registry version != built version
//      (the GOL-804 stale-deploy signal), and names the drift,
//   3. FAILS when an expected plugin is not installed,
//   4. FAILS when a plugin is at the right version but unhealthy (a crash),
//   4b. PASSES (soft WARN, GOL-1276) when the only unhealthy plugin is
//       installed-but-unconfigured (lastError = "…config missing…"),
//   4c. FAILS that same case under STRICT_HEALTH=1,
//   5. no-ops (exit 0) when EXPECT is empty,
//   6. SKIPS a PENDING plugin that is not installed yet (GOL-2423), and
//   6b. FAILS when a PENDING plugin turns out to BE installed — the inversion
//       that stops the holding state outliving the install it waits on.
//
// Run: node scripts/test-assert-plugin-versions.mjs
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "assert-plugin-versions.mjs");

// registry: array of {key, version, status}
function makeServer(registry) {
  const srv = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/plugins") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          plugins: registry.map((p) => ({
            id: p.key,
            pluginKey: p.key,
            version: p.version,
            status: p.status || "ready",
            lastError: p.lastError ?? null,
            packagePath: "/paperclip/staged-plugins/" + p.key,
          })),
        }),
      );
    }
    res.writeHead(404).end();
  });
  return srv;
}

function run(base, expect, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TARGET], {
      env: {
        // Default the poll off so the pre-existing drift cases stay instant;
        // the GOL-2496 cases below opt back in explicitly via extraEnv.
        ASSERT_TIMEOUT_MS: "0",
        ASSERT_POLL_MS: "10",
        ...process.env,
        PAPERCLIP_BASE: base,
        BOARD_KEY: "k",
        EXPECT: expect,
        ...extraEnv,
      },
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

async function withServer(registry, fn) {
  const srv = makeServer(registry);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  try {
    return await fn(base);
  } finally {
    srv.close();
  }
}

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log("  ok  - " + name);
  else { failures += 1; console.log("  FAIL- " + name + (detail ? " :: " + detail : "")); }
};

const REG = [
  { key: "agenticos.github-sync-plugin", version: "0.11.6" },
  { key: "agenticos.vault-plugin", version: "0.4.2" },
];

// 1) all converged => exit 0
await withServer(REG, async (base) => {
  const r = await run(base, "agenticos.github-sync-plugin=0.11.6 agenticos.vault-plugin=0.4.2");
  check("all converged, exit 0", r.code === 0, r.err || r.out);
  check("reports all converged", /all 2 converged/.test(r.out), r.out.trim());
});

// 2) one drifted (registry 0.11.6, built 0.11.7) => FAIL, names drift
await withServer(REG, async (base) => {
  const r = await run(base, "agenticos.github-sync-plugin=0.11.7 agenticos.vault-plugin=0.4.2");
  check("drift fails nonzero", r.code !== 0, "code=" + r.code);
  check("drift error names registry vs built", /registry 0\.11\.6 != built 0\.11\.7/.test(r.err), r.err.trim());
});

// 3) expected plugin not installed => FAIL
await withServer(REG, async (base) => {
  const r = await run(base, "agenticos.github-plugin=1.0.0");
  check("not-installed fails nonzero", r.code !== 0, "code=" + r.code);
  check("not-installed named", /NOT INSTALLED/.test(r.err), r.err.trim());
});

// 4) right version, unhealthy (a real crash, no config-missing lastError) => FAIL
await withServer(
  [{ key: "agenticos.github-sync-plugin", version: "0.11.6", status: "error",
     lastError: "TypeError: Cannot read properties of undefined" }],
  async (base) => {
    const r = await run(base, "agenticos.github-sync-plugin=0.11.6");
    check("crash unhealthy fails nonzero", r.code !== 0, "code=" + r.code);
    check("crash unhealthy named", /UNHEALTHY/.test(r.err), r.err.trim());
  },
);

// 4b) right version, unhealthy ONLY because config isn't wired => soft WARN, exit 0
await withServer(
  [{ key: "agenticos.discord-plugin", version: "0.2.0", status: "error",
     lastError: "Activation failed: Worker initialize failed: discord-plugin config missing: discordBotToken" }],
  async (base) => {
    const r = await run(base, "agenticos.discord-plugin=0.2.0");
    check("unconfigured soft-warns, exit 0", r.code === 0, "code=" + r.code + " " + r.err);
    check("unconfigured emits WARN not DRIFT", /WARN/.test(r.err) && !/DRIFT/.test(r.err), r.err.trim());
    check("unconfigured reports soft-warned count", /1 installed-but-unconfigured, soft-warned/.test(r.out), r.out.trim());
  },
);

// 4c) same unconfigured case under STRICT_HEALTH=1 => hard FAIL
await withServer(
  [{ key: "agenticos.discord-plugin", version: "0.2.0", status: "error",
     lastError: "discord-plugin config missing: discordBotToken" }],
  async (base) => {
    const r = await run(base, "agenticos.discord-plugin=0.2.0", { STRICT_HEALTH: "1" });
    check("STRICT_HEALTH re-hardens unconfigured to nonzero", r.code !== 0, "code=" + r.code);
    check("STRICT_HEALTH names UNHEALTHY", /UNHEALTHY/.test(r.err), r.err.trim());
  },
);

// 4d) version drift on an unconfigured plugin is still hard FAIL (not soft-warned)
await withServer(
  [{ key: "agenticos.discord-plugin", version: "0.2.0", status: "error",
     lastError: "discord-plugin config missing: discordBotToken" }],
  async (base) => {
    const r = await run(base, "agenticos.discord-plugin=0.3.0");
    check("unconfigured + drift still fails nonzero", r.code !== 0, "code=" + r.code);
    check("unconfigured + drift named as STALE", /registry 0\.2\.0 != built 0\.3\.0/.test(r.err), r.err.trim());
  },
);

// 6) PENDING: a plugin that is built + bind-mounted but deliberately NOT
//    installed yet (PLUGIN_PENDING_INSTALL, GOL-2423) is SKIPPED, not "NOT
//    INSTALLED". Without this the first deploy after wiring a new plugin goes
//    RED for a state we chose on purpose.
await withServer(
  [{ key: "agenticos.github-sync-plugin", version: "0.11.6" }],
  async (base) => {
    const r = await run(
      base,
      "agenticos.github-sync-plugin=0.11.6 agenticos.grove-content-drafter=0.1.0",
      { PENDING: "agenticos.grove-content-drafter" },
    );
    check("pending + uninstalled exits 0", r.code === 0, "code=" + r.code + " " + r.err);
    check(
      "pending + uninstalled is skipped, not NOT INSTALLED",
      /skip agenticos\.grove-content-drafter/.test(r.out) && !/NOT INSTALLED/.test(r.err),
      r.out.trim() + r.err.trim(),
    );
    check("pending skip is counted separately", /1 pending first install, skipped/.test(r.out), r.out.trim());
  },
);

// 6b) The inversion that makes PENDING a holding state and not an escape hatch:
//     once the plugin IS installed, leaving it in PLUGIN_PENDING_INSTALL fails
//     RED, so its version can never stay unasserted after go-live.
await withServer(
  [{ key: "agenticos.grove-content-drafter", version: "0.1.0" }],
  async (base) => {
    const r = await run(base, "agenticos.grove-content-drafter=0.1.0", {
      PENDING: "agenticos.grove-content-drafter",
    });
    check("pending but installed fails nonzero", r.code !== 0, "code=" + r.code);
    check(
      "pending but installed says to remove it from PLUGIN_PENDING_INSTALL",
      /IS INSTALLED[\s\S]*PLUGIN_PENDING_INSTALL/.test(r.err),
      r.err.trim(),
    );
  },
);

// 5) empty EXPECT => no-op exit 0
await withServer(REG, async (base) => {
  const r = await run(base, "");
  check("empty EXPECT no-ops exit 0", r.code === 0, r.err || r.out);
});

// 6) GOL-2496: the host reloads asynchronously, so a registry that is still on
//    the OLD version when the deploy step fires must be POLLED, not failed. A
//    server that flips to the built version on the 3rd read models run
//    35905253240, which converged 110s after the one-shot assert went RED.
{
  let reads = 0;
  const srv = createServer((req, res) => {
    reads += 1;
    const version = reads >= 3 ? "0.16.8" : "0.16.7";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        plugins: [
          { id: "1", pluginKey: "agenticos.github-sync-plugin", version, status: "ready" },
        ],
      }),
    );
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  try {
    const r = await run(base, "agenticos.github-sync-plugin=0.16.8", {
      ASSERT_TIMEOUT_MS: "5000",
      ASSERT_POLL_MS: "10",
    });
    check("late async reload converges instead of failing RED", r.code === 0, r.err || r.out);
    check("polled more than once", reads >= 3, "reads=" + reads);
    check("only the settled sample is reported (no DRIFT noise)", !/DRIFT/.test(r.err), r.err.trim());
  } finally {
    srv.close();
  }
}

// 7) GOL-2496: polling must NOT rescue a genuine drift — a registry that never
//    converges still fails RED once the deadline passes.
{
  let reads = 0;
  const srv = createServer((req, res) => {
    reads += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        plugins: [
          { id: "1", pluginKey: "agenticos.github-sync-plugin", version: "0.16.7", status: "ready" },
        ],
      }),
    );
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  try {
    // 1000/50, not 150/10. With a 150 ms deadline the FIRST fetch alone can eat
    // the whole budget on the 2-vCPU droplet, so `reads > 1` failed ~75% of runs
    // (reads=1) — a load-sensitive flake, not a regression. A 1 s deadline at a
    // 50 ms poll leaves room for many polls while still capping the count well
    // under 100, so both bounds stay meaningful.
    const r = await run(base, "agenticos.github-sync-plugin=0.16.8", {
      ASSERT_TIMEOUT_MS: "1000",
      ASSERT_POLL_MS: "50",
    });
    check("permanent drift still fails RED after the deadline", r.code !== 0, "code=" + r.code);
    check("permanent drift is reported as STALE", /registry 0\.16\.7 != built 0\.16\.8/.test(r.err), r.err.trim());
    check("deadline bounded the polling", reads > 1 && reads < 100, "reads=" + reads);
  } finally {
    srv.close();
  }
}

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
