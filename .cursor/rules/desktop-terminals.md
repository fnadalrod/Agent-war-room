# App terminals, launching, resuming and typing

> Leaf of `desktop.mdc`. Read it before touching `pty.rs`, `launch.rs`, `desktop/tmux.rs::send_text` or
> the xterm panel.

## PTYs (pty.rs)

`PtyManager::spawn` runs a process in a PTY with `AWR_PTY_ID=<id>` in its env: its hooks carry that id,
which links the session to the terminal (`TerminalHost::pty_id`). A reader thread pumps output to the
sink (Tauri event `pty://output`, base64 because a chunk can split a UTF-8 char) and keeps 1 MB of
scrollback for re-attaching. Closing the window keeps PTYs alive (app lives in the tray).

## Launching (launch.rs::DesktopLauncher)

- App target: `$SHELL -l -c "exec claude [--resume <id>]"` — a login shell because desktop-launched
  apps don't have `~/.local/bin` in `PATH`. On Windows: `%ComSpec% /D /C claude …` (cmd finds both
  `claude.exe` and npm's `claude.cmd`). Inherited Claude session markers are scrubbed
  (`hooks-claude-reference.md`).
- Resume runs in the session's **exact cwd** (`Session::launch_dir`): Claude stores sessions per
  directory. The id is validated (`[A-Za-z0-9-]`) before reaching a shell.
- Warp target: writes a Tab Config `awr-<id>.toml` in `~/.local/share/warp-terminal/tab_configs/`
  (swept after 24 h) and opens `warp://tab_config/<stem>`. Warp URIs can't run commands; tab configs can.
  **Unverified live**: whether Warp picks up a new file without restarting.

## Typing into a session (launch.rs::TerminalInput)

PTY → write text, wait ~60 ms, then `\r` (sent together, Enter would be taken as a pasted newline).
tmux → `send-keys -l <text>` then `Enter`. Anything else → error "use Go to".

## Driving Claude's TUI in a raw PTY (tests)

Without a terminal emulator the TUI's queries go unanswered and keys get lost. Answer DA1
(`\x1b[?62;22c`) and XTVERSION, wait ~1 s before keys, send Down as `\x1b[B`. xterm.js does all this
in the app. Output contains cursor-positioning codes between words: match words, not phrases.
