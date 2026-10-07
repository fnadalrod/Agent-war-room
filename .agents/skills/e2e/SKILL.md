---
name: e2e
description: Run the real Claude Code end-to-end tests of Agent War Room (hooks → bridge → socket → service; approving a permission; typing into an app terminal) in isolation, and report the side effects. Use when touching the bridge, ingress, approvals, PTYs or the launcher.
---

# Real-Claude e2e

Background and pitfalls: `.cursor/rules/testing-e2e.md` (read it first if the run fails).

```sh
cargo build -p warroom-hook
cargo test -p awr-infrastructure --test claude_e2e -- --ignored --nocapture --test-threads=1
```

1. Tell the user it launches a real `claude` (short prompts; a little usage).
2. Expect ~5–10 s per approval or question test and ~60 s for the app terminal; ~95 s in all. On timeout, read the printed screen and view.
3. After: tell the user Claude left transcripts under `~/.claude/projects/-tmp-awr-e2e*`; delete them
   only if they ask.
