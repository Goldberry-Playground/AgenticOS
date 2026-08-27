#!/usr/bin/env bash
# infra/scripts/load-secrets.sh
#
# Loads AgenticOS infra secrets as TF_VAR_* environment variables.
# Tries 1Password CLI first; falls back to ~/.config/agenticos/infra.env.
#
# 1Password auth — two identities, no code change to switch (ADR-0001):
#   • Machine identity (non-interactive; CI + the future credential broker):
#       export OP_SERVICE_ACCOUNT_TOKEN=...   # read-only, scoped to the vault
#       source infra/scripts/load-secrets.sh  # no `op signin` needed
#     The service account must be READ-ONLY and have access to the
#     "Goldberry Grove - Admin" vault (items: AgenticOS Infra + Grove Infra)
#     AND read access to the "Grove Prod" vault (item: Cloudflare API Token).
#     NOTE (1Password Families cap ≈ 1000 reads/day/account): fine for occasional
#     `terraform apply` (~19 reads/run); do NOT wire high-frequency callers to raw
#     `op read` — that's the caching broker's job.
#   • Interactive (local dev): a signed-in `op` session (`op signin`).
#
# Usage:
#   source infra/scripts/load-secrets.sh
#   cd infra/terraform && terraform apply
#
# OR via direnv (automatic on cd into infra/terraform):
#   See infra/terraform/.envrc

# This file is meant to be sourced, not executed. Detect that.
# (We don't use 'set -e' because exits would kill the caller's shell.)

_agenticos_secrets_loaded=false

# ---- Tier 1: 1Password CLI ----
_agenticos_load_1password() {
    local op_vault="${AGENTICOS_OP_VAULT:-Goldberry Grove - Admin}"
    local op_item="AgenticOS Infra"

    if ! command -v op >/dev/null 2>&1; then return 1; fi
    # Auth liveness — two supported identities:
    #   • Machine identity (CI / the future credential broker): OP_SERVICE_ACCOUNT_TOKEN
    #     is set and `op` authenticates as the service account non-interactively.
    #     `op account get` does NOT work for a service account, so we skip it — the
    #     `op item get` below proves both liveness AND vault access. The service
    #     account MUST be read-only and scoped to the "$op_vault" vault (it reads
    #     the AgenticOS Infra + Grove Infra items) plus the "Grove Prod" vault
    #     (Cloudflare API Token item). This is the ADR-0001 machine-identity path;
    #     keep high-frequency callers behind the broker's cache, not raw op.
    #   • Interactive (local dev): a signed-in `op` session, verified here.
    if [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ] && ! op account get >/dev/null 2>&1; then
        return 1
    fi
    if ! op item get "$op_item" --vault "$op_vault" --format=json >/dev/null 2>&1; then
        return 1
    fi

    # Each field in the 1Password item maps to a TF_VAR_* env var.
    # GOL-75: DO token is least-privilege scoped. The root config manages five DO
    # resource types (digitalocean_droplet / app / ssh_key / vpc / monitor_alert),
    # so the token needs read+write on ALL FIVE scopes: droplet, app, ssh_key,
    # vpc, monitoring. (droplet+monitoring alone 403s on every plan/apply — TF
    # refreshes the App Platform app, VPC, and SSH key too.) It lives as
    # `do_token_scoped` on the `Grove Infra` item (NOT AgenticOS Infra), read
    # explicitly rather than via ${op_item}. The old full-privilege `do_token` is
    # intentionally off the runtime path. Override with AGENTICOS_DO_TOKEN_REF.
    export TF_VAR_do_token="$(op read "${AGENTICOS_DO_TOKEN_REF:-op://${op_vault}/Grove Infra/do_token_scoped}" 2>/dev/null)"
    export TF_VAR_tailscale_api_key="$(op read "op://${op_vault}/${op_item}/tailscale_api_key" 2>/dev/null)"
    export TF_VAR_tailscale_tailnet="$(op read "op://${op_vault}/${op_item}/tailscale_tailnet" 2>/dev/null)"
    # Cloudflare token for AgenticOS's OWN footprint: account-level Zero Trust
    # (Access apps/policies + service tokens + IdP read) + Cloudflare Tunnel, PLUS
    # zone DNS:Edit / Transform Rules:Edit / Zone:Read on gatheringatthegrove.com
    # (cloudflare-tunnel.tf + cloudflare-dns.tf records, cloudflare-webhook-alias.tf
    # http_request_transform ruleset). Account tokens don't answer
    # /user/tokens/verify — probe an account endpoint to validate, not verify.
    #
    # GOL-1548 / GOL-1537: the shared account-admin token (Grove Infra/
    # account_cloudflare_api_token) has been downscoped for odoocker and is
    # EXPIRED as of 2026-08-19 — it is intentionally NOT a fallback here; a dead
    # fallback only masks a misconfigured primary as a silent empty token.
    # AgenticOS uses its OWN least-privilege token, minted 2026-08-25 as a
    # user-owned token (id a9caef2f…, no expiry) covering exactly this footprint:
    # Zone:Read + DNS:Edit + Transform Rules:Edit on gatheringatthegrove.com,
    # plus account-level Access (Apps & Policies, Identity Providers:Read,
    # Service Tokens). It lives on the "Cloudflare API Token" item in the
    # "Grove Prod" vault, field `credential` — NOT on AgenticOS Infra (the
    # `cloudflare_api_token` field there was deliberately never created).
    # Override with AGENTICOS_CF_TOKEN_REF. If this resolves empty the run fails
    # loudly at the required-six check below — that's the intended behaviour.
    export TF_VAR_cloudflare_api_token="$(op read "${AGENTICOS_CF_TOKEN_REF:-op://Grove Prod/Cloudflare API Token/credential}" 2>/dev/null)"
    export TF_VAR_cloudflare_zone_id="$(op read "op://${op_vault}/${op_item}/cloudflare_zone_id" 2>/dev/null)"
    export TF_VAR_cloudflare_account_id="$(op read "op://${op_vault}/${op_item}/cloudflare_account_id" 2>/dev/null)"

    # Core service secrets consumed by app-platform.tf (dashboard env) AND
    # droplet.tf (cloud-init templatefile). Required by any full `terraform
    # apply`; previously these were only available via the ~/.config/agenticos/
    # infra.env fallback, so a 1Password-only apply failed with
    # "No value for required variable" on them. Export them here like the rest.
    export TF_VAR_agenticos_db_password="$(op read "op://${op_vault}/${op_item}/agenticos_db_password" 2>/dev/null)"
    export TF_VAR_openviking_root_api_key="$(op read "op://${op_vault}/${op_item}/openviking_root_api_key" 2>/dev/null)"

    # Dashboard Paperclip repoint — only needed for the App Platform dashboard
    # apply (absent for droplet-only operations), so these are NOT in the
    # required-six check below. Empty/missing here surfaces at `terraform apply`
    # as a missing-variable error for the dashboard, which is the right place.
    export TF_VAR_paperclip_company_id="$(op read "op://${op_vault}/${op_item}/paperclip_company_id" 2>/dev/null)"
    export TF_VAR_paperclip_board_key="$(op read "op://${op_vault}/${op_item}/paperclip_board_key" 2>/dev/null)"

    # Paperclip-behind-Cloudflare-Access tunnel secret (cloudflare-tunnel.tf).
    # Required by the full apply but not by droplet-only ops, so — like the two
    # dashboard vars above — it's intentionally outside the required-six check;
    # if absent it surfaces as a missing-variable error at `terraform apply`.
    # 1Password is the single source of truth: generate once with
    #   op item edit 'AgenticOS Infra' --vault '<vault>' \
    #     "paperclip_tunnel_secret[password]=$(openssl rand -base64 32)"
    export TF_VAR_paperclip_tunnel_secret="$(op read "op://${op_vault}/${op_item}/paperclip_tunnel_secret" 2>/dev/null)"

    # Sanity check: did we get values for all six?
    # NOTE: this file is SOURCED from the operator's interactive shell, which
    # is often zsh. bash's ${!var} indirect expansion is a zsh syntax error
    # that aborts the function *after* the exports above (observed as a
    # half-silent exit 126 on 2026-07-08) — use eval-based indirection, which
    # both shells accept.
    local missing=()
    local _val
    for var in TF_VAR_do_token TF_VAR_tailscale_api_key TF_VAR_tailscale_tailnet \
               TF_VAR_cloudflare_api_token TF_VAR_cloudflare_zone_id TF_VAR_cloudflare_account_id; do
        eval "_val=\${${var}:-}"
        case "$_val" in
            ""|PASTE_*) missing+=("${var#TF_VAR_}") ;;
        esac
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo "⚠ 1Password item '$op_item' exists in vault '$op_vault' but these fields are missing or still placeholders:" >&2
        for m in "${missing[@]}"; do echo "    - $m" >&2; done
        echo "  Edit them: op item edit '$op_item' --vault '$op_vault'" >&2
        return 1
    fi

    local _id="interactive session"
    [ -n "${OP_SERVICE_ACCOUNT_TOKEN:-}" ] && _id="service account (machine identity)"
    echo "✓ Loaded AgenticOS infra secrets from 1Password (vault: $op_vault, auth: $_id)" >&2
    _agenticos_secrets_loaded=true
    return 0
}

# ---- Tier 2: ~/.config/agenticos/infra.env ----
_agenticos_load_envfile() {
    local envfile="${AGENTICOS_INFRA_ENV:-$HOME/.config/agenticos/infra.env}"
    if [ ! -f "$envfile" ]; then return 1; fi

    # Refuse to load world-readable secrets files
    local perms
    perms="$(stat -f '%Lp' "$envfile" 2>/dev/null || stat -c '%a' "$envfile" 2>/dev/null || echo "")"
    if [ -n "$perms" ] && [ "$perms" != "600" ] && [ "$perms" != "400" ]; then
        echo "⚠ $envfile has permissions $perms — refusing to load." >&2
        echo "  Run: chmod 600 $envfile" >&2
        return 1
    fi

    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a

    echo "✓ Loaded AgenticOS infra secrets from $envfile" >&2
    _agenticos_secrets_loaded=true
    return 0
}

# ---- Run ----
if _agenticos_load_1password 2>/dev/null; then
    :  # success
elif _agenticos_load_envfile 2>/dev/null; then
    :  # fallback success
else
    cat >&2 <<'EOF'
✗ AgenticOS infra credentials not found.

  Option 1 (recommended) — 1Password:
    bash infra/scripts/setup-secrets-1password.sh
    # then edit each field in 1Password to add real values

  Option 2 — plaintext fallback:
    mkdir -p ~/.config/agenticos
    cp infra/secrets.env.example ~/.config/agenticos/infra.env
    chmod 600 ~/.config/agenticos/infra.env
    # then edit with real values

  See infra/README.md §3 for how to generate each token.
EOF
fi

# Clean up internal funcs from the shell namespace
unset -f _agenticos_load_1password _agenticos_load_envfile
unset _agenticos_secrets_loaded
