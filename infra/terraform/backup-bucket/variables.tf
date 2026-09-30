# === Provider credentials (sensitive — set via TF_VAR_* env vars) ===
# Recommended: `op run --env-file=.env.op -- terraform apply` so the values
# never enter shell scrollback or this repo.

variable "do_token" {
  description = "DigitalOcean API token (team MoonBear) with spaces + spaces_key scopes. Used by the DO provider to manage the bucket-scoped Spaces key. Sourced from 1Password AgenticOS Infra/do_token."
  type        = string
  sensitive   = true
}

# The DO provider's BUCKET resources talk the S3 protocol, not the DO REST API,
# so they need S3-style credentials separate from do_token. Same "two Spaces
# keys" split the state-backend module documents: this one is operator-only
# plumbing, never shipped to the droplet or to CI.
variable "spaces_bootstrap_access_key_id" {
  description = "Long-lived account-wide 'plumbing' Spaces access key ID used by the DO Terraform provider itself for bucket-level operations. Distinct from the bucket-scoped key this module creates. Sourced from 1Password Grove Infra/spaces_bootstrap_access_key_id."
  type        = string
  sensitive   = true
}

variable "spaces_bootstrap_secret_key" {
  description = "Companion secret to spaces_bootstrap_access_key_id. Sourced from 1Password Grove Infra/spaces_bootstrap_secret_key (label has a trailing space — read by field id)."
  type        = string
  sensitive   = true
}

# === Layout ===

variable "region" {
  description = "DigitalOcean Spaces region for the backup bucket. nyc3 matches the droplet's region family and the existing agenticos-tfstate bucket."
  type        = string
  default     = "nyc3"
}

variable "bucket_name" {
  description = "Name of the Spaces bucket that holds off-box copies of the AgenticOS/Paperclip database dumps. Kept SEPARATE from agenticos-tfstate (state vs. bulk data) and from every grove-* bucket (different failure domain)."
  type        = string
  default     = "agenticos-backups"
}

variable "prefix" {
  description = "Top-level key prefix for the Paperclip dumps inside the bucket. The lifecycle rules below are anchored to <prefix>/daily|weekly|monthly, so changing this WITHOUT changing the rules silently disables off-box retention."
  type        = string
  default     = "paperclip"
}

# === Retention tiers ===
#
# These mirror the Paperclip server's local GFS retention
# (instance_settings.general.backupRetention, currently
# {dailyDays:3, weeklyWeeks:4, monthlyMonths:1}) and deliberately overshoot it,
# because the whole point of the off-box copy is to outlive the droplet that
# enforces the local window. The monthly tier in particular keeps ~13 restore
# points against a local window of ~1 month.
#
# Sizing at ~310 MB/dump and ~6 dumps/day:
#   daily   7d  × 6/day ≈ 42 objects ≈ 13.0 GB
#   weekly  60d × 1/wk  ≈  9 objects ≈  2.8 GB
#   monthly 400d× 1/mo  ≈ 13 objects ≈  4.0 GB
#   ---------------------------------------------
#   steady state                     ≈ 19.8 GB
# The account's Spaces subscription includes 250 GB, and the five existing
# buckets are nowhere near it — so this is $0 incremental.

variable "daily_retention_days" {
  description = "Days to keep every completed dump under <prefix>/daily/. This is the bulk tier; it dominates storage. Local dailyDays is 3, so 7 already doubles the local window."
  type        = number
  default     = 7
}

variable "weekly_retention_days" {
  description = "Days to keep the first dump of each ISO week under <prefix>/weekly/. Local weeklyWeeks is 4 (~28d); 60 gives roughly double."
  type        = number
  default     = 60
}

variable "monthly_retention_days" {
  description = "Days to keep the first dump of each month under <prefix>/monthly/. Local monthlyMonths is 1 (~31d). 400 keeps ~13 monthlies — the 'at least one monthly beyond the local window' requirement, with a wide margin."
  type        = number
  default     = 400
}
