variable "do_token" {
  description = "DigitalOcean least-privilege scoped PAT: read+write on droplet + app + ssh_key + vpc + monitoring ONLY (GOL-75) — the five resource types this root config manages. Sourced from op://Goldberry Grove - Admin/Grove Infra/do_token_scoped. NOT a full-account token."
  type        = string
  sensitive   = true
}

variable "tailscale_api_key" {
  description = "Tailscale API key (or OAuth client) with auth_keys:write scope"
  type        = string
  sensitive   = true
}

variable "tailscale_tailnet" {
  description = "Tailscale tailnet identifier accepted in REST API URL paths. Use your Tailnet NAME (domain-style, e.g. 'goldberrygrove.farm') from https://login.tailscale.com/admin/general — NOT the separate 'Tailnet ID' field on that page, which the REST API doesn't accept. Alternative: literal '-' for the API-key-wildcard."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS:Edit + Access:Edit + Tunnel:Edit on the zone"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for gatheringatthegrove.com"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (find in any zone's Overview page sidebar)"
  type        = string
}

variable "do_region" {
  description = "DigitalOcean region slug"
  type        = string
  default     = "nyc1"
}

variable "droplet_size" {
  description = "DigitalOcean Droplet size slug. Bumped s-2vcpu-4gb -> s-4vcpu-8gb (GOL-657, board-approved 2026-07-21) to clear the recurring >80%/>90% memory OOM monitor alerts and CPU-p95 saturation. The live box is resized out-of-band by .github/workflows/resize-droplet.yml (an external CI runner power-cycles the Droplet — a local `terraform apply` cannot, since the resize reboots the very host running it); this default keeps IaC as the source of truth so `terraform plan` shows no drift afterward. The workflow default is a REVERSIBLE CPU/RAM-only resize (disk stays 80GB), so this can be scaled back down if the cost isn't warranted."
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "domain" {
  description = "Public hostname for the AgenticOS dashboard"
  type        = string
  default     = "agenticos.gatheringatthegrove.com"
}

variable "google_sso_email" {
  description = "Email allowed through Cloudflare Access (Google SSO)"
  type        = string
  default     = "josh@goldberrygrove.farm"
}

variable "cloudflare_access_team_domain" {
  description = "Cloudflare Zero Trust team domain (team name or full <team>.cloudflareaccess.com) — issuer for Access JWT verification in the dashboard (security review 2026-07-12, H1)"
  type        = string
  default     = "goldberrygrove"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key to install on the Droplet"
  type        = string
  default     = "~/.ssh/agenticos-droplet.pub"
}

variable "github_repo" {
  description = "owner/name of the GitHub repo to deploy on App Platform"
  type        = string
  default     = "EngineeringMoonBear/AgenticOS"
}

variable "github_branch" {
  description = "Git branch App Platform should track"
  type        = string
  default     = "main"
}

# ---------------------------------------------------------------------------
# Secrets injected at apply time. Never committed.
#
# Both of these end up as `type = "SECRET"` env vars on the App Platform
# spec, encrypted at rest by DigitalOcean. At apply time, source them from
# 1Password:
#
#   TF_VAR_agenticos_db_password=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/agenticos_db_password") \
#   TF_VAR_openviking_root_api_key=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/openviking_root_api_key") \
#     terraform -chdir=infra/terraform apply
# ---------------------------------------------------------------------------

variable "agenticos_db_password" {
  description = "Postgres password for the agenticos user. Must match what was set in /opt/agenticos/.env (POSTGRES_PASSWORD via AGENTICOS_DB_PASSWORD) at cloud-init time. Used to build the AGENTICOS_DB_URL env var on App Platform."
  type        = string
  sensitive   = true
}

variable "backups_spaces_access_key_id" {
  description = "Access key id of the BUCKET-SCOPED Spaces key for the off-box Paperclip backup bucket (GOL-2769). Created by infra/terraform/backup-bucket/, stored in 1Password (AgenticOS Infra/backups_spaces_access_key_id). Injected into /opt/agenticos/.env as SPACES_BACKUP_ACCESS_KEY_ID. Empty string = leave .env untouched (the shipper then pages Discord instead of failing silently)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "backups_spaces_secret_key" {
  description = "Companion secret to backups_spaces_access_key_id. Sourced from 1Password (AgenticOS Infra/backups_spaces_secret_key). Injected into /opt/agenticos/.env as SPACES_BACKUP_SECRET_KEY. Empty string = leave .env untouched."
  type        = string
  sensitive   = true
  default     = ""
}

variable "openviking_root_api_key" {
  description = "OpenViking root API key. Must match OPENVIKING_ROOT_API_KEY in /opt/agenticos/.env on the Droplet. Used as OPENVIKING_API_KEY on App Platform (the name the Hermes plugin + dashboard client both expect)."
  type        = string
  sensitive   = true
}

variable "paperclip_company_id" {
  description = "UUID of the GOL company row in Paperclip's companies table. Used as PAPERCLIP_COMPANY_ID on App Platform. Find via: psql into the Paperclip DB and SELECT id FROM companies WHERE name LIKE '%GOL%' OR name LIKE '%Goldberry%'. Store in 1Password under 'AgenticOS Infra / paperclip_company_id'."
  type        = string
}

variable "paperclip_board_key" {
  description = "Paperclip Board API key sent as Authorization: Bearer on every dashboard→Paperclip request. Store in 1Password under 'AgenticOS Infra / paperclip_board_key'. Used as PAPERCLIP_BOARD_KEY on App Platform."
  type        = string
  sensitive   = true
}

variable "paperclip_domain" {
  description = "Public hostname for Paperclip's board UI, fronted by Cloudflare Access + a cloudflared tunnel (see cloudflare-tunnel.tf). Kept distinct from var.domain (the dashboard) so the two apps have independent Access apps/policies."
  type        = string
  default     = "paperclip.gatheringatthegrove.com"
}

variable "paperclip_tunnel_secret" {
  description = <<-EOT
    Base64-encoded (32–256 byte) secret for the Paperclip cloudflared tunnel.
    1Password is the single source of truth — generate once and store it, then
    pass it in at apply time so Terraform consumes (never generates) it:

      op item create --category=password --title='paperclip_tunnel_secret' \
        --vault='Goldberry Grove - Admin' \
        password="$(openssl rand -base64 32)"
      export TF_VAR_paperclip_tunnel_secret=$(op read \
        "op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_tunnel_secret")

    Mirrors the op-read→TF_VAR pattern used by agenticos_db_password and
    openviking_root_api_key. The derived run token (a stable function of this
    secret + the tunnel ID) is exposed as the `paperclip_tunnel_token` output;
    that token is what the cloudflared compose service consumes via .env.
  EOT
  type        = string
  sensitive   = true
}

variable "alert_emails" {
  # DO's alert API rejects any recipient that is not a VERIFIED team member on
  # the account with "400 email is not verified". The verified owner of this
  # account (team MoonBear) is joshua_dunbar@me.com — josh@goldberrygrove.farm
  # is NOT a verified DO team member, so it 400s the whole create. That is why
  # GOL-53's alerts (PR #230) were merged but never applied. Default to the
  # verified address so `apply` succeeds and config == applied state (clean
  # zero-drift plan). To route alerts to josh@goldberrygrove.farm instead,
  # first invite+verify it under DO → Settings → Team, then update this default.
  description = "Email addresses that receive DigitalOcean droplet resource alerts (memory/disk/load). Must be VERIFIED DO team members. Defaults to the verified account owner."
  type        = list(string)
  default     = ["joshua_dunbar@me.com"]
}

variable "alert_slack" {
  description = "Optional Slack/Discord-compatible incoming-webhook for DO alerts. Leave url empty to send email only. (DO's Slack alert type also posts to Discord webhooks with /slack appended.)"
  type        = object({ url = string, channel = string })
  default     = { url = "", channel = "" }
}

# ── GOL-252: GitHub Actions CI secrets (see github-ci-secrets.tf) ───────────

variable "github_ci_secrets_repo" {
  description = "owner/name of the repo whose GitHub Actions secrets this module manages. Its Actions secrets receive DO_MONITORING_TOKEN for the Tier 2A rightsize advisor."
  type        = string
  default     = "EngineeringMoonBear/AgenticOS"
}

variable "github_ci_token" {
  description = "GitHub token used to push Actions secrets to github_ci_secrets_repo. Needs Actions:Secrets WRITE when manage_github_ci_secrets = true. Sourced from op://Goldberry Grove - Admin/Grove Infra/github_token, which is currently Contents/PR-scoped only (no secrets write) — the GOL-252 governance gate. Empty default keeps the provider inert when the gate is off."
  type        = string
  sensitive   = true
  default     = ""
}

variable "do_monitoring_token" {
  description = "DigitalOcean token exposed to CI as the DO_MONITORING_TOKEN Actions secret so the Tier 2A rightsize advisor can read 7-day p95 CPU/mem. Least privilege: prefer a monitoring:read (+ droplet:read) token; interim value is op://Goldberry Grove - Admin/Grove Infra/do_token_scoped. See GOL-252 for the read-only mint decision."
  type        = string
  sensitive   = true
  default     = ""
}

variable "discord_webhook_url" {
  description = "Discord ops webhook exposed to CI as the DISCORD_WEBHOOK_URL Actions secret so the Tier 2A rightsize advisor (GOL-253) can post its recommendation. Value: op://Goldberry Grove - Admin/Grove Infra/discord_webhook_url. Same secrets:write gate as do_monitoring_token."
  type        = string
  sensitive   = true
  default     = ""
}

variable "manage_github_ci_secrets" {
  description = "Gate: when true, Terraform pushes the effective ci_secrets map (var.ci_secrets + the legacy DO_MONITORING_TOKEN) AND DISCORD_WEBHOOK_URL (GOL-253) to github_ci_secrets_repo's Actions secrets. Requires a secrets:WRITE github_ci_token. VERIFIED 2026-07-13 (GOL-342): no token has secrets:write on AgenticOS yet (App token = read-only, PUT 403; no PAT access), so this stays false = no-op. Flip once the App install gains Secrets:write."
  type        = bool
  default     = false
}

# ── GOL-342: generalised declarative CI-secret map ──────────────────────────
variable "ci_secrets" {
  description = <<-EOT
    Map of GitHub Actions SECRET_NAME => plaintext value to push to
    github_ci_secrets_repo when manage_github_ci_secrets = true. Values are
    injected at apply time from 1Password — NEVER committed. Build the map JSON
    straight from the shared manifest so it is declared in one place only:

      export TF_VAR_ci_secrets="$(../../tools/ci-secrets-tfvars.sh \
          --repo EngineeringMoonBear/AgenticOS)"

    The legacy `do_monitoring_token` var is merged in automatically (see
    github-ci-secrets.tf locals) so existing wiring keeps working.
  EOT
  type        = map(string)
  sensitive   = true
  default     = {}
}
