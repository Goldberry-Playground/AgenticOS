// finish-plugin-upgrade.mjs — GOL-733 / GOL-804
//
// Converge ONE Paperclip plugin's stored registry version with the freshly
// deployed dist, then verify the registry reports the deployed version and a
// healthy status.
//
// Two-stage convergence:
//   1. POST /api/plugins/<id>/upgrade — idempotent, zero-downtime, config-safe.
//      This re-reads the registry entry's STORED `packagePath` and reloads the
//      worker from it.
//   2. If (and ONLY if) /upgrade did not reach WANT_VERSION, the stored
//      `packagePath` has DRIFTED to a stale source dir — /upgrade can only ever
//      re-read that path, it cannot repoint it (GOL-804: a drifted packagePath
//      of `/paperclip/staged-plugins/github-sync-plugin-0.11.4`, whose dist was
//      actually 0.11.3, made /upgrade "succeed" while shipping stale code). When
//      REINSTALL_PATH is supplied, recover deterministically by reinstalling
//      from that freshly-built canonical source, which REPOINTS packagePath, and
//      re-assert. Config survives a same-key reinstall; we verify that and fail
//      RED (never silently) if it was dropped, so a human restores it.
//
// Timing (GOL-2496): the deploy rebuilds the plugin dists IN PLACE, in the very
// tree the running server bind-mounts and watches. So for a few seconds around
// `pnpm install` + `esbuild` the plugin dir is inconsistent (package.json or
// dist/worker.js transiently absent), and the host's reload of a plugin is
// ASYNCHRONOUS — the registry row flips to the new version only once the worker
// has actually started. Both stages therefore RETRY/POLL rather than sampling
// once: a single immediate read turned a healthy deploy RED (run 35905253240 —
// /upgrade got `400 Missing package.json`, and the registry converged on its
// own 110s after the job had already failed). Polling never lets a genuine
// drift pass; it only refuses to call one before the host has had a chance.
//
// Runs ON the droplet (host node, global fetch — Node 18+). Reaches the board
// API over the VPC-bound host port supplied in PAPERCLIP_BASE.
//
// Env (PAPERCLIP_BASE / BOARD_KEY / PLUGIN_KEY required):
//   PAPERCLIP_BASE  e.g. http://10.116.16.2:3100  (board API origin)
//   BOARD_KEY       board bearer key (from 1Password; never logged)
//   PLUGIN_KEY      e.g. agenticos.github-sync-plugin
//   WANT_VERSION    deployed manifest version to assert the registry reaches
//                   (optional; when set, a mismatch after both stages fails)
//   REINSTALL_PATH  container-visible canonical source to reinstall from if
//                   /upgrade cannot converge — e.g. /paperclip/plugins/<plugin>
//                   (the CD-rebuilt bind mount). Optional; without it a
//                   non-convergence fails RED instead of recovering.
//   UPGRADE_RETRY_MS   how long to keep retrying a TRANSIENT /upgrade failure
//                      (mid-rebuild tree). Default 90000. 0 disables retry.
//   CONVERGE_TIMEOUT_MS how long to poll for the registry to reach WANT_VERSION
//                      and go healthy after each stage. Default 120000.
//   POLL_INTERVAL_MS   poll/retry interval. Default 3000.
//
// Prints a one-line JSON summary. Exits nonzero on any failure (HTTP error,
// plugin not installed, could-not-converge, unhealthy, dropped-config) so the
// CI step goes RED instead of silently leaving a stale worker.

const base = process.env.PAPERCLIP_BASE;
const key = process.env.PLUGIN_KEY;
const want = process.env.WANT_VERSION || "";
const board = process.env.BOARD_KEY || "";
const reinstallPath = process.env.REINSTALL_PATH || "";

const ms = (name, dflt) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
};
const UPGRADE_RETRY_MS = ms("UPGRADE_RETRY_MS", 90_000);
const CONVERGE_TIMEOUT_MS = ms("CONVERGE_TIMEOUT_MS", 120_000);
const POLL_INTERVAL_MS = ms("POLL_INTERVAL_MS", 3_000);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

if (!base || !key || !board) {
  console.error(
    "finish-plugin-upgrade: PAPERCLIP_BASE, PLUGIN_KEY and BOARD_KEY are required",
  );
  process.exit(64);
}

const H = { Authorization: "Bearer " + board, "Content-Type": "application/json" };

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(
      method + " " + path + " -> HTTP " + r.status + " " + text.slice(0, 300),
    );
  }
  return text ? JSON.parse(text) : null;
}

// GET /api/plugins returns either an array or {plugins:[...]}; the serialized
// key is camelCase `pluginKey` (see scripts/paperclip-lib.sh resolve_plugin_id).
// Accept snake_case too, defensively.
function findPlugin(list, k) {
  const arr = Array.isArray(list) ? list : (list && list.plugins) || [];
  return arr.find((p) => p.pluginKey === k || p.plugin_key === k) || null;
}

// A deploy rewrites the watched plugin dir in place, so the host can legitimately
// answer "there is no package.json / dist there" for a few seconds mid-rebuild,
// and can 5xx while a worker is respawning. Those are TIMING faults, not deploy
// faults — retry them. Anything else (404 unknown plugin, 401 bad key, a real
// 400 about the request) is permanent and must fail immediately.
const TRANSIENT = /missing package\.json|ENOENT|no such file|not found at |manifest (is )?missing|worker\.js/i;
function isTransient(err) {
  const m = String((err && err.message) || err);
  const code = /-> HTTP (\d{3})/.exec(m);
  if (!code) return true; // fetch/network failure — the host is mid-restart
  const status = Number(code[1]);
  if (status >= 500) return true;
  return status >= 400 && status < 500 && TRANSIENT.test(m);
}

const converged = (p) => !!p && (!want || p.version === want);
const healthy = (p) =>
  !!p && p.status !== "error" && p.status !== "failed" && !!p.status;

// Best-effort read of the plugin's stored config; returns the configJson object
// (or null). Only used to detect whether a reinstall dropped config — the
// values (secrets) are never logged.
async function readConfig(id) {
  try {
    const c = await api("GET", "/api/plugins/" + id + "/config");
    return (c && c.configJson) || null;
  } catch {
    return null;
  }
}
const hasConfig = (cfg) => !!cfg && Object.keys(cfg).length > 0;

// Recover a drifted packagePath: reinstall from the freshly-built canonical
// source so packagePath points at fresh code, then re-read. Config is preserved
// across a same-key reinstall by the host; we do NOT re-POST it (a masked GET
// could clobber good secrets) — instead we verify it survived and fail loud if
// it did not.
async function reinstallFrom(before, path) {
  const cfgBefore = await readConfig(before.id);
  await api("DELETE", "/api/plugins/" + before.id);
  await api("POST", "/api/plugins/install", {
    packageName: path,
    isLocalPath: true,
  });
  const after = findPlugin(await api("GET", "/api/plugins"), key);
  if (!after) throw new Error("plugin vanished after reinstall from " + path);
  if (hasConfig(cfgBefore) && !hasConfig(await readConfig(after.id))) {
    throw new Error(
      "reinstall from " +
        path +
        " REPOINTED packagePath but DROPPED plugin config — the worker will run unconfigured. Restore config per docs/runbooks/deploy-plugin-manifest-change.md",
    );
  }
  return after;
}

// POST /upgrade, retrying while the failure looks like the rebuild window
// rather than a broken deploy. Idempotent, so a retry is always safe.
async function upgradeWithRetry(id) {
  const deadline = Date.now() + UPGRADE_RETRY_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await api("POST", "/api/plugins/" + id + "/upgrade");
    } catch (e) {
      if (!isTransient(e) || Date.now() >= deadline) throw e;
      console.error(
        "   /upgrade attempt " + attempt + " hit a transient error, retrying: " +
          String((e && e.message) || e).slice(0, 160),
      );
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

// The host reloads a plugin asynchronously; the registry row flips to the new
// version only once the worker is up. Poll until it converges AND is healthy,
// or the deadline passes — then return the last observation for the caller to
// judge. Returns immediately when there is nothing to wait for.
async function waitForConverged() {
  const deadline = Date.now() + CONVERGE_TIMEOUT_MS;
  let last = null;
  for (;;) {
    last = findPlugin(await api("GET", "/api/plugins"), key);
    if (last && converged(last) && healthy(last)) return last;
    if (Date.now() >= deadline) return last;
    await sleep(POLL_INTERVAL_MS);
  }
}

(async () => {
  const before = findPlugin(await api("GET", "/api/plugins"), key);
  if (!before) throw new Error("plugin not installed: " + key);

  // Stage 1 — idempotent, config-safe /upgrade (re-reads stored packagePath).
  await upgradeWithRetry(before.id);
  let after = await waitForConverged();
  if (!after) throw new Error("plugin vanished after upgrade: " + key);
  let recovered = false;

  // Stage 2 — /upgrade could not reach the built version: packagePath is
  // drifted to a stale source. Repoint by reinstalling from fresh canonical
  // source, if one was supplied. Gated behind the Stage-1 poll above so a slow
  // (but working) reload never triggers this DELETE+install path (GOL-2496).
  if (!converged(after) && reinstallPath) {
    await reinstallFrom(before, reinstallPath);
    after = (await waitForConverged()) || after;
    recovered = true;
  }

  console.log(
    JSON.stringify({
      key,
      before: before.version,
      beforePath: before.packagePath || null,
      after: after.version,
      afterPath: after.packagePath || null,
      want: want || null,
      status: after.status,
      recovered,
    }),
  );

  if (!converged(after)) {
    throw new Error(
      "registry version " +
        after.version +
        " != deployed " +
        want +
        (reinstallPath
          ? " even after reinstall from " + reinstallPath
          : " after /upgrade (packagePath '" +
            (after.packagePath || "?") +
            "' serves stale code; set REINSTALL_PATH to auto-repoint)"),
    );
  }
  if (!healthy(after)) {
    throw new Error("plugin unhealthy after upgrade: status=" + after.status);
  }
})().catch((e) => {
  console.error(String((e && e.message) || e));
  process.exit(1);
});
