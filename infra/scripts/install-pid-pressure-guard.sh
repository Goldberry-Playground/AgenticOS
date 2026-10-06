#!/usr/bin/env bash
# Install (or refresh) the AgenticOS pid-pressure guard timer on a running
# Droplet (GOL-3002):
#   - agenticos-pid-pressure.service/.timer  (every 30 min: read-only check of
#     paperclip-server's pids cgroup + zombie count, Discord alert on pressure;
#     NEVER kills or recreates anything — remediation is a deploy decision,
#     because recreating re-arms the DB backup interval, GOL-1632 / GOL-2858)
#
# Fresh Droplets get this from cloud-init (droplet-bootstrap.yaml.tpl, which
# carries the same unit bodies inline so a fresh provision never depends on the
# repo clone). THIS script is the install path for an ALREADY-RUNNING box, where
# the deploy user can't write /etc/systemd/system (its sudo is NOPASSWD only for
# systemctl/ufw, and the account password is locked). Run it as root:
#
#   • from the DigitalOcean web Console (logged in as root), or
#   • ssh root@<droplet>  (Terraform SSH key is on root), then: bash "$0"
#
# The .service runs as User=deploy — deploy is in the docker group, so
# `docker inspect` needs no sudo, and the guard reads only /proc and the cgroup.
# Idempotent — safe to re-run. Keep the unit bodies here in sync with the inline
# copies in infra/cloud-init/droplet-bootstrap.yaml.tpl.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (writes /etc/systemd/system)." >&2
  echo "  → DO web Console as root, or 'ssh root@<droplet>', then: bash $0" >&2
  exit 1
fi

REPO="${REPO:-/opt/agenticos/repo}"
LOG_DIR="${LOG_DIR:-/var/log/agenticos}"
mkdir -p "${LOG_DIR}"

# Make sure the guard is executable (it ships from the repo clone).
chmod +x "${REPO}/infra/scripts/pid-pressure-guard.sh" 2>/dev/null || true

install_unit() { # $1 = unit filename; body on stdin
  cat >"/etc/systemd/system/$1"
  echo "  wrote /etc/systemd/system/$1"
}

echo "Installing pid-pressure guard unit (REPO=${REPO})…"

install_unit agenticos-pid-pressure.service <<UNIT
[Unit]
Description=AgenticOS pid-pressure guard (paperclip-server pids cgroup + zombie count -> Discord)
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
User=deploy
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/pid-pressure-guard.sh'
StandardOutput=append:${LOG_DIR}/pid-pressure.log
StandardError=append:${LOG_DIR}/pid-pressure.log
[Install]
WantedBy=multi-user.target
UNIT

install_unit agenticos-pid-pressure.timer <<UNIT
[Unit]
Description=Run AgenticOS pid-pressure guard every 30 min
[Timer]
OnBootSec=10min
OnUnitActiveSec=30min
RandomizedDelaySec=120
Unit=agenticos-pid-pressure.service
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now agenticos-pid-pressure.timer

echo
echo "Enabled. Scheduled runs:"
systemctl list-timers 'agenticos-pid-pressure.timer' --no-pager || true
echo
echo "Smoke-test now (as the deploy user, NOT root) — a healthy box is SILENT,"
echo "but still logs its observation line:"
echo "  sudo -u deploy ${REPO}/infra/scripts/pid-pressure-guard.sh"
echo "Force the alert path once (thresholds at 0 ⇒ reports + fires Discord,"
echo "WITHOUT touching the container):"
echo "  sudo -u deploy env PIDS_WARN_PCT=0 STAMP_FILE=/tmp/pid-guard-test.stamp ${REPO}/infra/scripts/pid-pressure-guard.sh"
echo
echo "Confirm the reaper itself is live (this is the GOL-3002 fix):"
echo "  docker inspect -f '{{.HostConfig.Init}}' paperclip-server   # expect: true"
