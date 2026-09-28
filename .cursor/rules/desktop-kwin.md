# Focusing windows with KWin

> Leaf of `desktop.mdc`. Read it before touching `desktop/kwin.rs` or when "go to" lands on the wrong window.

## Why a KWin script

On Wayland only the compositor may give focus to another app. We load a small JS script through DBus
(`busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss <path> <name>`, then
`run` on `/Scripting/Script<id>`), unloading the previous one by name first (a leftover with the same
name makes `loadScript` return -1). Works on X11 too. Detection: `XDG_CURRENT_DESKTOP` contains KDE
and `busctl status org.kde.KWin` succeeds.

## Choosing the window

Candidates are normal windows whose `pid` is in the PID chain (agent's ancestors, or the tmux
client's). One process often owns several windows (WebStorm had 5 projects open under one PID; Warp,
Konsole too), so the caption decides:

- hints in priority order: session title, worktree folder, repo name (lower-cased);
- a **whole-word** match weighs 10× a substring match — otherwise `Harbor` wins inside `Harbor3Repo`;
- closer ancestors win ties; minimized windows are restored; the desktop is switched if needed.

## Verifying

- `picks_the_window_whose_caption_names_the_worktree` runs the real script in Node against a fake
  `workspace` with real captions (skipped without Node).
- `kwin_live` (ignored) activates the window running the test — ask the user first.
- KWin's `print()` does not reach the journal: to inspect what a script sees, make it `callDBus` a
  non-existent name and watch with `dbus-monitor --session "interface='org.awr.Diag'"`.
