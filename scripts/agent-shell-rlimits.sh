# agent-shell-rlimits.sh — per-agent-shell CPU containment (GOL-2045).
#
# Sourced by EVERY non-interactive agent Bash command via BASH_ENV (set on the
# paperclip-server container in docker-compose.yml). This is the in-container
# half of GOL-2043 containment: the Docker `cpus`/`pids_limit`/`cpu_shares`
# caps bound the container against its SIBLINGS, but github-sync runs as a
# plugin worker INSIDE paperclip-server, so cross-container caps cannot protect
# it from a co-tenant agent. This file bounds and de-prioritises the agent
# shells themselves so a runaway process cannot burn ~128 CPU-hours or starve
# the github-sync worker again.
#
# Why BASH_ENV and not a container-wide ulimit:
#   A docker-compose `ulimits.cpu` sets RLIMIT_CPU on PID 1 of the container,
#   which is inherited by the long-lived node paperclip-server process — it
#   would accumulate CPU-seconds over its lifetime and eventually be SIGKILLed
#   (an outage). BASH_ENV is sourced only by the agent's `bash` shells, so the
#   limits land on agent command processes and NOT on the server / plugin
#   workers (which are node, not bash). Verified: bash sources BASH_ENV for
#   non-interactive shells; `ulimit -S/-H -t` sets RLIMIT_CPU; the kernel raises
#   SIGXCPU at the soft limit and SIGKILL at the hard limit; both are inherited
#   by child processes (including backgrounded `cmd &`, the grep-on-/ escape),
#   each child accounting its own CPU time.
#
# All operations are best-effort (`|| true`, `command -v` guards): a shell that
# cannot renice or set a limit must still run the agent's command. RLIMIT_CPU
# is a hard limit an unprivileged process can only LOWER, so an agent cannot
# raise it back to escape the cap; nice can only be increased (deprioritised)
# by unprivileged callers, so it cannot be undone either.

# 1) De-prioritise agent work relative to the node server + github-sync plugin
#    worker (both run at nice 0). Under CPU contention the kernel then favours
#    the server, so github-sync stays responsive while an agent is busy. renice
#    lives in util-linux which may be absent from a slim image — guarded.
command -v renice >/dev/null 2>&1 && renice -n 10 "$$" >/dev/null 2>&1 || true

# 2) Bound per-process CPU TIME (not wall-clock): a CPU-bound runaway is
#    SIGXCPU'd at the soft limit and hard-killed at the hard limit, regardless
#    of the Bash tool's wall-clock timeout or whether the command was
#    backgrounded. Tunable; these values crush a 128 CPU-hour runaway to <=1
#    CPU-hour (>100x) while leaving ample headroom for legitimate single-process
#    builds/tests (which rarely exceed a few CPU-minutes). Flags MUST be
#    separate (`-S -t`) — the combined form `-St` does not parse.
#    Set SOFT before HARD: lowering the hard limit while the soft limit is still
#    higher (e.g. the inherited default `unlimited`) is rejected as soft>hard, so
#    the soft cap must land first. Each call only ever tightens — if an inherited
#    limit is already lower these calls no-op (a widen would need privilege).
_gol2045_soft=1800   # 30 CPU-minutes  -> SIGXCPU (terminates, signals monitoring)
_gol2045_hard=3600   # 60 CPU-minutes  -> SIGKILL backstop
ulimit -S -t "$_gol2045_soft" 2>/dev/null || true
ulimit -H -t "$_gol2045_hard" 2>/dev/null || true
unset _gol2045_soft _gol2045_hard
