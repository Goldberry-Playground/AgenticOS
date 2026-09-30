output "bucket_name" {
  description = "Name of the off-box backup bucket. Set as SPACES_BACKUP_BUCKET for infra/scripts/paperclip-backup-offsite.py (it is also that script's default)."
  value       = digitalocean_spaces_bucket.backups.name
}

output "bucket_endpoint" {
  description = "Virtual-hosted-style S3 endpoint the shipper signs against."
  value       = "https://${digitalocean_spaces_bucket.backups.name}.${var.region}.digitaloceanspaces.com"
}

output "spaces_key_name" {
  description = "Name of the bucket-scoped Spaces key, for cross-referencing in the DO Cloud Panel when inspecting or rotating."
  value       = digitalocean_spaces_key.backups_rw.name
}

output "backups_spaces_access_key_id" {
  description = "Access key id for the bucket-scoped key. Store in 1Password (AgenticOS Infra/backups_spaces_access_key_id) and place in the droplet's /opt/agenticos/.env as SPACES_BACKUP_ACCESS_KEY_ID."
  value       = digitalocean_spaces_key.backups_rw.access_key
}

output "backups_spaces_secret_key" {
  description = "Secret for the bucket-scoped key. Store in 1Password (AgenticOS Infra/backups_spaces_secret_key) and place in the droplet's /opt/agenticos/.env as SPACES_BACKUP_SECRET_KEY. Read it with `terraform output -raw backups_spaces_secret_key`."
  value       = digitalocean_spaces_key.backups_rw.secret_key
  sensitive   = true
}

output "retention_summary" {
  description = "The off-box retention actually configured, for the runbook and for spot-checking against the server's local GFS window."
  value = {
    daily   = "${var.prefix}/daily/   expire after ${var.daily_retention_days}d (every completed dump)"
    weekly  = "${var.prefix}/weekly/  expire after ${var.weekly_retention_days}d (first dump of each ISO week)"
    monthly = "${var.prefix}/monthly/ expire after ${var.monthly_retention_days}d (first dump of each month)"
  }
}
