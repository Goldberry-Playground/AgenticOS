#!/usr/bin/env bash
# Install (or refresh) the merge-queue arming sweep timer on a running Droplet
# (GOL-3125):
#   - agenticos-merge-queue-arm.service/.timer  (every 5 min: arm auto-merge as
#     the agent App on every eligible open agent PR across the three Goldberry
#     repos, so no agent PR can build a dead merge group that stalls the whole
#     sequential queue behind it)
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
# WHY User=root AND NOT User=deploy (the drift-guard's pattern)
#
# The sweep needs two things the `deploy` user cannot be given cheaply:
#   1. /opt/agenticos/secrets/gh-broker-client.key — the broker client bearer,
#      a chmod-600 secret deliberately kept out of /opt/agenticos/.env so that
#      paperclip-server and its agent subprocesses never see it. Making it
#      group-readable by `deploy` would permanently widen who can mint App
#      tokens on this box — a bigger standing privilege change than a oneshot
#      timer running as root.
#   2. `docker inspect gh-token-broker`, to find the broker's current container
#      IP (the broker publishes no ports). `deploy` is in the docker group, so
#      this one would work either way.
# Nothing in the sweep touches the git clone's objects, so the "repo owner →
# no dubious-ownership" reason that puts host-clone-drift-guard.sh on
# User=deploy does not apply here.
#
# Idempotent — safe to re-run. Keep the unit bodies here in sync with the
# inline copies in infra/cloud-init/droplet-bootstrap.yaml.tpl.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (writes /etc/systemd/system)." >&2
  echo "  → DO web Console as root, or 'ssh root@<droplet>', then: bash $0" >&2
  exit 1
fi

REPO="${REPO:-/opt/agenticos/repo}"
LOG_DIR="${LOG_DIR:-/var/log/agenticos}"
mkdir -p "${LOG_DIR}"

# Both ship from the repo clone; the vendored sweep is exec'd directly.
chmod +x "${REPO}/infra/scripts/merge-queue-arm-sweep.sh" 2>/dev/null || true
chmod +x "${REPO}/infra/scripts/vendored/merge-queue-arm-automerge.sh" 2>/dev/null || true

install_unit() { # $1 = unit filename; body on stdin
  cat >"/etc/systemd/system/$1"
  echo "  wrote /etc/systemd/system/$1"
}

echo "Installing merge-queue arming sweep unit (REPO=${REPO})…"

install_unit agenticos-merge-queue-arm.service <<UNIT
[Unit]
Description=AgenticOS merge-queue arming sweep (arm auto-merge as the agent App so no agent PR builds a dead merge group)
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
User=root
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/merge-queue-arm-sweep.sh'
StandardOutput=append:${LOG_DIR}/merge-queue-arm.log
StandardError=append:${LOG_DIR}/merge-queue-arm.log
[Install]
WantedBy=multi-user.target
UNIT

install_unit agenticos-merge-queue-arm.timer <<UNIT
[Unit]
Description=Run the AgenticOS merge-queue arming sweep every 5 minutes
[Timer]
OnCalendar=*:0/5
Persistent=true
RandomizedDelaySec=60
Unit=agenticos-merge-queue-arm.service
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now agenticos-merge-queue-arm.timer

echo
echo "Enabled. Scheduled runs:"
systemctl list-timers 'agenticos-merge-queue-arm.timer' --no-pager || true
echo
echo "Smoke-test now WITHOUT arming anything (prints what it would arm, per repo):"
echo "  ${REPO}/infra/scripts/merge-queue-arm-sweep.sh --dry-run"
echo "Then one real tick, and read the log:"
echo "  systemctl start agenticos-merge-queue-arm.service"
echo "  tail -n 80 ${LOG_DIR}/merge-queue-arm.log"
echo
echo "The timer NEVER sets ARM_PROTECTED=1 (that needs a board decision); the"
echo "wrapper exits 2 if anything tries to."
