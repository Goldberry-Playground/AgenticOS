#!/usr/bin/env node
// GitHub App auth for AgenticOS agents — dependency-free (Node built-ins only).
//
// Two deployment shapes, one file:
//
//   1. TOKEN BROKER (gh-token-broker container) — `serve` mode. Holds the App
//      private key (GITHUB_APP_PRIVATE_KEY_B64) and exposes an internal HTTP
//      endpoint that mints short-lived, repo-scoped installation tokens. This is
//      the ONLY place the key lives. Response: { token, expires_at } — the
//      `expires_at` lets clients cache against the token's real life (GOL-799).
//
//   2. CREDENTIAL HELPER (inside paperclip-server, run as `node`) — `get`/`token`
//      modes. When GH_TOKEN_BROKER_URL is set it asks the broker for a token over
//      the compose network; it never has the key. So a prompt-injected agent that
//      reads the container env cannot exfiltrate the App private key — only the
//      ability to request scoped tokens (its job anyway).
//
//   (Back-compat: with no GH_TOKEN_BROKER_URL but a key present, get/token mint
//    locally — the original single-process behaviour.)
//
// MODES
//   node github-app-token.mjs serve                    # run the broker (needs the key)
//   node github-app-token.mjs get                      # git credential helper (stdin)
//   node github-app-token.mjs erase                    # drop a cached token git rejected
//   node github-app-token.mjs token <owner>[/<repo>]   # print a token (gh/curl)
//   node github-app-token.mjs canary <owner>[/<repo>]  # mint+validate, exit 0/1 (GOL-1425)
//
// CONFIG (env)
//   serve:   GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_B64, PORT (default 9099)
//            GH_BROKER_API_KEY (or GH_BROKER_API_KEY_FILE) — REQUIRED: bearer
//              key callers must present on /token. The broker refuses to start
//              without one (GH_BROKER_ALLOW_UNAUTHENTICATED=1 overrides; don't).
//            GH_BROKER_ALLOWED_OWNERS — optional comma-separated owner
//              allowlist; requests for other owners get 403.
//            GH_BROKER_VALIDATE_TOKENS — default on; =0 disables mint-time token
//              validation (offline/dev). GOL-1425.
//            GH_BROKER_CANARY_OWNER[/_REPO] — optional; enables a periodic
//              mint+validate canary. GH_BROKER_CANARY_INTERVAL_MS (default 600000).
//            GH_BROKER_OPS_WEBHOOK — optional Discord webhook for canary alerts.
//   helper:  GH_TOKEN_BROKER_URL (e.g. http://gh-token-broker:9099)
//            GH_BROKER_API_KEY / GH_BROKER_API_KEY_FILE — bearer sent to broker
//            — or, back-compat, GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_B64
//
// Why bearer auth (security review 2026-07-12, M3): the broker sits on the
// shared compose network, so without caller auth ANY container (or anything
// that lands on that network) could mint installation tokens for every repo
// the App is installed on. The key gates the network surface; the owner
// allowlist caps the blast radius of a leaked key to our own orgs.

import { createServer } from "node:http";
import { createSign, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

const APP_ID = (process.env.GITHUB_APP_ID || "").trim();
const KEY_B64 = (process.env.GITHUB_APP_PRIVATE_KEY_B64 || "").trim();
const BROKER_URL = (process.env.GH_TOKEN_BROKER_URL || "").trim().replace(/\/$/, "");
const API = "https://api.github.com";
const CACHE_DIR = join(process.env.HOME || homedir(), ".cache", "agenticos-gh-app");

// Broker bearer key: env wins; else read from a file (the helper runs inside
// agent subprocesses whose env is sanitized by the Paperclip fork, so a
// bind-mounted key file is the reliable channel there).
function loadBrokerApiKey() {
  const fromEnv = (process.env.GH_BROKER_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const file = (process.env.GH_BROKER_API_KEY_FILE || "").trim();
  if (!file) return "";
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return ""; // unreadable/missing — caller proceeds unauthenticated and the broker 401s loudly
  }
}
const BROKER_API_KEY = loadBrokerApiKey();

const ALLOWED_OWNERS = (process.env.GH_BROKER_ALLOWED_OWNERS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Mint-time validation (GOL-1425 / folds #457): probe a token against GitHub
// before serving/caching it, so a token that GitHub has already stopped honouring
// (revoked installation, suspended App, rotated key) is detected AT MINT instead
// of on some downstream write 45 min later. Default ON; set =0 for offline
// unit/dev runs that have no network.
const VALIDATE_TOKENS = process.env.GH_BROKER_VALIDATE_TOKENS !== "0";

/** Timing-safe bearer check. Linear parse — no regex on the attacker-controlled
 * header (same ReDoS rationale as packages/credential-broker). */
function bearerOk(headerValue) {
  const h = (headerValue || "").trim();
  if (!h.startsWith("Bearer ")) return false;
  const presented = Buffer.from(h.slice(7).trim(), "utf8");
  const expected = Buffer.from(BROKER_API_KEY, "utf8");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

const log = (m) => process.stderr.write(`[github-app-token] ${m}\n`);
const die = (m) => { log(m); process.exit(1); };
const canMintLocally = () => Boolean(APP_ID && KEY_B64);

function validateTarget(owner, repo) {
  if (!OWNER_RE.test(owner)) throw new Error(`invalid GitHub owner: '${owner}'`);
  if (repo && !REPO_RE.test(repo)) throw new Error(`invalid GitHub repo: '${repo}'`);
}

// --- local minting (broker + back-compat) ---------------------------------

function normalizePem(s) {
  const m = s.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return s;
  const wrapped = m[2].replace(/\s+/g, "").match(/.{1,64}/g);
  if (!wrapped) return s;
  const label = m[1].trim();
  return `-----BEGIN ${label}-----\n${wrapped.join("\n")}\n-----END ${label}-----\n`;
}

function appJwt() {
  const pem = normalizePem(Buffer.from(KEY_B64, "base64").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64url({ alg: "RS256", typ: "JWT" });
  const body = b64url({ iat: now - 60, exp: now + 540, iss: APP_ID });
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(pem, "base64url")}`;
}

async function api(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "agenticos-github-app",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`${opts.method || "GET"} ${path} -> ${res.status}`); // status only, no body
    err.status = res.status;
    await res.body?.cancel?.();
    throw err;
  }
  return res.json();
}

function cacheFileFor(owner, repo) {
  const key = (repo ? `${owner}--${repo}` : owner).toLowerCase();
  return join(CACHE_DIR, `${key}.json`);
}

// Liveness probe for a minted installation token. `/rate_limit` is the cheapest
// authenticated endpoint AND it does NOT consume the token's rate quota, so we
// can call it on every mint for free. A live token → true; an explicit
// 401/403 → false (revoked/suspended). Any transport error (DNS, timeout, 5xx)
// FAILS OPEN → true: a network blip must never wedge minting, and the
// cache-invalidation-on-401 path (github-client) is the backstop for a token
// that slips through and is actually dead.
async function tokenIsLive(token) {
  try {
    const res = await fetch(`${API}/rate_limit`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "agenticos-github-app",
      },
      signal: AbortSignal.timeout(5000),
    });
    const live = res.status !== 401 && res.status !== 403;
    await res.body?.cancel?.();
    return live;
  } catch {
    return true; // fail open — never block minting on a transient probe failure
  }
}

// Mint (or serve from disk cache) an installation token, returning the full
// GitHub record `{ token, expires_at }`. Callers that only want the string use
// `mintLocal`. Broker `serve` mode returns `expires_at` to the client so it can
// cache against the token's REAL life, not a flat guess (GOL-799).
async function mintLocalRecord(owner, repo, { force = false } = {}) {
  validateTarget(owner, repo);
  const cacheFile = cacheFileFor(owner, repo);
  if (!force) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (c.token && c.expires_at && Date.parse(c.expires_at) - Date.now() > 5 * 60 * 1000) {
        // A disk-cached token can be revoked before its `expires_at` (GOL-1425).
        // Validate before serving; if GitHub has dropped it, fall through and
        // re-mint rather than handing out a token that 401s downstream.
        if (!VALIDATE_TOKENS || (await tokenIsLive(c.token))) {
          return { token: c.token, expires_at: c.expires_at };
        }
        log(`cached token for ${owner}${repo ? `/${repo}` : ""} failed validation — re-minting`);
      }
    } catch { /* missing/stale — re-mint */ }
  }
  const jwt = appJwt();
  // owner is already OWNER_RE-validated (no '/', '.', '@', ':'), but encode it
  // anyway so the value provably cannot alter the request URL — `owner` reaches
  // here from an HTTP request param in `serve` mode (CodeQL: request forgery).
  const o = encodeURIComponent(owner);
  let inst;
  try {
    inst = await api(`/orgs/${o}/installation`, jwt);
  } catch (e) {
    if (e.status === 404) inst = await api(`/users/${o}/installation`, jwt);
    else throw e;
  }
  const opts = repo
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositories: [repo] }) }
    : { method: "POST" };
  const tok = await api(`/app/installations/${inst.id}/access_tokens`, jwt, opts);
  // A freshly minted token that GitHub won't honour means the App itself is
  // broken (suspended, key rotated, install removed) — surface it now rather
  // than caching a dead credential the whole estate will fail on (GOL-1425/#457).
  if (VALIDATE_TOKENS && !(await tokenIsLive(tok.token))) {
    const err = new Error(`minted token for ${owner}${repo ? `/${repo}` : ""} rejected by GitHub`);
    err.status = 401;
    throw err;
  }
  try {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(cacheFile, JSON.stringify(tok), { mode: 0o600 });
  } catch { /* best-effort */ }
  return { token: tok.token, expires_at: tok.expires_at };
}

/** Token string only — for the git credential helper and `token` CLI mode. */
async function mintLocal(owner, repo) {
  return (await mintLocalRecord(owner, repo)).token;
}

// --- broker client (helper side) ------------------------------------------

async function mintViaBroker(owner, repo) {
  validateTarget(owner, repo);
  const u = new URL(`${BROKER_URL}/token`);
  u.searchParams.set("owner", owner);
  if (repo) u.searchParams.set("repo", repo);
  const res = await fetch(u, {
    signal: AbortSignal.timeout(15000),
    headers: BROKER_API_KEY ? { Authorization: `Bearer ${BROKER_API_KEY}` } : {},
  });
  if (!res.ok) throw new Error(`token broker -> ${res.status}`);
  const { token } = await res.json();
  if (!token) throw new Error("token broker returned no token");
  return token;
}

// Helper dispatch: broker if configured, else local (back-compat).
const mintToken = (owner, repo) => (BROKER_URL ? mintViaBroker(owner, repo) : mintLocal(owner, repo));

// --- git credential helper modes ------------------------------------------

function targetFromStdin() {
  const p = {};
  for (const line of readFileSync(0, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) p[line.slice(0, i)] = line.slice(i + 1);
  }
  if (p.host !== "github.com") return null;
  const [owner, repoRaw] = (p.path || "").split("/");
  if (!owner) return null;
  return { owner, repo: (repoRaw || "").replace(/\.git$/, "") || undefined };
}

async function credentialGet() {
  const t = targetFromStdin();
  if (!t || (!BROKER_URL && !canMintLocally())) return; // unconfigured — git falls back
  const token = await mintToken(t.owner, t.repo);
  process.stdout.write(`username=x-access-token\npassword=${token}\n`);
}

function credentialErase() {
  const t = targetFromStdin();
  if (!t) return;
  try { validateTarget(t.owner, t.repo); rmSync(cacheFileFor(t.owner, t.repo), { force: true }); } catch { /* best-effort */ }
}

// --- canary (GOL-1425) ----------------------------------------------------

// Proactively prove the broker can mint a LIVE token for a known target, so a
// dead App key/suspended install is flagged BEFORE it strands a real write.
// Forces a fresh mint (bypasses the disk cache) and validates it. Never throws.
async function runCanary(owner, repo) {
  const checkedAt = new Date().toISOString();
  try {
    validateTarget(owner, repo);
    const { token, expires_at } = await mintLocalRecord(owner, repo, { force: true });
    if (!(await tokenIsLive(token))) throw new Error("minted token failed validation");
    return { ok: true, owner, repo: repo || null, expires_at, checkedAt };
  } catch (e) {
    return { ok: false, owner, repo: repo || null, error: e.message, checkedAt };
  }
}

// Best-effort ops alert. Dependency-free; failures are swallowed so a flaky
// webhook never affects minting.
async function postOpsAlert(text) {
  const url = (process.env.GH_BROKER_OPS_WEBHOOK || "").trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* best-effort */ }
}

// --- broker server mode ---------------------------------------------------

function serve() {
  if (!canMintLocally()) die("serve mode requires GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_B64");
  if (!BROKER_API_KEY) {
    if (process.env.GH_BROKER_ALLOW_UNAUTHENTICATED === "1") {
      log("WARNING: serving WITHOUT caller auth (GH_BROKER_ALLOW_UNAUTHENTICATED=1). Any compose-network peer can mint tokens.");
    } else {
      die("serve mode requires GH_BROKER_API_KEY (or GH_BROKER_API_KEY_FILE) — refusing to run an unauthenticated token minter. Set GH_BROKER_ALLOW_UNAUTHENTICATED=1 to override (not recommended).");
    }
  }
  const port = Number(process.env.PORT || 9099);

  // Periodic canary (GOL-1425): if a target owner is configured, re-mint + validate
  // a token on an interval so a dead App key is flagged in the logs, on /health, and
  // (optionally) to ops Discord BEFORE it strands a real write. Off by default.
  let lastCanary = null;
  const canaryOwner = (process.env.GH_BROKER_CANARY_OWNER || "").trim();
  const canaryRepo = (process.env.GH_BROKER_CANARY_REPO || "").trim() || undefined;
  if (canaryOwner) {
    const intervalMs = Math.max(60_000, Number(process.env.GH_BROKER_CANARY_INTERVAL_MS || 10 * 60 * 1000));
    let wasOk = true;
    const tick = async () => {
      lastCanary = await runCanary(canaryOwner, canaryRepo);
      const target = `${canaryOwner}${canaryRepo ? `/${canaryRepo}` : ""}`;
      if (!lastCanary.ok) {
        log(`CANARY FAIL: cannot mint a live token for ${target}: ${lastCanary.error}`);
        if (wasOk) await postOpsAlert(`:rotating_light: gh-token-broker canary FAIL — cannot mint a live token for ${target}: ${lastCanary.error}`);
        wasOk = false;
      } else {
        if (!wasOk) await postOpsAlert(`:white_check_mark: gh-token-broker canary recovered for ${target}`);
        wasOk = true;
      }
    };
    tick(); // fire once at startup so /health is populated immediately
    setInterval(tick, intervalMs).unref?.();
    log(`canary enabled for ${canaryOwner}${canaryRepo ? `/${canaryRepo}` : ""} every ${Math.round(intervalMs / 1000)}s`);
  }

  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://broker");
      if (url.pathname === "/health") {
        // Always 200 while the process is up (an unhealthy exit would only take
        // token minting fully offline, which is worse). Canary status rides in
        // the body for monitors/deploy-gate to read.
        res.writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ status: "ok", canary: lastCanary }));
        return;
      }
      if (req.method !== "GET" || url.pathname !== "/token") { res.writeHead(404).end(); return; }
      if (BROKER_API_KEY && !bearerOk(req.headers.authorization)) {
        res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const owner = url.searchParams.get("owner") || "";
      const repo = url.searchParams.get("repo") || undefined;
      if (ALLOWED_OWNERS.length && !ALLOWED_OWNERS.includes(owner.toLowerCase())) {
        log(`denied mint for owner '${owner}' (not in GH_BROKER_ALLOWED_OWNERS)`);
        res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "owner_not_allowed" }));
        return;
      }
      const { token, expires_at } = await mintLocalRecord(owner, repo); // validates owner/repo
      // `expires_at` lets clients cache against the token's real life (GOL-799).
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ token, expires_at }));
    } catch (e) {
      // Log status/path only; never the key or API bodies.
      log(e.message);
      res.writeHead(e.status === 404 ? 404 : 400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "mint_failed" }));
    }
  }).listen(port, () => log(`token broker listening on :${port}${BROKER_API_KEY ? " (bearer auth on)" : ""}${ALLOWED_OWNERS.length ? ` (owners: ${ALLOWED_OWNERS.join(",")})` : ""}`));
}

// --- entry ----------------------------------------------------------------

const mode = process.argv[2];
try {
  if (mode === "serve") {
    serve();
  } else if (mode === "get") {
    await credentialGet();
  } else if (mode === "erase") {
    credentialErase();
  } else if (mode === "store") {
    // nothing to persist — tokens are minted on demand
  } else if (mode === "token") {
    if (!BROKER_URL && !canMintLocally()) die("set GH_TOKEN_BROKER_URL (or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_B64)");
    const [owner, repo] = (process.argv[3] || "").split("/");
    if (!owner) die("usage: github-app-token.mjs token <owner>[/<repo>]");
    process.stdout.write(`${await mintToken(owner, repo || undefined)}\n`);
  } else if (mode === "canary") {
    // One-shot canary for CI/cron probes: mint + validate a live token and exit
    // 0/1. Needs the key (local mint) — the broker's own liveness (GOL-1425).
    if (!canMintLocally()) die("canary mode requires GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_B64");
    const [owner, repo] = (process.argv[3] || "").split("/");
    if (!owner) die("usage: github-app-token.mjs canary <owner>[/<repo>]");
    const result = await runCanary(owner, repo || undefined);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) { await postOpsAlert(`:rotating_light: gh-token-broker canary FAIL for ${owner}${repo ? `/${repo}` : ""}: ${result.error}`); process.exit(1); }
  } else {
    die(`unknown mode '${mode}'. Use: serve | get | erase | token <owner>[/<repo>] | canary <owner>[/<repo>]`);
  }
} catch (e) {
  if (mode === "token" || mode === "canary") die(e.message);
  log(e.message);
  process.exit(0);
}
