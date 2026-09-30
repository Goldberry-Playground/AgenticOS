#!/usr/bin/env bash
# Install (or refresh) the AgenticOS backup systemd timers on a running Droplet.
#
# Writes the pg-backup + viking-backup .service/.timer units into
# /etc/systemd/system, reloads, and enables both timers. Idempotent — safe to
# re-run (it overwrites the units and re-enables).
#
# Fresh Droplets get these from cloud-init (droplet-bootstrap.yaml.tpl, which
# carries the same unit bodies inline so a fresh provision never depends on the
# repo clone). THIS script is the install path for an ALREADY-RUNNING box, where
# the deploy user can't write /etc/systemd/system (its sudo is NOPASSWD only for
# systemctl/ufw, and the account password is locked). Run it as root:
#
#   • from the DigitalOcean web Console (logged in as root), or
#   • ssh -t agenticos-droplet 'sudo bash /opt/agenticos/repo/infra/scripts/install-backup-timers.sh'
#       -t is required: deploy's sudo is NOPASSWD only for systemctl/ufw, so
#       `sudo bash` prompts for a password and needs a TTY to read it.
#
#   NOT `ssh root@<droplet>`: root's authorized_keys carries only the Terraform
#   provisioning key, so an operator's own key is refused (Josh, 2026-09-30).
#
# Keep the unit definitions here in sync with the inline copies in
# infra/cloud-init/droplet-bootstrap.yaml.tpl.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (writes /etc/systemd/system)." >&2
  echo "  → ssh -t agenticos-droplet 'sudo bash $0'  (sudo needs a TTY for the" >&2
  echo "    password; root@ key auth is refused), or the DO web Console as root." >&2
  exit 1
fi

REPO="${REPO:-/opt/agenticos/repo}"
LOG_DIR="${LOG_DIR:-/var/log/agenticos}"
mkdir -p "${LOG_DIR}"

install_unit() { # $1 = unit filename; body on stdin
  cat >"/etc/systemd/system/$1"
  echo "  wrote /etc/systemd/system/$1"
}

echo "Installing backup units (REPO=${REPO})…"

install_unit agenticos-pg-backup.service <<UNIT
[Unit]
Description=AgenticOS Postgres backup (cost telemetry + task ledger)
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
User=deploy
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/pg-backup.sh'
StandardOutput=append:${LOG_DIR}/pg-backup.log
StandardError=append:${LOG_DIR}/pg-backup.log
[Install]
WantedBy=multi-user.target
UNIT

install_unit agenticos-pg-backup.timer <<UNIT
[Unit]
Description=Run AgenticOS Postgres backup daily at 04:00 local
[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true
Unit=agenticos-pg-backup.service
[Install]
WantedBy=timers.target
UNIT

install_unit agenticos-viking-backup.service <<UNIT
[Unit]
Description=AgenticOS OpenViking memory backup (native pack/backup)
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
User=deploy
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/viking-backup.sh'
StandardOutput=append:${LOG_DIR}/viking-backup.log
StandardError=append:${LOG_DIR}/viking-backup.log
[Install]
WantedBy=multi-user.target
UNIT

install_unit agenticos-viking-backup.timer <<UNIT
[Unit]
Description=Run AgenticOS OpenViking memory backup daily at 04:30 local
[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
Unit=agenticos-viking-backup.service
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now agenticos-pg-backup.timer agenticos-viking-backup.timer

echo
echo "Enabled. Scheduled runs:"
systemctl list-timers 'agenticos-*-backup.timer' --no-pager
echo
echo "Smoke-test now (as the deploy user, NOT root):"
echo "  ${REPO}/infra/scripts/pg-backup.sh && ${REPO}/infra/scripts/viking-backup.sh && ls -lh /opt/backups"
