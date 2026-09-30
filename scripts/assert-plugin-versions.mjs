// assert-plugin-versions.mjs — GOL-804
//
// Post-deploy invariant: for EVERY plugin this deploy rebuilt, the LIVE registry
// version must equal the version in the freshly-built dist, and the plugin must
// be healthy. Runs unconditionally after a plugin deploy — NOT gated on a
// manifest bump — so it catches a stale registry from ANY cause:
//   - a drifted packagePath serving old code (GOL-804),
//   - a manual/out-of-band install that pinned a stale source,
//   - a forgotten manifest version bump,
//   - a bad staged dir whose manifest and dist disagree.
//
// The GOL-733 finish step only asserts convergence for plugins whose
// src/manifest.ts changed AND only when it runs inside the CD workflow; the
// 0.11.x staging incident was deployed out-of-band and slipped straight past it.
// This assertion is the backstop that would have caught it.
//
// Runs ON the droplet (host node, global fetch — Node 18+).
//
// The host reloads a plugin ASYNCHRONOUSLY after its dist changes, so the
// registry row lags the freshly-built dist by seconds-to-minutes. Sampling once,
// immediately after the deploy step, therefore reports drift that isn't real —
// run 35905253240 went RED at 18:51:38 on a registry that converged by itself at
// 18:53:28 (GOL-2496). This polls to a deadline instead. A genuine drift still
// fails RED; it just costs ASSERT_TIMEOUT_MS first.
//
// The same deadline also absorbs TRANSPORT failures (GOL-2686). The deploy step
// ahead of this one may have just force-recreated paperclip-server to repair an
// orphaned plugin bind mount (GOL-2585); its probe is filesystem-only, so this
// can arrive while the server is still booting and :3100 is refusing. undici
// renders that as the bare string `fetch failed` — which is what run 36662917269
// reported as its entire diagnosis. A refused/5xx sample is "not converged yet",
// retried like any other; only a base URL that never answers before the deadline
// is RED, and then it says so with the URL and the underlying cause.
//
// Env:
//   PAPERCLIP_BASE   board API origin, e.g. http://10.116.16.2:3100
//   BOARD_KEY        board bearer key (from 1Password; never logged)
//   EXPECT           space/comma-separated <pluginKey>=<version> pairs, e.g.
//                    "agenticos.github-sync-plugin=0.11.6 agenticos.vault-plugin=0.4.2"
//   PENDING          space/comma-separated pluginKeys that are BUILT + bind-mounted
//                    but deliberately NOT installed in the registry yet (GOL-2423).
//                    A pending key that is absent from the registry is skipped with
//                    a notice instead of failing "NOT INSTALLED"; a pending key that
//                    IS installed fails RED, forcing it out of PLUGIN_PENDING_INSTALL
//                    and into full assertion coverage. That inversion is the point:
//                    the holding state cannot silently outlive the install.
//   ASSERT_TIMEOUT_MS how long to keep polling for convergence. Default 120000
//                    (0 = sample once, the historical behaviour).
//   ASSERT_POLL_MS   poll interval. Default 3000.
//
// Exits 0 when every expected plugin is installed at the expected version and
// either healthy OR installed-but-unconfigured (activation blocked purely on
// missing config — a soft WARN, GOL-1276; set STRICT_HEALTH=1 to disallow).
// Exits nonzero (CI RED) listing every plugin that drifted on version or is
// unhealthy for any other reason.

const base = process.env.PAPERCLIP_BASE;
const board = process.env.BOARD_KEY || "";
const expectRaw = process.env.EXPECT || "";
const pending = new Set(
  (process.env.PENDING || "").split(/[\s,]+/).filter(Boolean),
);

const ms = (name, dflt) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
};
const ASSERT_TIMEOUT_MS = ms("ASSERT_TIMEOUT_MS", 120_000);
const ASSERT_POLL_MS = ms("ASSERT_POLL_MS", 3_000);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

if (!base || !board) {
  console.error("assert-plugin-versions: PAPERCLIP_BASE and BOARD_KEY are required");
  process.exit(64);
}

const expect = expectRaw
  .split(/[\s,]+/)
  .filter(Boolean)
  .map((pair) => {
    const i = pair.lastIndexOf("=");
    return { key: pair.slice(0, i), version: pair.slice(i + 1) };
  })
  .filter((e) => e.key && e.version);

if (expect.length === 0) {
  console.log("assert-plugin-versions: nothing to assert (EXPECT empty)");
  process.exit(0);
}

const H = { Authorization: "Bearer " + board, "Content-Type": "application/json" };

// undici's fetch rejects with a terse `TypeError: fetch failed` and hides the
// real reason (ECONNREFUSED / EAI_AGAIN / socket hang up) in `.cause`. Unwrap the
// whole chain — a one-word failure message costs a whole debugging session.
const describe = (e) => {
  const parts = [];
  for (let cur = e, depth = 0; cur && depth < 5; cur = cur.cause, depth += 1) {
    const m = [cur.code, cur.message].filter(Boolean).join(" ");
    if (m && !parts.includes(m)) parts.push(m);
  }
  return parts.join(" <- ") || String(e);
};

function findPlugin(list, k) {
  const arr = Array.isArray(list) ? list : (list && list.plugins) || [];
  return arr.find((p) => p.pluginKey === k || p.plugin_key === k) || null;
}
const healthy = (p) =>
  !!p && p.status !== "error" && p.status !== "failed" && !!p.status;

// An installed plugin whose activation is blocked ONLY because its config has
// not been supplied yet (e.g. discord-plugin awaiting discordBotToken, GOL-470)
// is an intentional not-yet-configured state — NOT a version/health regression
// this deploy caused. Its dist still converges to the built version (asserted
// separately), so surfacing it as a hard RED would permanently mask genuine
// deploy failures (GOL-1276). Detect the config-validation error the plugin
// worker raises pre-flight and treat it as a soft warning instead.
//   Set STRICT_HEALTH=1 to force every unhealthy plugin back to hard RED.
const UNCONFIGURED = /config(uration)?\s+missing|missing[\s\S]{0,40}\bconfig(uration)?\b/i;
const unconfigured = (p) => {
  if (process.env.STRICT_HEALTH === "1") return false;
  return UNCONFIGURED.test(String((p && p.lastError) || ""));
};

async function sample() {
  const r = await fetch(base + "/api/plugins", { headers: H });
  const text = await r.text();
  if (!r.ok) throw new Error("GET /api/plugins -> HTTP " + r.status + " " + text.slice(0, 200));
  const list = text ? JSON.parse(text) : [];

  const drift = [];
  const warn = [];
  const ok = [];
  let skipped = 0;
  for (const e of expect) {
    const p = findPlugin(list, e.key);
    if (pending.has(e.key)) {
      // Deliberate holding state — assert the CLAIM, not the version.
      if (p) {
        drift.push(
          `${e.key}: listed in PLUGIN_PENDING_INSTALL but IS INSTALLED` +
            ` (registry ${p.version}, status=${p.status}) — remove it from` +
            ` PLUGIN_PENDING_INSTALL in scripts/plugin-registry.sh so its version` +
            ` is actually asserted`,
        );
      } else {
        skipped += 1;
        ok.push(`  skip ${e.key} — pending first install (not in registry yet)`);
      }
      continue;
    }
    if (!p) {
      drift.push(`${e.key}: NOT INSTALLED (expected ${e.version})`);
      continue;
    }
    if (p.version !== e.version) {
      // Version drift is a genuine deploy failure regardless of health — the
      // registry is serving code other than what this deploy just built.
      drift.push(
        `${e.key}: registry ${p.version} != built ${e.version}` +
          ` (packagePath=${p.packagePath || "?"}) — deploy shipped STALE code`,
      );
    } else if (healthy(p)) {
      ok.push(`  ok  ${e.key} @ ${p.version} (${p.status})`);
    } else if (unconfigured(p)) {
      // Version converged; only unhealthy because config isn't wired yet.
      warn.push(
        `${e.key}: version ok (${p.version}) but installed-but-unconfigured` +
          ` (status=${p.status}) — activation blocked on missing config, not a` +
          ` deploy regression: ${String(p.lastError || "").slice(0, 200)}`,
      );
    } else {
      drift.push(
        `${e.key}: version ok (${p.version}) but UNHEALTHY status=${p.status}` +
          (p.lastError ? ` — ${String(p.lastError).slice(0, 200)}` : ""),
      );
    }
  }
  return { drift, warn, ok, skipped };
}

(async () => {
  // Poll: the host's reload is async, so "drifted" a second after the deploy is
  // usually "not reloaded yet". Only the LAST sample is reported, so a run that
  // settles stays quiet (GOL-2496).
  const deadline = Date.now() + ASSERT_TIMEOUT_MS;
  const budget = `${Math.round(ASSERT_TIMEOUT_MS / 1000)}s`;
  let res = null;
  let transportErr = null;
  for (let attempt = 1; ; attempt += 1) {
    try {
      res = await sample();
      transportErr = null;
    } catch (e) {
      // Reachability failure, not a verdict: the registry has told us nothing.
      // Discard the stale sample so a transport error can never be reported as
      // if the last successful reading still stood.
      res = null;
      transportErr = e;
    }
    if (res && !res.drift.length) break;
    if (Date.now() >= deadline) break;
    if (attempt === 1) {
      console.log(
        transportErr
          ? `  ... ${base} not answering yet (${describe(transportErr)}); polling up to ${budget}`
          : `  ... ${res.drift.length} plugin(s) not converged yet; polling up to ` +
              `${budget} for the async reload`,
      );
    }
    await sleep(ASSERT_POLL_MS);
  }

  if (!res) {
    // Never got a single reading. This is an availability failure, and naming it
    // as one keeps it from being misread as plugin version drift.
    throw new Error(
      `GET ${base}/api/plugins never answered within ${budget} — paperclip-server` +
        ` is not serving, so plugin convergence could NOT be verified.` +
        ` Last error: ${describe(transportErr)}`,
    );
  }

  const { drift, warn, ok, skipped } = res;
  for (const line of ok) console.log(line);
  for (const w of warn) console.error("  WARN  " + w);

  if (drift.length) {
    for (const d of drift) console.error("  DRIFT " + d);
    throw new Error(
      drift.length + " plugin(s) did not converge to the built version — see above",
    );
  }
  console.log(
    "assert-plugin-versions: all " + (expect.length - skipped) + " converged" +
      (warn.length ? ` (${warn.length} installed-but-unconfigured, soft-warned)` : "") +
      (skipped ? ` (${skipped} pending first install, skipped)` : ""),
  );
})().catch((e) => {
  console.error(String((e && e.message) || e));
  process.exit(1);
});
