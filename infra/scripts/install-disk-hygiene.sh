#!/usr/bin/env bash
# Install (or refresh) AgenticOS disk-hygiene on a running Droplet (GOL-131):
#   - agenticos-docker-prune.service/.timer  (weekly `docker system prune -af`)
#   - agenticos-disk-guard.service/.timer     (daily df check + Discord + reclaim)
#   - agenticos-paperclip-volume-guard.*      (hourly paperclip-data headroom +
#                                              backup-freshness check → Discord; GOL-1632)
#   - journald cap                            (SystemMaxUse=200M drop-in + vacuum)
#   - logrotate                               (container + /var/log/agenticos logs
#                                              + paperclip server.log; GOL-1632)
#
# Fresh Droplets get all of this from cloud-init (droplet-bootstrap.yaml.tpl,
# which carries the same unit + config bodies inline so a fresh provision never
# depends on the repo clone). THIS script is the install path for an
# ALREADY-RUNNING box, where the deploy user can't write /etc/systemd/system
# (its sudo is NOPASSWD only for systemctl/ufw). Run it as root:
#
#   • from the DigitalOcean web Console (logged in as root), or
#   • ssh root@<droplet>  (Terraform SSH key is on root), then: bash "$0"
#
# Idempotent — safe to re-run. Keep the unit/config bodies here in sync with the
# inline copies in infra/cloud-init/droplet-bootstrap.yaml.tpl.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (writes /etc/systemd/system + /etc/logrotate.d)." >&2
  echo "  → DO web Console as root, or 'ssh root@<droplet>', then: bash $0" >&2
  exit 1
fi

REPO="${REPO:-/opt/agenticos/repo}"
LOG_DIR="${LOG_DIR:-/var/log/agenticos}"
mkdir -p "${LOG_DIR}"

# Make sure the reclaim scripts are executable (they ship from the repo clone).
chmod +x "${REPO}/infra/scripts/docker-prune.sh" "${REPO}/infra/scripts/disk-guard.sh" \
         "${REPO}/infra/scripts/paperclip-volume-guard.sh" 2>/dev/null || true

write_file() { # $1 = dest path; body on stdin
  cat >"$1"
  echo "  wrote $1"
}

echo "Installing disk-hygiene units + config (REPO=${REPO})…"

# --- docker prune: weekly ---
write_file /etc/systemd/system/agenticos-docker-prune.service <<UNIT
[Unit]
Description=AgenticOS weekly Docker reclaim (system prune + builder prune, no volumes)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service
[Service]
Type=oneshot
User=root
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/docker-prune.sh'
StandardOutput=append:${LOG_DIR}/docker-prune.log
StandardError=append:${LOG_DIR}/docker-prune.log
[Install]
WantedBy=multi-user.target
UNIT

write_file /etc/systemd/system/agenticos-docker-prune.timer <<UNIT
[Unit]
Description=Run AgenticOS Docker reclaim weekly (Sun 02:30 local)
[Timer]
OnCalendar=Sun *-*-* 02:30:00
Persistent=true
RandomizedDelaySec=300
Unit=agenticos-docker-prune.service
[Install]
WantedBy=timers.target
UNIT

# --- disk-guard: daily ---
write_file /etc/systemd/system/agenticos-disk-guard.service <<UNIT
[Unit]
Description=AgenticOS disk-guard (root FS check + Discord alert + reclaim at >=80%)
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
User=root
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/disk-guard.sh'
StandardOutput=append:${LOG_DIR}/disk-guard.log
StandardError=append:${LOG_DIR}/disk-guard.log
[Install]
WantedBy=multi-user.target
UNIT

write_file /etc/systemd/system/agenticos-disk-guard.timer <<UNIT
[Unit]
Description=Run AgenticOS disk-guard daily (05:00 local)
[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true
RandomizedDelaySec=300
Unit=agenticos-disk-guard.service
[Install]
WantedBy=timers.target
UNIT

# --- paperclip-volume-guard: hourly (GOL-1632) ---
# disk-guard watches ONLY the root FS; the paperclip-data docker volume is a
# separate filesystem, so its fill (hourly DB dumps + server.log) is invisible
# to it. This guard watches that volume's headroom AND backup freshness.
write_file /etc/systemd/system/agenticos-paperclip-volume-guard.service <<UNIT
[Unit]
Description=AgenticOS paperclip-data volume guard (headroom + backup-freshness → Discord)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service
[Service]
Type=oneshot
User=root
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/paperclip-volume-guard.sh'
StandardOutput=append:${LOG_DIR}/paperclip-volume-guard.log
StandardError=append:${LOG_DIR}/paperclip-volume-guard.log
[Install]
WantedBy=multi-user.target
UNIT

write_file /etc/systemd/system/agenticos-paperclip-volume-guard.timer <<UNIT
[Unit]
Description=Run AgenticOS paperclip-volume-guard hourly (:20)
[Timer]
OnCalendar=*-*-* *:20:00
Persistent=true
RandomizedDelaySec=120
Unit=agenticos-paperclip-volume-guard.service
[Install]
WantedBy=timers.target
UNIT

# --- journald cap: 200M ---
mkdir -p /etc/systemd/journald.conf.d
write_file /etc/systemd/journald.conf.d/10-agenticos-cap.conf <<'CONF'
# AgenticOS journald cap (GOL-131). Bounds /var/log/journal so journald never
# balloons the root FS. 200M persistent, 50M runtime, plus per-file + retention
# ceilings so a single chatty unit can't dominate the ring.
[Journal]
SystemMaxUse=200M
SystemKeepFree=500M
SystemMaxFileSize=50M
RuntimeMaxUse=50M
MaxRetentionSec=1month
CONF

# --- logrotate: container + app logs ---
write_file /etc/logrotate.d/agenticos <<'CONF'
# AgenticOS app logs (GOL-131). The systemd timers append to these; rotate so
# they can't grow unbounded on the root FS.
/var/log/agenticos/*.log {
    weekly
    rotate 4
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
    su root root
}

# Docker container json-file logs. docker-compose in this deployment does not
# set per-container log limits, so a chatty container can fill the root FS via
# /var/lib/docker/containers/*/*-json.log. Rotate + cap here as a backstop.
/var/lib/docker/containers/*/*-json.log {
    daily
    rotate 3
    maxsize 50M
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
    su root root
}

# Paperclip origin log (GOL-1632). The paperclip-server container appends its
# pino stream to server.log on the `paperclip-data` docker volume; unrotated it
# reached 2.2G in the 2026-08-18 disk-full P0. The glob matches the host-side
# volume mountpoint (compose namespaces it <project>_paperclip-data). pino writes
# in append mode, so copytruncate is safe (the container keeps writing to the
# same inode). size-driven so a burst can't outrun the daily cron.
/var/lib/docker/volumes/*paperclip-data/_data/instances/*/logs/server.log {
    daily
    rotate 7
    maxsize 200M
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
    su root root
}
CONF

echo "Reloading systemd + journald…"
systemctl daemon-reload
systemctl enable --now agenticos-docker-prune.timer agenticos-disk-guard.timer \
                       agenticos-paperclip-volume-guard.timer

# Apply the journald cap immediately (config alone only bounds future growth).
systemctl restart systemd-journald
journalctl --vacuum-size=200M || true

echo
echo "Enabled. Scheduled runs:"
systemctl list-timers 'agenticos-docker-prune.timer' 'agenticos-disk-guard.timer' \
                      'agenticos-paperclip-volume-guard.timer' --no-pager || true
echo
echo "Smoke-test the reclaim now (root):"
echo "  ${REPO}/infra/scripts/docker-prune.sh   # reclaims + prints df before/after"
echo "  WARN_PCT=0 ${REPO}/infra/scripts/disk-guard.sh   # force the alert path once"
echo "  WARN_PCT=0 STALE_MIN=0 REPAGE_MIN=0 ${REPO}/infra/scripts/paperclip-volume-guard.sh   # force both alert paths"
echo "  df -h /                                  # confirm root FS under ~70%"
