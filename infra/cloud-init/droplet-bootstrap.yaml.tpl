#cloud-config
# AgenticOS Droplet bootstrap.
# Templated by Terraform: receives ts_authkey, github_repo, deploy_pubkey.

package_update: true
package_upgrade: true
packages:
  - curl
  - git
  - vim
  - ufw
  - unattended-upgrades
  - fail2ban
  - jq
  - bc
  - ca-certificates
  - apt-transport-https
  - gnupg

users:
  - name: deploy
    sudo: "ALL=(ALL) NOPASSWD: /bin/systemctl, /usr/sbin/ufw"
    shell: /bin/bash
    groups: [sudo]
    ssh_authorized_keys:
      - ${deploy_pubkey}

write_files:
  - path: /etc/apt/keyrings/.placeholder
    content: "placeholder so keyrings dir exists before runcmd"
    permissions: "0644"

  - path: /etc/systemd/system/agenticos-curator.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS Curator nightly run
      After=network-online.target docker.service
      Wants=network-online.target

      [Service]
      Type=oneshot
      User=deploy
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/scripts/run-curator.sh'
      StandardOutput=append:/var/log/agenticos/curator.log
      StandardError=append:/var/log/agenticos/curator.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-curator.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS Curator nightly at 03:00 local

      [Timer]
      OnCalendar=*-*-* 03:00:00
      Persistent=true
      Unit=agenticos-curator.service

      [Install]
      WantedBy=timers.target

  - path: /etc/systemd/system/agenticos-pg-backup.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS Postgres backup (cost telemetry + task ledger)
      After=network-online.target docker.service
      Wants=network-online.target

      [Service]
      Type=oneshot
      User=deploy
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/infra/scripts/pg-backup.sh'
      StandardOutput=append:/var/log/agenticos/pg-backup.log
      StandardError=append:/var/log/agenticos/pg-backup.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-pg-backup.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS Postgres backup daily at 04:00 local

      [Timer]
      OnCalendar=*-*-* 04:00:00
      Persistent=true
      Unit=agenticos-pg-backup.service

      [Install]
      WantedBy=timers.target

  - path: /etc/systemd/system/agenticos-viking-backup.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS OpenViking memory backup (native pack/backup → .ovpack)
      After=network-online.target docker.service
      Wants=network-online.target

      [Service]
      Type=oneshot
      User=deploy
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/infra/scripts/viking-backup.sh'
      StandardOutput=append:/var/log/agenticos/viking-backup.log
      StandardError=append:/var/log/agenticos/viking-backup.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-viking-backup.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS OpenViking memory backup daily at 04:30 local

      [Timer]
      OnCalendar=*-*-* 04:30:00
      Persistent=true
      Unit=agenticos-viking-backup.service

      [Install]
      WantedBy=timers.target

  # Drop-in override for the syncthing@deploy.service unit. By default
  # Syncthing's GUI binds to 127.0.0.1:8384 (loopback only), which means
  # even with UFW open on tailscale0 the GUI is unreachable from the
  # Mac on the Tailnet. The STGUIADDRESS env var overrides the config.xml
  # bind setting BEFORE Syncthing's first run, so we never have to edit
  # config.xml or restart the service to fix the bind. This file lives
  # at /etc/systemd/system/syncthing@deploy.service.d/override.conf and
  # is systemd's canonical way to extend a stock unit without modifying
  # the package-installed unit file.
  # Restart=always (not the stock Restart=on-failure): Syncthing sometimes
  # exits CLEANLY (self-restart on upgrade/config) expecting its supervisor to
  # bring it back — on-failure ignores exit 0, which left sync dead for 17
  # days (Jun 18 - Jul 5 2026) with nothing noticing. RestartSec throttles a
  # crash-loop. (No [Install] section: drop-ins extend the unit, they are not
  # installed themselves.)
  - path: /etc/systemd/system/syncthing@deploy.service.d/override.conf
    permissions: "0644"
    content: |
      [Service]
      Environment=STGUIADDRESS=0.0.0.0:8384
      Restart=always
      RestartSec=5

  # --- Disk hygiene (GOL-131) ---------------------------------------------
  # The 77G droplet hit 87-89% because ~57G accreted host-side under
  # /var/lib/docker (image layers + BuildKit cache from every CI
  # `docker compose up -d --build`) with no reclaim policy. These units codify
  # the reclaim so a rebuilt droplet inherits it — no snowflake click-ops.
  # Keep in sync with infra/scripts/install-disk-hygiene.sh (the running-box
  # install path). The scripts referenced below ship in the repo clone at
  # /opt/agenticos/repo/infra/scripts/.
  - path: /etc/systemd/system/agenticos-docker-prune.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS weekly Docker reclaim (system prune + builder prune, no volumes)
      After=network-online.target docker.service
      Wants=network-online.target
      Requires=docker.service

      [Service]
      Type=oneshot
      User=root
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/infra/scripts/docker-prune.sh'
      StandardOutput=append:/var/log/agenticos/docker-prune.log
      StandardError=append:/var/log/agenticos/docker-prune.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-docker-prune.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS Docker reclaim weekly (Sun 02:30 local)

      [Timer]
      OnCalendar=Sun *-*-* 02:30:00
      Persistent=true
      RandomizedDelaySec=300
      Unit=agenticos-docker-prune.service

      [Install]
      WantedBy=timers.target

  - path: /etc/systemd/system/agenticos-disk-guard.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS disk-guard (root FS check + Discord alert + reclaim at >=80%)
      After=network-online.target docker.service
      Wants=network-online.target

      [Service]
      Type=oneshot
      User=root
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/infra/scripts/disk-guard.sh'
      StandardOutput=append:/var/log/agenticos/disk-guard.log
      StandardError=append:/var/log/agenticos/disk-guard.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-disk-guard.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS disk-guard daily (05:00 local)

      [Timer]
      OnCalendar=*-*-* 05:00:00
      Persistent=true
      RandomizedDelaySec=300
      Unit=agenticos-disk-guard.service

      [Install]
      WantedBy=timers.target

  # paperclip-volume-guard (GOL-1632): disk-guard watches ONLY the root FS; the
  # paperclip-data docker volume is a separate filesystem, so its fill (hourly DB
  # dumps + server.log) is invisible to it. This hourly guard watches that
  # volume's headroom AND backup freshness → Discord.
  - path: /etc/systemd/system/agenticos-paperclip-volume-guard.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS paperclip-data volume guard (headroom + backup-freshness -> Discord)
      After=network-online.target docker.service
      Wants=network-online.target
      Requires=docker.service

      [Service]
      Type=oneshot
      User=root
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/infra/scripts/paperclip-volume-guard.sh'
      StandardOutput=append:/var/log/agenticos/paperclip-volume-guard.log
      StandardError=append:/var/log/agenticos/paperclip-volume-guard.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-paperclip-volume-guard.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS paperclip-volume-guard hourly (:20)

      [Timer]
      OnCalendar=*-*-* *:20:00
      Persistent=true
      RandomizedDelaySec=120
      Unit=agenticos-paperclip-volume-guard.service

      [Install]
      WantedBy=timers.target

  # host-clone drift-guard (GOL-1976): the host timers all run scripts out of the
  # /opt/agenticos/repo clone. GOL-1965/AgenticOS#650 fixed the PUSH path
  # (deploy-host-scripts.yml reset-hards the clone on infra/scripts or scripts
  # changes). This is the DETECTION layer — read-only fetch + HEAD-vs-origin/main
  # + origin-URL assertion, a few times/day, Discord on drift. It NEVER
  # resets/pulls (repair is #650's job). Runs as User=deploy (repo owner → same
  # fetch context #650 uses). Keep in sync with infra/scripts/install-drift-guard.sh.
  - path: /etc/systemd/system/agenticos-host-clone-drift.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS host-clone drift-guard (read-only HEAD-vs-origin/main + origin-URL check -> Discord)
      After=network-online.target
      Wants=network-online.target

      [Service]
      Type=oneshot
      User=deploy
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/infra/scripts/host-clone-drift-guard.sh'
      StandardOutput=append:/var/log/agenticos/host-clone-drift.log
      StandardError=append:/var/log/agenticos/host-clone-drift.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-host-clone-drift.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS host-clone drift-guard 4x/day (00/06/12/18:07 local)

      [Timer]
      OnCalendar=*-*-* 00/6:07:00
      Persistent=true
      RandomizedDelaySec=300
      Unit=agenticos-host-clone-drift.service

      [Install]
      WantedBy=timers.target

  # journald cap: bound /var/log/journal so it never balloons the root FS.
  - path: /etc/systemd/journald.conf.d/10-agenticos-cap.conf
    permissions: "0644"
    content: |
      [Journal]
      SystemMaxUse=200M
      SystemKeepFree=500M
      SystemMaxFileSize=50M
      RuntimeMaxUse=50M
      MaxRetentionSec=1month

  # logrotate: cap app logs (the timers append here) + Docker container
  # json-file logs (compose sets no per-container limit in this deployment).
  - path: /etc/logrotate.d/agenticos
    permissions: "0644"
    content: |
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

      # Paperclip origin log (GOL-1632): the paperclip-server container appends
      # its pino stream to server.log on the paperclip-data volume; unrotated it
      # reached 2.2G in the 2026-08-18 disk-full P0. Glob matches the host-side
      # volume mountpoint (compose namespaces it <project>_paperclip-data).
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

runcmd:
  # --- Swap file (GOL-53): OOM safety net so a RAM spike degrades to swap
  #     instead of hard-crashing the stack. 4G, low swappiness. Idempotent. ---
  - test -f /swapfile || (fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile)
  - grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  - sysctl -w vm.swappiness=10
  - echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf

  # --- SSH hardening ---
  - sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  - sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  - systemctl restart ssh

  # --- UFW baseline ---
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw --force enable

  # --- Docker Engine ---
  - curl -fsSL https://get.docker.com | sh
  - usermod -aG docker deploy

  # --- Tailscale (joins with auth key, no browser interaction) ---
  - curl -fsSL https://tailscale.com/install.sh | sh
  - tailscale up --authkey=${ts_authkey} --hostname=agenticos-droplet --ssh --accept-routes

  # --- Syncthing ---
  - mkdir -p /etc/apt/keyrings
  - curl -fsSL -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
  - echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" > /etc/apt/sources.list.d/syncthing.list
  - apt-get update
  - DEBIAN_FRONTEND=noninteractive apt-get install -y syncthing
  - loginctl enable-linger deploy
  # Reload systemd so it picks up the syncthing@deploy.service drop-in
  # (Environment=STGUIADDRESS=0.0.0.0:8384) we wrote in write_files above.
  # Without reload, the drop-in exists on disk but the unit cache doesn't
  # know about it. Then enable+start applies the env var on first boot,
  # so Syncthing binds to 0.0.0.0:8384 from the very first run — no need
  # to edit config.xml or restart later.
  - systemctl daemon-reload
  - systemctl enable --now syncthing@deploy.service
  - ufw allow in on tailscale0 to any port 8384 proto tcp
  # vault-server's /recent-changes probes host Syncthing REST via
  # host.docker.internal. Without this rule the container's SYNs hit
  # default-deny and BLACKHOLE (hang, not refusal) — dashboard showed
  # "Syncthing offline" while replication was healthy (2026-07-08 incident).
  # 172.16.0.0/12 = Docker's private default-address-pool range, so the rule
  # survives compose-network renumbering across re-provisions (the live box
  # was 172.18.0.0/16). REST auth still requires the X-API-Key on top.
  - ufw allow from 172.16.0.0/12 to any port 8384 proto tcp

  # --- Node 22 + pnpm ---
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  - npm install -g pnpm@9.15.4

  # --- Claude Code (OAuth login is a manual one-time step after this) ---
  # Install as the deploy user with a user-scoped npm prefix so auto-updates
  # work without sudo.  Root-global npm installs (which is what `npm install
  # -g` does by default) put the binary at /usr/lib/node_modules/... owned by
  # root, and Claude Code's self-update logic can't write there as deploy.
  # User-scoped prefix → deploy owns its npm-managed binaries → updates work.
  - mkdir -p /home/deploy/.npm-global
  - chown -R deploy:deploy /home/deploy/.npm-global
  - sudo -iu deploy npm config set prefix /home/deploy/.npm-global
  - |
    if ! sudo -iu deploy grep -q '.npm-global/bin' /home/deploy/.bashrc 2>/dev/null; then
      echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> /home/deploy/.bashrc
      chown deploy:deploy /home/deploy/.bashrc
    fi
  - sudo -iu deploy bash -lc 'npm install -g @anthropic-ai/claude-code'

  # --- Codex CLI (OpenAI's coder; API-key-billed, no interactive OAuth) ---
  # Installs under deploy's user-scoped npm prefix (already set by the Claude block
  # above), so auto-updates work without sudo. Authentication is done via
  # `codex login --with-api-key` after first secret-refresh — see Task 5's
  # refresh-secrets.sh which calls login after rewriting /opt/agenticos/.env.
  # For the FIRST boot of a fresh Droplet (before the secret-refresh timer
  # has fired), this block also does an initial login from OPENAI_API_KEY
  # in /opt/agenticos/.env if that env var is set.
  - sudo -iu deploy bash -lc 'npm install -g @openai/codex'
  - |
    if [ -f /opt/agenticos/.env ] && grep -q '^OPENAI_API_KEY=' /opt/agenticos/.env; then
      sudo -iu deploy bash -lc 'set -a && source /opt/agenticos/.env && set +a && printenv OPENAI_API_KEY | codex login --with-api-key'
    else
      echo "INFO: skipping initial codex login — OPENAI_API_KEY not yet in .env" >&2
    fi

  # --- Filesystem layout ---
  - mkdir -p /opt/agenticos /opt/vault /opt/backups /var/log/agenticos /etc/agenticos
  - chown -R deploy:deploy /opt/agenticos /opt/vault /opt/backups /var/log/agenticos /etc/agenticos

  # --- Clone repo ---
  - sudo -u deploy git clone https://github.com/${github_repo}.git /opt/agenticos/repo

  # --- Clone Paperclip fork (pinned to agenticos-v0.2.1) ---
  # Canonical fork repo name is Paperclip-AgenticOS (GitHub redirects the bare
  # `paperclip` name, but pin the real one). paperclip-server's compose service
  # builds its image from this clone at /opt/paperclip.
  # v0.1.1 hardens sanitizeRuntimeServiceBaseEnv to strip server-only host
  # secrets from spawned agent env (PR EngineeringMoonBear/Paperclip-AgenticOS#2).
  # v0.2.0 = fork master (upstream sync v2026.707.0, PR #3) + idempotent manual
  # issue creation + fast-return create (GOL-638): unique index migration 0136 +
  # origin_fingerprint derivation, so retried timed-out creates return the
  # existing row instead of duplicating. (Tag agenticos-v0.1.2 is DEFUNCT —
  # it was cut against the pre-sync v0.1.1 base before the droplet was found
  # to be running master; deploying it would downgrade below the DB schema.)
  # v0.2.1 = v0.2.0 + fleet-wide run-concurrency cap (GOL-1506 / GOL-557 lever 1,
  # PR #6): resolveGlobalMaxConcurrentRuns gates the queued->running chokepoint
  # on PAPERCLIP_MAX_CONCURRENT_RUNS (set to 5 in docker-compose.yml). On a LIVE
  # box, post-provision updates to /opt/paperclip ship via the
  # deploy-paperclip-server.yml workflow (git checkout <tag> + rebuild); this pin
  # is the source of truth for a fresh (re)provision.
  - sudo -u deploy git clone --branch agenticos-v0.2.1 --depth 1 https://github.com/EngineeringMoonBear/Paperclip-AgenticOS.git /opt/paperclip

  # --- AgenticOS docker-compose (telemetry DB + Ollama + OpenViking + Paperclip).
  #
  # The openviking-config directory in the repo holds ov.conf, which the
  # OpenViking container bind-mounts read-only at /app/.openviking/ov.conf.
  # We copy it to /opt/agenticos/openviking-config/ so the path is stable
  # even if the repo gets re-cloned. /opt/vault is created earlier in this
  # runcmd block (mkdir /opt/vault), and that ordering matters: the compose
  # `up -d` below tries to bind-mount /opt/vault into openviking, so it
  # must exist and be owned by deploy first.
  - |
    if [ -f /opt/agenticos/repo/docker-compose.yml ]; then
      cp /opt/agenticos/repo/docker-compose.yml /opt/agenticos/docker-compose.yml
      if [ -d /opt/agenticos/repo/openviking-config ]; then
        mkdir -p /opt/agenticos/openviking-config
        cp -a /opt/agenticos/repo/openviking-config/. /opt/agenticos/openviking-config/
        chown -R deploy:deploy /opt/agenticos/openviking-config
      fi
      # Symlink packages/ so the docker-compose build contexts for the Paperclip
      # plugins (./packages/<plugin>/) resolve relative to /opt/agenticos/
      # without copying the entire workspace.
      #
      # CRITICAL: `ln -sfn SRC DEST` does NOT replace an existing *directory* at
      # DEST — the -f flag only clobbers a file or an existing symlink, never a
      # real dir. If a stale real /opt/agenticos/packages already exists (left by
      # an earlier provision, a manual copy, or a failed prior link), `ln -sfn`
      # silently creates packages/packages INSIDE it and leaves the stale tree in
      # place — so every build then COPYs a frozen snapshot and ships stale code
      # while `git pull` only updates repo/packages. Guard against that: remove
      # any non-symlink at DEST first, then (re)link.
      if [ -e /opt/agenticos/packages ] && [ ! -L /opt/agenticos/packages ]; then
        rm -rf /opt/agenticos/packages
      fi
      ln -sfn /opt/agenticos/repo/packages /opt/agenticos/packages
      # Ensure /opt/agenticos/.env exists with correct ownership/perms before
      # we UPSERT secrets into it. Touch-only (no content) so the UPSERT
      # blocks below own every line we care about.
      if [ ! -f /opt/agenticos/.env ]; then
        touch /opt/agenticos/.env
        chmod 600 /opt/agenticos/.env
        chown deploy:deploy /opt/agenticos/.env
      fi
      # BETTER_AUTH_SECRET — required by paperclip-server in authenticated mode
      # (compose reads it from .env as $${BETTER_AUTH_SECRET}). Self-generated on
      # the Droplet (not a shared secret — it only signs local sessions). Set
      # ONLY when absent so a re-provision preserves the existing value and
      # doesn't invalidate live sessions.
      if ! grep -q '^BETTER_AUTH_SECRET=' /opt/agenticos/.env; then
        echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> /opt/agenticos/.env
      fi
      # PAPERCLIP_ALLOWED_HOSTNAMES — Paperclip's host allowlist (DNS-rebinding
      # guard). The dashboard reaches Paperclip at the VPC IP (10.116.16.2), so
      # that host must be allowed or every API call is rejected with
      # "Hostname '...' is not allowed for this Paperclip instance". There is no
      # file config in this deployment, so this env var IS the source of truth.
      # Set ONLY when absent so a re-provision preserves any operator additions.
      if ! grep -q '^PAPERCLIP_ALLOWED_HOSTNAMES=' /opt/agenticos/.env; then
        echo "PAPERCLIP_ALLOWED_HOSTNAMES=10.116.16.2,localhost,127.0.0.1" >> /opt/agenticos/.env
      fi
      # AgenticOS Postgres password — single source of truth is 1Password,
      # passed in by Terraform as the agenticos_db_password template var
      # (rendered below as a literal). Same UPSERT pattern as the OpenViking
      # key: set on a fresh Droplet, and CORRECT it on any re-provision so
      # the Droplet's .env never drifts from the value App Platform's
      # dashboard uses to construct AGENTICOS_DB_URL.
      #
      # IMPORTANT CAVEAT: the agenticos-db container only consults
      # POSTGRES_PASSWORD on FIRST init of its data volume. Rewriting the
      # value here on an existing Droplet updates the .env (so newly-started
      # containers read the new value) but does NOT change the password of
      # the existing `agenticos` Postgres role. A real rotation requires
      # either an `ALTER USER agenticos WITH PASSWORD '...'` against the
      # running DB, or a volume reset. See docs/runbooks/backup-and-recovery.md.
      if grep -q '^AGENTICOS_DB_PASSWORD=' /opt/agenticos/.env; then
        sed -i "s|^AGENTICOS_DB_PASSWORD=.*|AGENTICOS_DB_PASSWORD=${agenticos_db_password}|" /opt/agenticos/.env
      else
        echo "AGENTICOS_DB_PASSWORD=${agenticos_db_password}" >> /opt/agenticos/.env
      fi
      # Refuse to proceed if the value rendered empty (missing TF_VAR) — same
      # fail-loud posture as the OpenViking guard below.
      DB_PW=$(grep '^AGENTICOS_DB_PASSWORD=' /opt/agenticos/.env | cut -d= -f2-)
      if [ -z "$${DB_PW}" ]; then
        echo "FATAL: AGENTICOS_DB_PASSWORD missing in /opt/agenticos/.env; refusing to start (set TF_VAR_agenticos_db_password)" >&2
        exit 1
      fi
      # OpenViking root API key — single source of truth is 1Password, passed
      # in by Terraform as the openviking_root_api_key template var (rendered
      # below as a literal). We UPSERT it: set on a fresh Droplet, and CORRECT
      # it on any re-provision so the Droplet never drifts from the value
      # App Platform's dashboard uses. The guard further down refuses to start
      # OpenViking if this ends up empty or the placeholder, so a missing
      # TF_VAR fails the deploy loudly instead of shipping a weak key.
      if grep -q '^OPENVIKING_ROOT_API_KEY=' /opt/agenticos/.env; then
        sed -i "s|^OPENVIKING_ROOT_API_KEY=.*|OPENVIKING_ROOT_API_KEY=${openviking_root_api_key}|" /opt/agenticos/.env
      else
        echo "OPENVIKING_ROOT_API_KEY=${openviking_root_api_key}" >> /opt/agenticos/.env
      fi
      # Template the root_api_key into ov.conf. The repo ships a placeholder
      # (__OPENVIKING_ROOT_API_KEY__) and we substitute from .env so the
      # actual secret never lives in git. This runs AFTER the `cp -a` above,
      # which re-copies the repo's placeholder ov.conf over /opt on every
      # (re-)deploy — so we must re-substitute, and VERIFY, each time. If the
      # substitution is ever skipped or fails, the server would authenticate
      # with the well-known literal placeholder (a security hole) or, on an
      # empty key, every client breaks silently. We refuse to proceed in
      # either case: a failed provision is strictly better than a
      # placeholder-key server.
      #
      # Double-dollar on the shell-variable references escapes Terraform
      # templatefile() interpolation so the bash reference survives into the
      # rendered cloud-init for the shell to expand at boot. NOTE: do not
      # write the dollar-brace OV_KEY token in these comments either —
      # templatefile() scans the raw file bytes, comments included, and a
      # bare reference makes terraform plan fail with "vars map does not
      # contain key OV_KEY".
      if [ ! -f /opt/agenticos/openviking-config/ov.conf ]; then
        echo "FATAL: /opt/agenticos/openviking-config/ov.conf missing; cannot template OpenViking key" >&2
        exit 1
      fi
      OV_KEY=$(grep '^OPENVIKING_ROOT_API_KEY=' /opt/agenticos/.env | cut -d= -f2-)
      if [ -z "$${OV_KEY}" ] || [ "$${OV_KEY}" = "__OPENVIKING_ROOT_API_KEY__" ]; then
        echo "FATAL: OPENVIKING_ROOT_API_KEY missing or still the placeholder in /opt/agenticos/.env; refusing to start OpenViking" >&2
        exit 1
      fi
      sed -i "s|__OPENVIKING_ROOT_API_KEY__|$${OV_KEY}|g" /opt/agenticos/openviking-config/ov.conf
      # Post-condition: the placeholder MUST be gone now. If it survived (sed
      # no-match, CRLF, an edited delimiter, a stale copy racing the cp above),
      # we would otherwise boot a placeholder-key server. Abort instead.
      if grep -q '__OPENVIKING_ROOT_API_KEY__' /opt/agenticos/openviking-config/ov.conf; then
        echo "FATAL: ov.conf still contains the root_api_key placeholder after substitution; aborting before container start" >&2
        exit 1
      fi
      # Build the Paperclip plugin dists (vault / openviking / github) BEFORE
      # compose up. paperclip-server bind-mounts packages/<p>/dist into
      # /paperclip/plugins/<p>/dist, so the dist must exist or the plugins can't
      # load. Node + pnpm were installed earlier in this runcmd block; build as
      # deploy via a login shell so they're on PATH. (Updates post-provision are
      # handled by the deploy-droplet-plugins.yml GH Actions workflow.)
      sudo -iu deploy bash -lc 'cd /opt/agenticos/repo && pnpm install --frozen-lockfile --filter @agenticos/vault-plugin --filter @agenticos/openviking-plugin --filter @agenticos/github-plugin && pnpm --filter @agenticos/vault-plugin --filter @agenticos/openviking-plugin --filter @agenticos/github-plugin build'

      # Ensure the dedicated `paperclip` database exists before paperclip-server
      # starts (its DATABASE_URL targets .../paperclip, but agenticos-db only
      # auto-creates POSTGRES_DB=agenticos on first volume init). Bring up
      # Postgres first, wait for it, then CREATE DATABASE if absent (idempotent).
      cd /opt/agenticos && sudo -u deploy docker compose -f /opt/agenticos/docker-compose.yml --env-file /opt/agenticos/.env up -d agenticos-db
      for i in $(seq 1 30); do
        if sudo -u deploy docker exec agenticos-db pg_isready -U agenticos -d agenticos >/dev/null 2>&1; then break; fi
        sleep 2
      done
      if ! sudo -u deploy docker exec agenticos-db psql -U agenticos -d agenticos -tAc "SELECT 1 FROM pg_database WHERE datname='paperclip'" | grep -q 1; then
        sudo -u deploy docker exec agenticos-db psql -U agenticos -d agenticos -c "CREATE DATABASE paperclip"
        echo "created paperclip database"
      fi

      # --build so the locally-tagged images (agenticos/vault-server:local,
      # paperclip-server) are built on every fresh deploy. Idempotent: if an
      # image already exists at the same content hash, Docker reuses it.
      cd /opt/agenticos && sudo -u deploy docker compose -f /opt/agenticos/docker-compose.yml --env-file /opt/agenticos/.env up -d --build
    else
      echo "WARN: docker-compose.yml missing from repo; skipping db bring-up" >&2
    fi

  # --- Run dashboard migrations against agenticos-db ---
  # Applies apps/dashboard/migrations/*.sql via node-pg-migrate. Idempotent —
  # node-pg-migrate tracks applied migrations in the pgmigrations table and
  # skips ones already at the target version. Runs after the compose up -d so
  # agenticos-db is alive; the script also waits up to 60s for pg_isready.
  - chmod +x /opt/agenticos/repo/infra/cloud-init/scripts/run-migrations.sh
  - /opt/agenticos/repo/infra/cloud-init/scripts/run-migrations.sh

  # --- Ollama model pre-pull ---
  # Pre-pulls Qwen 2.5 3B (general SLM) and nomic-embed-text (embeddings for
  # OpenViking). Done after `docker compose up -d` so the container is alive.
  # Idempotent: ollama pull is a no-op if the model is already present.
  # Runs in background (`&`) so cloud-init doesn't block on the ~2.3 GB
  # download — first agent task after boot may wait if it triggers before
  # the pull completes, but that's a one-time first-deploy cost.
  - |
    if docker ps --format '{{.Names}}' | grep -q '^ollama$'; then
      for i in $(seq 1 30); do
        if docker exec ollama ollama --version > /dev/null 2>&1; then break; fi
        sleep 2
      done
      (docker exec ollama ollama pull qwen2.5:3b && \
       docker exec ollama ollama pull nomic-embed-text) &
    fi

  # --- Honcho reachability ---
  # Honcho's container binds 0.0.0.0:8000, but UFW (default deny incoming on
  # the public interface) keeps it off the open internet. We explicitly allow
  # port 8000 on:
  #   - eth1: the DigitalOcean VPC-private interface, so App Platform's
  #     dashboard service can reach HONCHO_URL=http://<vpc-private-ip>:8000
  #   - tailscale0: so the Mac (and any future Tailnet member) can hit Honcho
  #     directly over Tailscale for debugging / direct API calls.
  # Public IP traffic to :8000 remains blocked by the default-deny policy.
  - ufw allow in on eth1 to any port 8000 proto tcp
  - ufw allow in on tailscale0 to any port 8000 proto tcp

  # --- VPC service ports reachable from App Platform (eth1 = DO VPC interface) ---
  # The dashboard on App Platform reaches these Droplet services over the private
  # VPC; public-IP traffic stays blocked by default-deny. Honcho :8000 above is
  # retired and superseded by these. (Previously hand-added on the running Droplet;
  # codified here so a rebuild reproduces the working firewall — Paperclip :3100
  # being absent is what broke the dashboard cutover until it was opened.)
  - ufw allow in on eth1 to any port 3100 proto tcp   # Paperclip API
  - ufw allow in on eth1 to any port 1933 proto tcp   # OpenViking
  - ufw allow in on eth1 to any port 7779 proto tcp   # vault-server
  - ufw allow in on eth1 to any port 5432 proto tcp   # Postgres (AGENTICOS_DB_URL)

  # --- Curator timer (won't actually fire usefully until `claude /login` is done) ---
  - systemctl daemon-reload
  - systemctl enable --now agenticos-curator.timer

  # --- Postgres backup timer (daily pg_dump → /opt/backups, 14-day retention) ---
  - systemctl enable --now agenticos-pg-backup.timer

  # --- OpenViking memory backup timer (daily pack/backup → /opt/backups) ---
  - systemctl enable --now agenticos-viking-backup.timer

  # --- Disk hygiene (GOL-131): weekly docker reclaim + daily disk-guard ---
  # Ensure the reclaim scripts are executable, apply the journald cap now
  # (config alone only bounds FUTURE growth), then enable the timers.
  - chmod +x /opt/agenticos/repo/infra/scripts/docker-prune.sh /opt/agenticos/repo/infra/scripts/disk-guard.sh /opt/agenticos/repo/infra/scripts/paperclip-volume-guard.sh
  - systemctl restart systemd-journald
  - journalctl --vacuum-size=200M || true
  - systemctl enable --now agenticos-docker-prune.timer
  - systemctl enable --now agenticos-disk-guard.timer
  # paperclip-data volume headroom + backup-freshness watch (GOL-1632)
  - systemctl enable --now agenticos-paperclip-volume-guard.timer

  # --- Host-clone drift-guard (GOL-1976): read-only detection that the on-box
  # clone the host timers run from has drifted from origin/main. ---
  - chmod +x /opt/agenticos/repo/infra/scripts/host-clone-drift-guard.sh
  - systemctl enable --now agenticos-host-clone-drift.timer

  # --- Unattended security upgrades ---
  - echo 'APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
  - echo 'APT::Periodic::Update-Package-Lists "1";' >> /etc/apt/apt.conf.d/20auto-upgrades

final_message: |
  AgenticOS Droplet bootstrap complete.
  Manual steps remaining:
   1. SSH in and run `claude /login` to authenticate with Claude Max.
      Verify: `claude --print "hello"` returns a response.
   2. Configure the Paperclip plugins (token/key + register). The plugins are
      built and loaded, but their config (GitHub token, OpenViking key) is not
      set — Paperclip's plugin secret store is disabled in this version, so
      config lives in plugin config and is pushed from 1Password, never baked
      into the image. Mint a board key once:
        docker compose exec paperclip-server paperclipai token board create \
          --name secret-sync --never-expires
      store it in 1Password (AgenticOS Infra / paperclip_board_key), then from
      the Mac (tunnel open) run:
        TRIGGER_TRIAGE=1 scripts/sync-paperclip-secrets.sh
