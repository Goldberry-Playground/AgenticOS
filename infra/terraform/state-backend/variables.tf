# === Provider credentials (sensitive — set via TF_VAR_* env vars) ===
# Recommended: source from 1Password via `op run --env-file=.env.op -- ...`
# so the values never enter shell scrollback or this repo.

variable "do_token" {
  description = "DigitalOcean API token (team MoonBear) with spaces + spaces_key scopes. Used by the DO provider to manage the bucket-scoped Spaces key. Sourced from 1Password AgenticOS Infra/do_token."
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub token with Actions:Secrets Read+Write + Metadata:Read on var.github_secrets_repo (fine-grained), or classic with `repo` scope. Sourced from 1Password AgenticOS Infra/github_token."
  type        = string
  sensitive   = true
}

# The DO Terraform provider's bucket resources (digitalocean_spaces_bucket and
# friends) talk the S3 protocol, not the DO REST API — so they need a Spaces
# access key for provider auth, separate from the do_token. This is "plumbing"
# credential, NOT the credential that workflows consume. AgenticOS shares the
# Grove DO account (team MoonBear), so the existing account-wide plumbing key is
# reused here. See README.md section "Why two Spaces keys".
variable "spaces_bootstrap_access_key_id" {
  description = "Long-lived account-wide 'plumbing' Spaces access key ID used by the DO Terraform provider itself for bucket-level operations. Distinct from the bucket-scoped agenticos-tfstate key this module creates. Sourced from 1Password GoldberryGrove Infra/spaces_bootstrap_access_key_id (same DO account as AgenticOS)."
  type        = string
  sensitive   = true
}

variable "spaces_bootstrap_secret_key" {
  description = "Companion secret to spaces_bootstrap_access_key_id. Same lifecycle, same source. Sourced from 1Password GoldberryGrove Infra/spaces_bootstrap_secret_key (label has a trailing space — read by field id)."
  type        = string
  sensitive   = true
}

# === Layout (have defaults; override only if you need to) ===

variable "github_secrets_repo" {
  description = "Repo (owner/name) that receives SPACES_ACCESS_KEY_ID + SPACES_SECRET_ACCESS_KEY as GH Actions secrets."
  type        = string
  default     = "Goldberry-Playground/AgenticOS"
}

variable "manage_github_secrets" {
  description = "Whether to push the bucket-scoped key to GitHub Actions secrets (SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY) on var.github_secrets_repo. Requires a github_token with Actions:Secrets write. Defaults false because the AgenticOS Infra github_token is Contents/PR-scoped only; the key is stored in 1Password instead. Flip to true when a secrets-scoped token is available."
  type        = bool
  default     = false
}

variable "region" {
  description = "DigitalOcean Spaces region for the state bucket. Matches the endpoint in infra/terraform/main.tf's backend block (nyc3)."
  type        = string
  default     = "nyc3"
}

variable "bucket_name" {
  description = "Name of the Spaces bucket that holds the root AgenticOS Terraform remote state. Kept SEPARATE from grove-tf-state for blast-radius isolation."
  type        = string
  default     = "agenticos-tfstate"
}
