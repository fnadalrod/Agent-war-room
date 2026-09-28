---
name: e2e
description: Run the real Claude Code end-to-end tests of Agent War Room (hooks → bridge → socket → service; approvals; typing into an app terminal) in isolation, and clean up after. Use when touching the bridge, ingress, approvals, PTYs or the launcher.
---

# Real Claude e2e

```sh
cargo build -p warroom-hook
cargo test -p awr-infrastructure --test claude_e2e -- --ignored --nocapture --test-threads=1
```

- Each test launches a real `claude` (short prompt; costs a little usage) in a temp git repo with its
  own `XDG_RUNTIME_DIR` socket, `--settings` hooks and tmux socket. It never touches the user's config.
- Expected: ~8 s (approval) and ~60 s (app terminal). A timeout prints the terminal screen and the
  last view: read it before retrying.
- Side effect: Claude stores transcripts under `~/.claude/projects/-tmp-awr-e2e*`. Tell the user;
  delete them only if they ask.
- Driving a raw PTY: answer DA1/XTVERSION queries and wait ~1 s before keys (see the PTY test).
