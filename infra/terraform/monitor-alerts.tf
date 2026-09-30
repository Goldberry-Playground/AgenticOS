# DigitalOcean native monitoring alert policies for the AgenticOS Droplet.
#
# The Droplet already runs the DO metrics agent (`monitoring = true` in
# droplet.tf), so these metrics are collected today — what was missing is any
# ALERT on them. On 2026-07-04 the box hit RAM ~103% and OOM-crashed the stack
# (and with it the App Platform dashboard, which depends on the Droplet's
# VPC-private services). These policies page us BEFORE the next OOM.
#
# $0/mo — native to the platform, no obs-droplet dependency, no agent to install.
# The richer single-pane (OpenObserve) is a separate follow-up (GOL-54); these
# DO-native alerts are the fast, redundant detection path.

locals {
  # DO's alert `slack` block requires non-empty url+channel or the API 422s.
  alert_slack = var.alert_slack.url != "" ? [var.alert_slack] : []
}

resource "digitalocean_monitor_alert" "mem_warning" {
  alerts {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.alert_slack
      content {
        url     = slack.value.url
        channel = slack.value.channel
      }
    }
  }
  window      = "5m"
  type        = "v1/insights/droplet/memory_utilization_percent"
  compare     = "GreaterThan"
  value       = 80
  enabled     = true
  entities    = [digitalocean_droplet.agenticos_droplet.id]
  description = "[AgenticOS] Droplet memory > 80% for 5m (warning — pre-OOM)"
}

resource "digitalocean_monitor_alert" "mem_critical" {
  alerts {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.alert_slack
      content {
        url     = slack.value.url
        channel = slack.value.channel
      }
    }
  }
  window      = "5m"
  type        = "v1/insights/droplet/memory_utilization_percent"
  compare     = "GreaterThan"
  value       = 90
  enabled     = true
  entities    = [digitalocean_droplet.agenticos_droplet.id]
  description = "[AgenticOS] Droplet memory > 90% for 5m (critical — OOM imminent)"
}

# Disk has two rungs, same shape as memory above. 80% is the EARLY rung: it is
# the point where the paperclip-volume-guard's bounded reclaim has not engaged
# yet (RECLAIM_PCT=85) and a human still has days, not hours, to act. The
# 2026-09-30 alert only fired at 91% off the 85% rung below, by which time the
# volume had ~8G free and a week of headroom — too late to be comfortable
# ahead of a launch. GOL-1632.
resource "digitalocean_monitor_alert" "disk_warning" {
  alerts {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.alert_slack
      content {
        url     = slack.value.url
        channel = slack.value.channel
      }
    }
  }
  window      = "5m"
  type        = "v1/insights/droplet/disk_utilization_percent"
  compare     = "GreaterThan"
  value       = 80
  enabled     = true
  entities    = [digitalocean_droplet.agenticos_droplet.id]
  description = "[AgenticOS] Droplet disk > 80% for 5m (warning — reclaim engages at 85%)"
}

resource "digitalocean_monitor_alert" "disk" {
  alerts {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.alert_slack
      content {
        url     = slack.value.url
        channel = slack.value.channel
      }
    }
  }
  window      = "5m"
  type        = "v1/insights/droplet/disk_utilization_percent"
  compare     = "GreaterThan"
  value       = 85
  enabled     = true
  entities    = [digitalocean_droplet.agenticos_droplet.id]
  description = "[AgenticOS] Droplet disk > 85% for 5m"
}

resource "digitalocean_monitor_alert" "cpu" {
  alerts {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.alert_slack
      content {
        url     = slack.value.url
        channel = slack.value.channel
      }
    }
  }
  window      = "10m"
  type        = "v1/insights/droplet/cpu"
  compare     = "GreaterThan"
  value       = 85
  enabled     = true
  entities    = [digitalocean_droplet.agenticos_droplet.id]
  description = "[AgenticOS] Droplet CPU > 85% for 10m"
}
