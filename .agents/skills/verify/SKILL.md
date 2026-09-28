---
name: verify
description: Pick and run the right verification for a change in Agent War Room (scoped checks, screenshots, real-Claude e2e, live desktop tests) and report honestly what was and wasn't verified. Use after every change and before claiming something works.
---

# Verify a change

1. Always: `scripts/check.sh` (scoped to what changed vs HEAD; quiet). Fix until `PASS`.
2. UI changed (`src/ui`, copy, styles, pixel art): `npm run shot -- /tmp/awr-shots` and **look** at the
   PNGs that matter (`classic`, `detail`, `changes`, `diff`, `subagent`, `filtered`, `pixel`). Tests
   don't catch layout, overlap or colour bugs; screenshots do. To save context, delegate to the
   `awr-screenshotter` subagent and get findings instead of images. A state the demo lacks → add it to
   `src/infrastructure/demoGateway.ts` first.
3. Bridge, socket, approvals, PTYs or launcher changed: real e2e (skill `e2e`). Costs a short Claude
   call — say so.
4. KWin/tmux/Warp focus changed: `cargo test -p awr-infrastructure kwin_live -- --ignored` focuses a real
   window on the user's desktop — ask first.
5. Before committing a multi-area change: `scripts/check.sh all`.

Report: what ran, what passed, and what you could **not** verify (real notifications, the installed
package, the app with the user's real sessions). Never claim unverified behaviour works.
