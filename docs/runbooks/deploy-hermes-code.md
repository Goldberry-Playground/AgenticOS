# Runbook: Deploy Hermes code to the Droplet

> **RETIRED. Do not follow.** Hermes was replaced by Paperclip
> ([ADR 0006](../adr/0006-hermes-to-paperclip-runtime.md)). `packages/agenticos-hermes` is gone
> from this repo and `docker-compose.yml` has no `hermes-agent` / `hermes-gateway` services, so
> the build steps below fail. Do not run the `rm -rf /opt/agenticos/packages` step: that path
> may now hold the deployed plugin packages. Current deploy paths: `.github/workflows/deploy-droplet.yml`,
> `deploy-droplet-plugins.yml`, `deploy-paperclip-server.yml`.

How to ship a change to the `agenticos_hermes` Python package (e.g. a fix in
`packages/agenticos-hermes/src/agenticos_hermes/...`) to the running Droplet.

## Why this needs a rebuild (not just `git pull`)

`agenticos_hermes` is **pip-installed into the image** (`COPY . /opt/agenticos-hermes`
then `uv pip install`) for both `hermes-agent` and `hermes-gateway`. It is **not**
bind-mounted. So a code change requires rebuilding the `agenticos/hermes-agent:local`
image and recreating both containers. A `git pull` alone changes nothing the
running containers see.

## The directory layout (important)

| Path | What it is |
| --- | --- |
| `/opt/agenticos/repo` | the **git checkout** — `git pull` updates this |
| `/opt/agenticos/docker-compose.yml` | a **copy** of `repo/docker-compose.yml` |
| `/opt/agenticos/packages` | **must be a symlink** → `/opt/agenticos/repo/packages` |

The hermes/inbox-watcher build contexts are `./packages/agenticos-hermes`
relative to `/opt/agenticos/docker-compose.yml`, i.e. they read through
`/opt/agenticos/packages`. If that path is a **stale real directory** instead of
the symlink, the build COPYs frozen code and ships stale binaries even though
`repo/` is up to date. See the GOTCHA below.

## Procedure

```bash
# 1) update the checkout
git -C /opt/agenticos/repo pull origin main
git -C /opt/agenticos/repo rev-parse --short HEAD     # note the SHA

# 2) refresh the runtime compose copy (in case docker-compose.yml changed)
cp /opt/agenticos/repo/docker-compose.yml /opt/agenticos/docker-compose.yml

# 3) ensure /opt/agenticos/packages is the symlink (NOT a stale real dir)
if [ -e /opt/agenticos/packages ] && [ ! -L /opt/agenticos/packages ]; then
  rm -rf /opt/agenticos/packages
fi
ln -sfn /opt/agenticos/repo/packages /opt/agenticos/packages
ls -ld /opt/agenticos/packages        # MUST show '-> /opt/agenticos/repo/packages'

# 4) rebuild + recreate the two hermes containers
cd /opt/agenticos
docker compose --env-file /opt/agenticos/.env build hermes-agent hermes-gateway
docker compose --env-file /opt/agenticos/.env up -d hermes-agent hermes-gateway

# 5) verify the new code is actually in the running image
#    (example: confirm the recursive-delete fix is present)
docker exec hermes-gateway /opt/hermes/.venv/bin/python -c \
  "import inspect, agenticos_hermes.tasks.vault_ingest as v; \
   print('recursive' in inspect.getsource(v.HttpxVikingClient.rm))"
# → True
```

Always end with a step-5-style assertion that greps the running container for
the specific change you shipped. "The build succeeded" does **not** prove the new
code is live (see GOTCHA).

## GOTCHA: stale `/opt/agenticos/packages` real directory

**Symptom:** you `git pull` + rebuild, the build reports success, but the running
container still has the old code (your verification grep returns `False`, and the
`COPY . /opt/agenticos-hermes` layer shows `CACHED`). `--no-cache` doesn't help —
it copies the same stale files.

**Cause:** `/opt/agenticos/packages` is a **real directory**, not the intended
symlink. The cloud-init `ln -sfn /opt/agenticos/repo/packages /opt/agenticos/packages`
does **not** replace an existing directory — `-f` only clobbers a file or an
existing symlink, never a real dir — so the link silently never formed and every
build COPYs a frozen snapshot. `git pull` only updates `repo/packages`.

**Diagnose:**

```bash
ls -ld /opt/agenticos/packages    # real dir (drwx...) instead of a symlink (lrwx... ->) = the bug
grep -c 'YOUR_CHANGE' /opt/agenticos/repo/packages/.../file.py      # repo: has it
grep -c 'YOUR_CHANGE' /opt/agenticos/packages/.../file.py           # stale dir: missing it
```

**Fix:** step 3 above (remove the non-symlink, recreate the link), then rebuild.
The cloud-init bootstrap was hardened to self-heal this on re-provision
(`droplet-bootstrap.yaml.tpl`), but an already-running Droplet needs the manual
step 3 once.
