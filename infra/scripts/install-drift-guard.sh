#!/usr/bin/env bash
# Install (or refresh) the AgenticOS host-clone drift-guard timer on a running
# Droplet (GOL-1976):
#   - agenticos-host-clone-drift.service/.timer  (a few times/day: read-only
#     `git fetch` + HEAD-vs-origin/main + origin-URL check on /opt/agenticos/repo,
#     Discord alert on drift; NEVER resets/pulls — repair is deploy-host-scripts.yml)
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
# The .service runs as User=deploy (repo owner → no git "dubious ownership", and
# the same fetch context deploy-host-scripts.yml's reset uses). Idempotent — safe
# to re-run. Keep the unit bodies here in sync with the inline copies in
# infra/cloud-init/droplet-bootstrap.yaml.tpl.
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
chmod +x "${REPO}/infra/scripts/host-clone-drift-guard.sh" 2>/dev/null || true

install_unit() { # $1 = unit filename; body on stdin
  cat >"/etc/systemd/system/$1"
  echo "  wrote /etc/systemd/system/$1"
}

echo "Installing host-clone drift-guard unit (REPO=${REPO})…"

install_unit agenticos-host-clone-drift.service <<UNIT
[Unit]
Description=AgenticOS host-clone drift-guard (read-only HEAD-vs-origin/main + origin-URL check -> Discord)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=deploy
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/host-clone-drift-guard.sh'
StandardOutput=append:${LOG_DIR}/host-clone-drift.log
StandardError=append:${LOG_DIR}/host-clone-drift.log
[Install]
WantedBy=multi-user.target
UNIT

install_unit agenticos-host-clone-drift.timer <<UNIT
[Unit]
Description=Run AgenticOS host-clone drift-guard 4x/day (00/06/12/18:07 local)
[Timer]
OnCalendar=*-*-* 00/6:07:00
Persistent=true
RandomizedDelaySec=300
Unit=agenticos-host-clone-drift.service
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now agenticos-host-clone-drift.timer

echo
echo "Enabled. Scheduled runs:"
systemctl list-timers 'agenticos-host-clone-drift.timer' --no-pager || true
echo
echo "Smoke-test now (as the deploy user, NOT root) — in-sync run is silent:"
echo "  sudo -u deploy ${REPO}/infra/scripts/host-clone-drift-guard.sh"
echo "Force the alert path once (points the check at a non-canonical origin so it"
echo "reports drift + fires Discord, WITHOUT mutating the real clone):"
echo "  sudo -u deploy env CANONICAL_ORIGIN=https://example.invalid/x.git ${REPO}/infra/scripts/host-clone-drift-guard.sh"
