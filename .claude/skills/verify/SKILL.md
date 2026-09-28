---
name: verify
description: Pick and run the right verification for a change in Agent War Room (scoped checks, screenshots, live/e2e tests) and report the result honestly. Use after every change and before saying something works.
---

# Verify a change

1. Always: `scripts/check.sh` (scoped to what changed vs HEAD; quiet). Fix until `PASS`.
2. UI changed (anything under `src/ui`, copy, styles, pixel art): `npm run shot -- /tmp/awr-shots`
   and **read** the PNGs you care about (`classic`, `detail`, `subagent`, `filtered`, `pixel`).
   Tests don't catch layout, overlap or color bugs; screenshots do.
3. Touched hooks, the bridge, the socket, approvals, PTYs or the launcher: run the real e2e
   (skill `e2e`). It costs a short Claude call — say so to the user when you run it.
4. Touched KWin/tmux/Warp focus: `cargo test -p awr-infrastructure kwin_live -- --ignored` focuses a
   real window on the user's desktop — ask first.
5. Before committing a multi-area change: `scripts/check.sh all`.

Report: what you ran, what passed, and what you could **not** verify (e.g. notifications on the real
desktop, the packaged RPM). Never claim unverified behaviour works.
