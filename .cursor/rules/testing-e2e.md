# Real-Claude end-to-end tests

> Leaf of `testing.mdc`. Read it before running or writing `claude_e2e.rs` tests. Procedure: skill `e2e`.

## Isolation (non-negotiable)

`Room::start` builds the real service with a temp git repo, its **own** `XDG_RUNTIME_DIR` (so its own
socket), an in-memory store and a `--settings` file whose hooks point at `target/debug/warroom-hook`.
tmux runs on a private socket. Nothing touches `~/.claude/settings.json` or the real app.

Side effect you cannot avoid: Claude writes transcripts under `~/.claude/projects/-tmp-awr-e2e*`. Tell
the user; delete only if asked.

## Pitfalls that each cost a failed run

- **Trust dialog first.** A new folder asks "trust this folder?" *after* `SessionStart` fired, so
  "session exists" is not "Claude is ready". Wait for the dialog text or for Working/NeedsYou.
- **Read-only commands don't ask permission** (`date`): use a write (`touch x.txt`) to trigger
  `PermissionRequest`.
- **Count the dialog options before pressing keys**: the permission dialog has 4 (Yes, Yes-always,
  Yes+auto mode, No). Pressing Down twice picked "auto mode" once.
- **Raw PTY**: answer DA1/XTVERSION, wait ~1 s, keys may be lost otherwise (`desktop-terminals.md`).
- **Unix socket paths < 108 bytes**: temp dirs under `/tmp`, not the scratchpad.
- **Always tear down the agent's tmux server**, also on failure: use `TmuxServer` (tests/e2e) right
  after `new-session`. A left-over server keeps a real agent running, spending and writing into a temp
  folder you already deleted (it happened: five Codex sessions survived failed runs).
- **`pkill -f pattern` kills the shell running it** if the pattern appears in that command line: use
  `pkill -f "[v]ite …"` in its own command.

## Expectations

Approval test ~8 s; app-terminal test ~60 s. A timeout prints the terminal screen and the last view:
read them before retrying.
