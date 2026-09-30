###############################################################################
# AgenticOS Backup Bucket — the off-box home for Paperclip DB dumps (GOL-2769).
#
# WHY THIS EXISTS
#   Every retained Paperclip dump lives in exactly one place: inside the
#   `agenticos_paperclip-data` docker volume on the agenticos droplet. They are
#   not in /opt/backups, so the Syncthing off-site leg that covers pg-backup and
#   viking-backup does not cover them. A volume or droplet loss takes every
#   restore point of the board with it. docs/runbooks/backup-and-recovery.md §D
#   named this the priority gap; this module is the destination half of the fix.
#   The shipper is infra/scripts/paperclip-backup-offsite.py.
#
# WHY A SEPARATE BUCKET (and not an existing one)
#   Blast-radius isolation, the same argument state-backend/ makes for
#   agenticos-tfstate:
#     • NOT agenticos-tfstate — state is sacred and tiny; mixing a 310 MB
#       object every 4 hours into it puts a high-churn lifecycle rule next to
#       the one object whose loss is an outage.
#     • NOT grove-odoo-backups — that key can delete the Odoo restore points.
#       Handing it to the AgenticOS droplet would let a compromise of the agent
#       box destroy the revenue system's backups. Different failure domains do
#       not share a delete-capable credential.
#     • NOT the account-wide `tf-provider-auth` fullaccess key — that one can
#       reach every bucket in the estate including both Terraform states, and
#       it must stay operator-only.
#   See the GOL-2769 credential decision comment for the full audit.
#
# WHAT THIS MANAGES
#   - The Spaces bucket `agenticos-backups` (private, versioning OFF, tiered
#     lifecycle expiration).
#   - A bucket-scoped `readwrite` Spaces key for the droplet's backup shipper.
#
# The bucket-scoped key's secret is an output of this apply; put it in
# 1Password (AgenticOS Infra / backups_spaces_*) and into the droplet's
# /opt/agenticos/.env. It is never committed and never pushed to CI.
###############################################################################

provider "digitalocean" {
  token = var.do_token

  # Bucket-level operations go over the S3 protocol and need S3-style creds;
  # the REST token alone cannot create or configure a bucket. See variables.tf.
  spaces_access_id  = var.spaces_bootstrap_access_key_id
  spaces_secret_key = var.spaces_bootstrap_secret_key
}

# === The backup bucket ===

resource "digitalocean_spaces_bucket" "backups" {
  name   = var.bucket_name
  region = var.region

  # Database dumps. Never public, under any circumstance.
  acl = "private"

  # Versioning is deliberately OFF here, unlike the state bucket. Objects in
  # this bucket are already immutable by construction — the key carries the
  # dump's own timestamp (paperclip-YYYYmmdd-HHMMSS.sql.gz), so a write never
  # overwrites a different restore point and there is nothing for a prior
  # version to protect. Turning it on would instead defeat the lifecycle rules:
  # expiration on a versioned bucket only creates delete markers, so every
  # "expired" 310 MB dump would keep billing forever as a noncurrent version.
  #
  # The protection versioning would buy — recovery from a malicious or buggy
  # delete — is provided here by the credential shape instead: the shipper's key
  # is scoped to this bucket only, and the shipper itself never issues a DELETE.

  # --- Retention tiers (the off-box mirror of the server's GFS window) ---
  # The shipper writes each dump under exactly one of these prefixes, so the
  # rules below are what actually enforce off-box retention. Nothing in the
  # shipper deletes; expiry is the bucket's job alone.

  lifecycle_rule {
    id      = "expire-daily"
    prefix  = "${var.prefix}/daily/"
    enabled = true

    expiration {
      days = var.daily_retention_days
    }
  }

  lifecycle_rule {
    id      = "expire-weekly"
    prefix  = "${var.prefix}/weekly/"
    enabled = true

    expiration {
      days = var.weekly_retention_days
    }
  }

  lifecycle_rule {
    id      = "expire-monthly"
    prefix  = "${var.prefix}/monthly/"
    enabled = true

    expiration {
      days = var.monthly_retention_days
    }
  }

  # An upload killed mid-flight (droplet reboot, network drop) leaves multipart
  # parts that are invisible to ListObjects but still billed. Reap them.
  lifecycle_rule {
    id      = "abort-incomplete-multipart"
    enabled = true

    abort_incomplete_multipart_upload_days = 7
  }

  # Destroying this bucket destroys every off-box restore point of the board —
  # i.e. it undoes the entire reason this module exists. Make it require an
  # edit to this file first.
  lifecycle {
    prevent_destroy = true
  }
}

# === The bucket-scoped access key the droplet gets ===

# Created through the DO REST API (var.do_token) and scoped to THIS bucket only.
# This is the credential that lands in /opt/agenticos/.env on the droplet, i.e.
# the one exposed to the largest attack surface in the estate — so it must not
# be able to reach agenticos-tfstate, grove-tf-state, grove-odoo-backups, or
# anything else. `readwrite` (not fullaccess) is the minimum that supports
# PUT + HEAD + ListObjectsV2; the shipper never issues DELETE.
resource "digitalocean_spaces_key" "backups_rw" {
  name = "${var.bucket_name}-rw"

  grant {
    bucket     = digitalocean_spaces_bucket.backups.name
    permission = "readwrite"
  }
}
