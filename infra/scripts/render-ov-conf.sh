#!/usr/bin/env bash
# render-ov-conf.sh: put the real OpenViking root key back into ov.conf after a
# deploy, and fail loudly if it can't.
#
# WHY: deploy-droplet.yml ships the repo with `git archive | tar x`, which
# overwrites openviking-config/ov.conf with the committed copy, whose
# server.root_api_key is the literal placeholder __OPENVIKING_ROOT_API_KEY__.
# cloud-init substitutes it once at provision; nothing re-substituted it after a
# deploy. The running container keeps the inode it started with, so nothing
# broke until the next openviking recreate, which then came up authenticating
# the PUBLIC placeholder and rejecting the real key (found 2026-11-10: the
# dashboard + every real-key client got 401, the placeholder got 200).
#
# Source of truth on the box: OPENVIKING_ROOT_API_KEY in /opt/agenticos/.env
# (itself from 1Password via cloud-init/Terraform). The key is never printed.
#
# Usage: render-ov-conf.sh [ENV_FILE] [OV_CONF]   (defaults: /opt/agenticos/...)
set -euo pipefail

ENV_FILE="${1:-/opt/agenticos/.env}"
OV_CONF="${2:-/opt/agenticos/openviking-config/ov.conf}"
PLACEHOLDER="__OPENVIKING_ROOT_API_KEY__"

key="$( (grep -E '^OPENVIKING_ROOT_API_KEY=' "$ENV_FILE" || true) | tail -1 | cut -d= -f2-)"
if [ -z "$key" ] || [ "$key" = "$PLACEHOLDER" ]; then
  echo "::error::OPENVIKING_ROOT_API_KEY missing or placeholder in $ENV_FILE; refusing to leave ov.conf on the placeholder" >&2
  exit 1
fi

KEY="$key" PLACEHOLDER="$PLACEHOLDER" OV_CONF="$OV_CONF" python3 - <<'PY'
import json, os, sys
p = os.environ["OV_CONF"]
d = json.load(open(p))
server = d.get("server")
if not isinstance(server, dict) or "root_api_key" not in server:
    sys.exit("::error::ov.conf has no server.root_api_key")
if server["root_api_key"] != os.environ["KEY"]:
    server["root_api_key"] = os.environ["KEY"]
    with open(p, "w") as f:  # in place: keeps owner/mode of the shipped file
        json.dump(d, f, indent=2)
        f.write("\n")
    print("ov.conf: root_api_key rendered from .env")
else:
    print("ov.conf: root_api_key already current")
PY

if grep -q "$PLACEHOLDER" "$OV_CONF"; then
  echo "::error::placeholder still present in $OV_CONF after render" >&2
  exit 1
fi
