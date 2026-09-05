# Agent-runtime guards

Small, dependency-free hooks that bound dangerous agent tool calls at the
Paperclip / Claude-Code runtime boundary. They are the cheap **first line** of
defense; container-level CPU/memory quotas are the **blast-radius** line and are
tracked separately in infra.

## `bound-recursive-fs-search.mjs` (GOL-2043)

A `PreToolUse` hook for the **Bash** tool. It denies unbounded recursive
filesystem searches whose root is the filesystem root (`/`), `$HOME`/`~`, or any
top-level system directory (any absolute path of depth ≤ 1, e.g. `/opt`,
`/var`, `/mnt`).

This is the exact class of command behind the incident that motivated the guard:
a runaway `grep -r … /` that burned ~128 CPU-hours and starved `github-sync`
inbound.

**Precision over recall.** Ordinary in-repo searches are never touched:

| Blocked                         | Allowed                                   |
| ------------------------------- | ----------------------------------------- |
| `grep -r pattern /`             | `grep -rn pattern ./src`                  |
| `find / -name '*.log'`          | `find . -name '*.ts'`                     |
| `rg needle /opt`                | `rg needle src/`                          |
| `grep -ri secret $HOME`         | `grep -n foo /etc/hosts` (no `-r`)        |
| `tree /`, `ls -R /`, `fd . /`   | `ls -la /` (not a recursive search)       |

Covered commands: `grep`/`egrep`/`fgrep` (only with `-r`/`-R`/`--recursive`),
`rg`, `fd`/`fdfind`, `find`, `tree` (recursive by default), and `ls` (with
`-R`). Transparent wrappers (`sudo`, `nice -n N`, `ionice`, `time`, `nohup`,
`env VAR=…`) and simple `; && || |` chaining are seen through.

Commands with **no** path argument (e.g. bare `rg foo`, `grep -r foo`) are
**allowed** — they search the current directory, whose depth the hook cannot
know, and blocking them would produce constant false positives. Containment for
an evasive `cd /; grep -r x .` is the container CPU quota, not this hook.

### Behavior

- **stdin**: the standard hook JSON `{ tool_name, tool_input: { command }, … }`.
- **Allow**: exit `0`, no output.
- **Deny**: exit `0` and print
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}`.
  The reason tells the agent to scope the search to the project directory.
- **Fails open**: malformed input or a non-Bash tool is never blocked.
- **Escape hatch**: `GROVE_FS_GUARD_DISABLE=1` bypasses the guard for deliberate
  operator sweeps.

### Test

```bash
node scripts/guards/bound-recursive-fs-search.test.mjs   # 41 assertions, no deps
```

### Installing into the harness (governance — CEO owns this)

This repo does **not** self-install the guard. The runtime that executes agent
Bash calls is Paperclip, and enabling a company-wide `PreToolUse` hook is a
governance change. To activate it, add the hook to the harness `settings.json`
that fronts the agent fleet:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node /opt/AgenticOS/scripts/guards/bound-recursive-fs-search.mjs"
          }
        ]
      }
    ]
  }
}
```

Point the path at wherever this repo is checked out on the runtime host. Once
installed, the guard applies to every agent's Bash calls without any per-agent
change.
