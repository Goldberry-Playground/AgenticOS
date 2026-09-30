terraform {
  required_version = ">= 1.6"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
  }

  # REMOTE backend, unlike the sibling state-backend/ module. state-backend/ is
  # local-only because it bootstraps the very bucket the remote backend needs
  # (circular); this module has no such problem, so its state lives in
  # `agenticos-tfstate` alongside the root state. State is sacred — a local-only
  # state file for the bucket that holds every off-box restore point would make
  # the durability fix itself depend on one laptop.
  backend "s3" {
    endpoints                   = { s3 = "https://nyc3.digitaloceanspaces.com" }
    region                      = "us-east-1" # required by the backend, ignored by Spaces
    bucket                      = "agenticos-tfstate"
    key                         = "backup-bucket/terraform.tfstate"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    # Spaces answers 501 Not Implemented to the integrity checksums newer AWS
    # SDKs send; without this every read/write fails. Same as the root backend.
    skip_s3_checksum = true
  }
}
