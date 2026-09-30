#!/usr/bin/env bash
# Install (or refresh) AgenticOS disk-hygiene on a running Droplet (GOL-131):
#   - agenticos-docker-prune.service/.timer  (weekly `docker system prune -af`)
#   - agenticos-disk-guard.service/.timer     (daily df check + Discord + reclaim)
#   - agenticos-paperclip-volume-guard.*      (hourly paperclip-data headroom +
#                                              backup-freshness check → Discord; GOL-1632)
#   - agenticos-paperclip-backup-offsite.*    (every 30m: ship completed Paperclip
#                                              DB dumps to DO Spaces; GOL-2769)
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
         "${REPO}/infra/scripts/paperclip-volume-guard.sh" \
         "${REPO}/infra/scripts/paperclip-backup-offsite.py" 2>/dev/null || true

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

# --- paperclip off-box backup shipper: every 30 minutes (GOL-2769) ---
# The volume guard above only notices that dumps are being WRITTEN. This ships
# them OFF the droplet. Without it every retained Paperclip dump is single-copy
# inside the paperclip-data volume — not in /opt/backups, therefore not in the
# Syncthing off-site leg either — and a volume or droplet loss takes every
# restore point of the board with it.
#
# Runs as root only because resolving the docker volume mountpoint needs docker
# access, exactly like the volume guard. It never deletes anything: off-box
# retention is enforced by the bucket's lifecycle rules
# (infra/terraform/backup-bucket/).
#
# Credentials come from /opt/agenticos/.env:
#   SPACES_BACKUP_ACCESS_KEY_ID / SPACES_BACKUP_SECRET_KEY
# a DO Spaces key scoped readwrite to `agenticos-backups` and nothing else. If
# they are absent the shipper exits 2 and pages the Discord ops webhook rather
# than sitting quietly doing nothing — see the credential check at the bottom
# of this script.
write_file /etc/systemd/system/agenticos-paperclip-backup-offsite.service <<UNIT
[Unit]
Description=AgenticOS Paperclip DB dumps -> DO Spaces off-box copy (GOL-2769)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service
[Service]
Type=oneshot
User=root
WorkingDirectory=${REPO}
ExecStart=/bin/bash -lc '${REPO}/infra/scripts/paperclip-backup-offsite.py'
StandardOutput=append:${LOG_DIR}/paperclip-backup-offsite.log
StandardError=append:${LOG_DIR}/paperclip-backup-offsite.log
[Install]
WantedBy=multi-user.target
UNIT

write_file /etc/systemd/system/agenticos-paperclip-backup-offsite.timer <<UNIT
[Unit]
Description=Ship completed Paperclip DB dumps off-box every 30m (GOL-2769)
[Timer]
OnCalendar=*-*-* *:05,35:00
Persistent=true
RandomizedDelaySec=120
Unit=agenticos-paperclip-backup-offsite.service
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
                       agenticos-paperclip-volume-guard.timer \
                       agenticos-paperclip-backup-offsite.timer

# Apply the journald cap immediately (config alone only bounds future growth).
systemctl restart systemd-journald
journalctl --vacuum-size=200M || true

echo
echo "Enabled. Scheduled runs:"
systemctl list-timers 'agenticos-docker-prune.timer' 'agenticos-disk-guard.timer' \
                      'agenticos-paperclip-volume-guard.timer' \
                      'agenticos-paperclip-backup-offsite.timer' --no-pager || true

# The off-box shipper is inert without its bucket-scoped Spaces key, and an
# inert backup job is the exact failure mode this whole line of work exists to
# end. Say so here, at install time, rather than letting the first page arrive
# six hours later from a timer nobody is watching.
if ! grep -q '^SPACES_BACKUP_ACCESS_KEY_ID=' /opt/agenticos/.env 2>/dev/null; then
  echo
  echo "WARNING: SPACES_BACKUP_ACCESS_KEY_ID is not in /opt/agenticos/.env."
  echo "  The off-box backup shipper will exit 2 and page Discord until it is."
  echo "  Add the bucket-scoped key (1Password: AgenticOS Infra/backups_spaces_*):"
  echo "    sudo -u deploy tee -a /opt/agenticos/.env >/dev/null <<'ENVEOF'"
  echo "    SPACES_BACKUP_ACCESS_KEY_ID=<access key id>"
  echo "    SPACES_BACKUP_SECRET_KEY=<secret>"
  echo "    ENVEOF"
  echo "  Then smoke-test:  ${REPO}/infra/scripts/paperclip-backup-offsite.py --dry-run"
fi
echo
echo "Smoke-test the reclaim now (root):"
echo "  ${REPO}/infra/scripts/docker-prune.sh   # reclaims + prints df before/after"
echo "  WARN_PCT=0 ${REPO}/infra/scripts/disk-guard.sh   # force the alert path once"
echo "  WARN_PCT=0 STALE_MIN=0 REPAGE_MIN=0 ${REPO}/infra/scripts/paperclip-volume-guard.sh   # force both alert paths"
echo "  df -h /                                  # confirm root FS under ~70%"
