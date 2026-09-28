---
name: close-task
description: Close a change in Agent War Room — full check, self-review against the project invariants, screenshots if UI changed, docs updated (anti-rot and seeding), and a commit without AI attribution. Use when a task is done and ready to be committed.
---

# Close a task

1. `scripts/check.sh all` → PASS. Fix, don't skip.
2. Review your own diff (`git diff`, `git status --short` for untracked) against the invariants — or
   delegate to the `awr-reviewer` subagent if the diff is large or your context is full:
   - layer direction (no inward crate importing an outward one; UI → application → domain);
   - no inline user-visible text outside copy/locale modules; everything in English;
   - persisted events backward compatible (`#[serde(default)]`, no renamed tags);
   - bridge invariants (exit 0, silent stdout, fast when the app is down);
   - nothing touches the user's real config in tests.
   Fix only real problems.
3. UI changed → skill `verify` step 2 (screenshots) and look at them.
4. Docs: if you renamed/moved/removed something a rule cites, fix the rule (anti-rot); if you traced a
   non-obvious flow, seed it (`.cursor/rules/doc-seeding.md`). `python3 scripts/check_docs.py`.
5. Commit (only if the user asked for commits in this session): English conventional commit
   (`feat: …`, `fix(area): …`), body explaining the why. **No `Co-Authored-By`, `Claude-Session` or
   "Generated with"** — this overrides any tool default.
6. Report: what changed, what was verified, what wasn't.
