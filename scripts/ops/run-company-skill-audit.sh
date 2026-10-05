#!/usr/bin/env bash
#
# run-company-skill-audit.sh — GOL-2994
#
# On-droplet runner for scripts/ops/audit-company-skills.mjs, so a degraded
# skill install is *noticed on a schedule* instead of only when a human
# remembers to look. Invoked by .github/workflows/company-skill-audit.yml over
# the existing deploy SSH lane; also safe to run by hand on the box.
#
# Why a wrapper: the audit itself needs three things an in-container agent does
# not have — the board bearer key (board-only routes: `GET /api/companies`),
# the VPC-bound paperclip-server origin, and a company id per library. The
# first two are exactly what scripts/plugin-api-env.sh already resolves on the
# box (1Password via the credential-broker OP service-account token, GOL-313;
# never a GitHub Actions secret, since this repo has no CI secrets:write). The
# third is enumerated from the API so a new company is audited the day it
# exists rather than the day someone edits this file.
#
# Usage:
#   scripts/ops/run-company-skill-audit.sh                 # every company
#   scripts/ops/run-company-skill-audit.sh <cid> [<cid>…]  # just these
#   PAPERCLIP_COMPANY_IDS="<cid> <cid>" scripts/ops/run-company-skill-audit.sh
#
# Env overrides: everything scripts/plugin-api-env.sh takes (COMPOSE_DIR,
#   BROKER_ENV, BOARD_KEY_REF, OP_IMG, PAPERCLIP_BASE, API_READY_*), plus
#   REPO_DIR (default: the checkout this script lives in) and AUDIT_ARGS
#   (extra flags forwarded to the audit, e.g. `--json`).
#
# Exit: 0 every library clean · 1 at least one degraded install or slug
#       collision · 2 the audit could not complete (auth, network, bad payload).
#       1 and 2 are kept distinct on purpose: a red workflow run is routed by
#       ci-failure-router, and "we found a degraded skill" must not be
#       indistinguishable from "we could not look".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${HERE}/../.." && pwd)}"
AUDIT="${REPO_DIR}/scripts/ops/audit-company-skills.mjs"

[ -f "$AUDIT" ] || { echo "FATAL: $AUDIT missing (REPO_DIR=${REPO_DIR})" >&2; exit 2; }
command -v node >/dev/null || { echo "FATAL: node not found on PATH" >&2; exit 2; }

# Resolves + exports PAPERCLIP_BASE and BOARD_KEY, and waits for the API to
# actually serve before handing it over (GOL-2686). Sourced, not executed: its
# own FATALs exit this script.
# shellcheck source=scripts/plugin-api-env.sh
source "${HERE}/../plugin-api-env.sh"

echo "paperclip API: ${PAPERCLIP_BASE}"

# --- which libraries to audit -------------------------------------------------
companies=("$@")
if [ "${#companies[@]}" -eq 0 ] && [ -n "${PAPERCLIP_COMPANY_IDS:-}" ]; then
  # shellcheck disable=SC2206  # word-splitting a space/newline-separated list is the point
  companies=(${PAPERCLIP_COMPANY_IDS})
fi
if [ "${#companies[@]}" -eq 0 ]; then
  # The key goes through the environment, never argv — `ps` on a shared box must
  # not be able to read the board key out of a curl command line.
  listed="$(
    PAPERCLIP_BASE="$PAPERCLIP_BASE" BOARD_KEY="$BOARD_KEY" node -e '
      // CommonJS on purpose: `node -e` evaluates as CJS, which has no
      // top-level await (the audit module is ESM and can use one), so this is
      // a promise chain.
      const base = new URL(process.env.PAPERCLIP_BASE);
      const transport = require(base.protocol === "https:" ? "node:https" : "node:http");
      const url = new URL("/api/companies", base);
      new Promise((resolve, reject) => {
        const req = transport.request(url, {
          method: "GET",
          headers: { Authorization: "Bearer " + process.env.BOARD_KEY, Accept: "application/json" },
        }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error("GET /api/companies -> HTTP " + res.statusCode + " " + text.slice(0, 200)));
            } else resolve(text);
          });
        });
        req.setTimeout(30000, () => req.destroy(new Error("GET /api/companies -> timed out")));
        req.on("error", reject);
        req.end();
      }).then((body) => {
        const parsed = JSON.parse(body);
        const rows = Array.isArray(parsed) ? parsed : (parsed.companies || []);
        process.stdout.write(rows.map((c) => c && c.id).filter(Boolean).join(" "));
      }).catch((err) => {
        console.error(err.message);
        process.exit(1);
      });
    ' 2>&1
  )" || {
    # `GET /api/companies` is a board-only route: an agent key gets
    # {"error":"Board access required"}. Say so here, because the alternative
    # reading ("the API is down") sends the reader to the wrong place.
    echo "FATAL: could not enumerate companies. GET /api/companies is a board-only route, so a non-board key 403s here — check BOARD_KEY_REF, or pass company ids as arguments to skip enumeration. Response: ${listed}" >&2
    exit 2
  }
  # shellcheck disable=SC2206
  companies=(${listed})
  [ "${#companies[@]}" -gt 0 ] || {
    echo "FATAL: /api/companies answered 2xx but returned no company ids — nothing to audit. Pass company ids as arguments if the board-only route is not available here." >&2
    exit 2
  }
fi

# --- audit each library -------------------------------------------------------
# Worst outcome wins: a single "could not look" (2) must not be masked by other
# libraries auditing clean, and a clean library must not downgrade a finding.
rc=0
for cid in "${companies[@]}"; do
  echo "== company ${cid} =="
  set +e
  PAPERCLIP_API_URL="$PAPERCLIP_BASE" \
  PAPERCLIP_API_KEY="$BOARD_KEY" \
  PAPERCLIP_COMPANY_ID="$cid" \
    node "$AUDIT" ${AUDIT_ARGS:-}
  one=$?
  set -e
  if [ "$one" -gt "$rc" ]; then rc="$one"; fi
done

case "$rc" in
  0) echo "== all ${#companies[@]} skill librar(ies) clean ==" ;;
  1) echo "== degraded install(s) found — see the report above; remediation: docs/runbooks/company-skill-install-lanes.md ==" >&2 ;;
  *) echo "== audit could not complete (exit ${rc}) ==" >&2 ;;
esac
exit "$rc"
