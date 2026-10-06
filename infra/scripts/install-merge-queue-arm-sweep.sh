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
#   • ssh root@<droplet>  (Terraform SSH key is on root)
#
# then paste exactly one line — that is the whole root step:
#
#   bash /opt/agenticos/repo/infra/scripts/install-merge-queue-arm-sweep.sh
#
# It pre-flights the clone and refuses safely if the payload is not there yet
# (do NOT `git reset` the clone by hand to fix that — see below), and it ends by
# running one --dry-run tick, so its output is the verification.
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
BROKER_KEY="${BROKER_KEY:-/opt/agenticos/secrets/gh-broker-client.key}"
mkdir -p "${LOG_DIR}"

# ── Pre-flight: fail HERE, loudly, once — not every 5 minutes, quietly ────────
#
# The unit ExecStarts out of ${REPO}, which is a real git clone refreshed by
# deploy-host-scripts.yml. If this installer is run BEFORE that refresh has
# landed the GOL-3125 commit, the unit installs fine and then fails on a missing
# file on every tick forever, with nothing but a growing log to say so. Assert
# the payload is actually present first.
#
# ⚠️ Deliberately NOT self-healing with `git fetch && git reset --hard`: this
# clone bind-mounts packages/<plugin> into paperclip-server, so a bare reset
# silently reverts every live plugin bundle to whatever dist happens to be
# committed (GOL-2591 — it really happened, and reverted the github-sync
# liveness heartbeat 14 minutes after it armed). The only safe refresh is
# deploy-host-scripts.yml, which pairs the reset with a dist rebuild and a
# registry convergence. So: refuse, and point at that.
MISSING=0
for rel in infra/scripts/merge-queue-arm-sweep.sh \
           infra/scripts/vendored/merge-queue-arm-automerge.sh; do
  if [ ! -f "${REPO}/${rel}" ]; then
    echo "ERROR: ${REPO}/${rel} does not exist." >&2
    MISSING=1
  fi
done
if [ "${MISSING}" -ne 0 ]; then
  cat >&2 <<EOF

The host clone predates the GOL-3125 merge, so the timer would fail on a
missing file every tick. Refresh the clone the SAFE way and re-run this script:

  → Actions ▸ "Deploy Host Scripts" ▸ Run workflow (branch: main)
    https://github.com/Goldberry-Playground/AgenticOS/actions/workflows/deploy-host-scripts.yml

Do NOT 'git reset --hard' ${REPO} by hand: it bind-mounts the live plugin
dists, and a bare reset reverts them with no signal at all (GOL-2591). That
workflow is the only refresh that also rebuilds them.
EOF
  exit 1
fi

# Both ship from the repo clone; the vendored sweep is exec'd directly.
chmod +x "${REPO}/infra/scripts/merge-queue-arm-sweep.sh" 2>/dev/null || true
chmod +x "${REPO}/infra/scripts/vendored/merge-queue-arm-automerge.sh" 2>/dev/null || true

# The two runtime dependencies behind User=root. Both are WARNINGS, not errors:
# a broker that is down right now is transient and the sweep already alerts on
# it, whereas refusing to install would leave the queue unguarded for a reason
# that fixes itself. A missing KEY, though, never fixes itself — say so plainly.
if [ ! -r "${BROKER_KEY}" ]; then
  echo "WARNING: broker client key ${BROKER_KEY} is missing or unreadable." >&2
  echo "         Every tick will fail until it exists (chmod 600, root-owned)." >&2
elif ! docker inspect gh-token-broker >/dev/null 2>&1; then
  echo "WARNING: the gh-token-broker container is not running right now." >&2
  echo "         The sweep alerts to Discord and retries on the next tick." >&2
fi

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

# ── Self-verify: prove the install, do not hand back a checklist ─────────────
# One --dry-run tick exercises the whole path (broker mint -> per-repo GraphQL
# read -> eligibility) and arms nothing. A failure here does NOT undo the timer:
# the timer being live is the point of this ticket, and a transient broker blip
# must not leave the queue unguarded. Report and move on.
echo
echo "Self-verifying with one --dry-run tick (arms nothing)…"
DRY_RC=0
"${REPO}/infra/scripts/merge-queue-arm-sweep.sh" --dry-run || DRY_RC=$?
if [ "${DRY_RC}" -eq 0 ]; then
  echo "  ✅ dry-run clean — the timer's next tick will arm for real."
else
  echo "  ⚠️  dry-run exited ${DRY_RC}. The timer is INSTALLED AND ENABLED anyway" >&2
  echo "      (deliberate: see above). Diagnose with the log, then just wait for" >&2
  echo "      the next tick — no re-install needed." >&2
fi

echo
echo "Force one real tick now, and read the log:"
echo "  systemctl start agenticos-merge-queue-arm.service"
echo "  tail -n 80 ${LOG_DIR}/merge-queue-arm.log"
echo
echo "The timer NEVER sets ARM_PROTECTED=1 (that needs a board decision); the"
echo "wrapper exits 2 if anything tries to."
