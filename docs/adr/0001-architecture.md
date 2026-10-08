# ADR 0001 — Agent War Room architecture

- Status: accepted
- Date: 2026-09-28

## Context

We work with several agents (Claude Code, others in the future) in parallel, spread across
repositories, worktrees and terminals. Windows get lost and you have to watch by hand for when an agent
finishes or asks for something. We want a single "war room" that routes attention: you only look at it
when something needs you.

## Decision

### Rust core, hexagonal, with the dependency rule enforced by crates

```
crates/domain          pure: no IO, no tokio, no tauri (serde only)
crates/application     use cases + ports (traits) + read model (DTOs exported to TS)
crates/infrastructure  adapters: Claude provider, socket ingress, SQLite, git, /proc, installer
crates/wire            socket contract between the hook bridge and the app (serde only)
crates/hook-bridge     `warroom-hook` binary that Claude runs on every hook
src-tauri              composition root + inbound (commands) and outbound (tray, notifications) adapters
src/                   layered React: domain · application · infrastructure · ui
```

`domain` knows nothing about Claude. Claude is an adapter of the `AgentProvider` port; other providers
(opencode, Codex, Gemini) can be added without touching the core. TS only paints: state lives in Rust
so the tray and notifications keep working with the window closed.

### Ingest: hooks + Unix socket

`warroom-hook` reads the hook JSON from stdin, wraps it with context that only exists at that moment
(parent process chain → agent and terminal PIDs, `$TMUX_PANE`, `$TERM_PROGRAM`) and sends it to
`$XDG_RUNTIME_DIR/agent-war-room/ingress.sock`. Invariants: **it writes nothing to stdout, always exits
0, and returns within milliseconds if the app is not running**. It can never break or slow down the
agent.

The installer merges non-destructively into `~/.claude/settings.json` (keeps foreign hooks, leaves a
backup) and uninstalls cleanly.

### State: append-only events + fold

Everything that changes state is a `SessionEvent` (agent signals and user intents: seen, archive,
mute). They are persisted in SQLite and the state is rebuilt at startup by folding them. Tests replay
event sequences.

### Attention model

| Attention  | When                                                          |
|------------|---------------------------------------------------------------|
| `NeedsYou` | asks for permission or asks a question (AskUserQuestion, plan) |
| `Finished` | finished its turn and you have not seen it                    |
| `Working`  | running / compacting                                          |
| `Idle`     | waiting, already seen                                         |
| `Offline`  | session closed or process lost                                |

- **Archive** ("dismiss"): hides the session and stops its notifications even if the process is still
  alive. It unarchives itself if you write to it again (`UserPromptSubmit`). Killing the process is a
  separate, explicit action.
- **Mute**: still visible, but it does not notify nor count towards the tray's aggregate color.
- A repo is identified by its `git common dir`: worktrees land in the same room.

### "Go to" before "write"

Priority: jump to the right window or pane.

- **Warp:** focuses the exact pane with `WARP_FOCUS_URL`, which the bridge captures.
- **tmux:** selects the pane and focuses its client's terminal.
- **KDE Plasma (X11 and Wayland):** a KWin script loaded over DBus looks for the window whose PID is in
  the agent's process chain. If several windows share the process, the title breaks the tie, weighting
  whole-word matches higher (`Harbor` does not win on `Harbor3Repo`).

Writing into a session is only possible if it runs in an app terminal (PTY linked through
`AWR_PTY_ID`) or in tmux.

### Approving permissions from the app

Verified against real Claude Code (2.1.283):

- The `PermissionRequest` dialog is shown in the terminal **while** the hook is running.
- If the hook answers first, Claude applies its decision.
- If you answer in the terminal first, Claude kills the hook and discards its answer.

So the bridge waits for the app's decision (600 s timeout) without blocking anyone, and no toggle is
needed. The app detects the connection's EOF to withdraw the approve button.

### Agents launched from the app

- They start in a login shell, because the desktop PATH does not include `~/.local/bin`.
- They do not inherit the sub-session markers (`CLAUDECODE`, `CLAUDE_CODE_*`…). With them Claude would
  consider itself a subprocess and would not write a transcript.
- **Resume in Warp:** a Tab Config is written (`awr-*.toml`, deleted after 24 h) and opened with
  `warp://tab_config/…`.

## Phases

All implemented:

- **F0**: bridge, ingest, state machine, tray with the aggregate color, notifications, classic view per
  repo, archive/mute/seen and installer.
- **F1**: "go to" (Warp, tmux, KWin), incremental transcript reading and subagent activity.
- **F2**: approve or deny permissions from the app, built-in terminals, writing into sessions, and
  launching or resuming agents (in the app or in Warp).
- **F3**: pixel-art War Room on the same read model. It is low-resolution Canvas 2D with its own bitmap
  font: PixiJS was not needed.

Pending or out of scope for now:

- Killing an agent's process from the app.
- Providers other than Claude (the `AgentProvider` port is ready).
- Desktops other than KDE for "go to" (macOS and Windows: done, ADR 0002).
- macOS (done, ADR 0002).

## Consequences

- Initial target platform: Linux (KDE Wayland). macOS and Windows since ADR 0002.
- The read-model types are generated from Rust (`ts-rs`) into `src/domain/generated`: the front does
  not duplicate contracts by hand.
- Outside Tauri, the front uses demo adapters that implement the same ports.
- Nothing is recorded while the app is closed (the bridge drops events). Acceptable: the app lives in
  the tray.
