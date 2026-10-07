#!/usr/bin/env bash
# Install (or refresh) the AgenticOS vendor-status guard on a running Droplet
# (GOL-3021):
#   - agenticos-vendor-status.service/.timer  (every 5 min: poll the public
#     vendor status APIs, write the agent-readable snapshot, alert Discord on a
#     transition only)
#
# Fresh Droplets get this from cloud-init (droplet-bootstrap.yaml.tpl, which
# carries the same unit bodies inline so a fresh provision never depends on the
# repo clone). THIS script is the install path for an ALREADY-RUNNING box, where
# the deploy user cannot write /etc/systemd/system (its sudo is NOPASSWD only
# for systemctl/ufw). Run it as root:
#
#   • from the DigitalOcean web Console (logged in as root), or
#   • ssh root@<droplet>  (Terraform SSH key is on root), then: bash "$0"
#
# Idempotent — safe to re-run. Keep the unit bodies here in sync with the inline
# copies in infra/cloud-init/droplet-bootstrap.yaml.tpl.
#
# WHY ROOT. The guard writes its snapshot onto the `paperclip-data` docker
# volume so in-container agents can read it at /paperclip/ops/vendor-status.json
# with no credential and no vault. /var/lib/docker is 0710 root:root, so only
# root can put a file there. The guard reads nothing privileged and writes
# nothing else: its only outbound credential is the Discord ops webhook already
# in /opt/agenticos/.env, which disk-guard.sh and paperclip-volume-guard.sh use
# the same way.
#
# WHY NOT A GITHUB ACTIONS SCHEDULE. The single most important thing this
# watches is GitHub Actions, and on 2026-10-05 scheduled runs were among the
# ones that never got a runner. A poller hosted on the thing it monitors goes
# quiet exactly when it matters.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (writes /etc/systemd/system)." >&2
  echo "  → DO web Console as root, or 'ssh root@<droplet>', then: bash $0" >&2
  exit 1
fi

REPO="${REPO:-/opt/agenticos/repo}"
LOG_DIR="${LOG_DIR:-/var/log/agenticos}"
GUARD="${REPO}/infra/scripts/vendor-status-guard.py"
mkdir -p "${LOG_DIR}"

if [ ! -f "${GUARD}" ]; then
  echo "ERROR: ${GUARD} not found." >&2
  echo "  The host clone is refreshed by .github/workflows/deploy-host-scripts.yml on" >&2
  echo "  any push to main touching infra/scripts/**. If the guard has merged but is" >&2
  echo "  missing here, that workflow has not run yet — check it, or:" >&2
  echo "    sudo -u deploy git -C ${REPO} fetch origin && sudo -u deploy git -C ${REPO} reset --hard origin/main" >&2
  exit 1
fi
chmod +x "${GUARD}"

write_file() { # $1 = dest path; body on stdin
  cat >"$1"
  echo "  wrote $1"
}

echo "Installing vendor-status guard (REPO=${REPO})…"

write_file /etc/systemd/system/agenticos-vendor-status.service <<UNIT
[Unit]
Description=AgenticOS vendor-status guard (GitHub/DO/Cloudflare/Stripe/1Password -> snapshot + Discord on transition)
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
User=root
WorkingDirectory=${REPO}
# No ExecStart env beyond the unit's own: the guard reads
# DISCORD_OPS_WEBHOOK_URL from /opt/agenticos/.env itself (same contract as
# disk-guard.sh), so the webhook never has to be written into a unit file.
ExecStart=/bin/bash -lc '${GUARD} poll'
StandardOutput=append:${LOG_DIR}/vendor-status.log
StandardError=append:${LOG_DIR}/vendor-status.log
[Install]
WantedBy=multi-user.target
UNIT

write_file /etc/systemd/system/agenticos-vendor-status.timer <<UNIT
[Unit]
Description=Poll vendor status every 5 minutes (GOL-3021)
[Timer]
# Every 5 minutes. ~8 unauthenticated GETs per run against status-page CDNs, so
# the cost is nil and the detection latency is what we are buying: an agent that
# wakes mid-incident gets an answer less than five minutes old. The agent-facing
# \`read\` subcommand re-polls anything older than 10 minutes by itself, so a
# missed tick degrades to a slightly slower read, never to a stale answer.
OnCalendar=*:0/5
Persistent=true
RandomizedDelaySec=60
Unit=agenticos-vendor-status.service
[Install]
WantedBy=timers.target
UNIT

# Rotate the guard's log. /etc/logrotate.d/agenticos already globs
# /var/log/agenticos/*.log, so this is covered with no extra config — asserted
# here rather than assumed, because a 5-minute timer is the chattiest unit on
# the box and an unrotated log is how the root FS fills.
if ! grep -q '/var/log/agenticos/\*\.log' /etc/logrotate.d/agenticos 2>/dev/null; then
  echo "  WARNING: /etc/logrotate.d/agenticos does not glob /var/log/agenticos/*.log —"
  echo "           run infra/scripts/install-disk-hygiene.sh to place it."
fi

echo "Reloading systemd…"
systemctl daemon-reload
systemctl enable --now agenticos-vendor-status.timer

echo
echo "Enabled. Scheduled runs:"
systemctl list-timers 'agenticos-vendor-status.timer' --no-pager || true

# An ops guard that cannot reach the ops channel is the exact failure mode this
# work exists to end, so say it at install time rather than never.
if ! grep -q '^DISCORD_OPS_WEBHOOK_URL=' /opt/agenticos/.env 2>/dev/null; then
  echo
  echo "WARNING: DISCORD_OPS_WEBHOOK_URL is not in /opt/agenticos/.env."
  echo "  The guard will still write the snapshot (agents keep their one-call read),"
  echo "  but no transition will ever be announced. Place it the same way as the"
  echo "  other host secrets — it must be the LITERAL webhook URL, never an op://"
  echo "  reference, because .env is read raw."
fi

echo
echo "Smoke-test now (root):"
echo "  ${GUARD} poll --dry-run    # prints the alert it WOULD post; writes nothing"
echo "  ${GUARD} read              # the one-call answer agents get"
echo "  journalctl -u agenticos-vendor-status.service -n 20 --no-pager"
echo
echo "Verify the snapshot is visible to in-container agents:"
echo "  docker compose -f /opt/agenticos/docker-compose.yml exec paperclip-server \\"
echo "    cat /paperclip/ops/vendor-status.json | head -20"
