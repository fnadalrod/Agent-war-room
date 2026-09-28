---
name: anti-rot
description: Check that the agent docs (AGENTS.md, .cursor/rules, skills, subagents, nested pointers) still tell the truth about the code, and fix what doesn't. Use after refactors, renames or moves, or when a rule contradicts what you see in the code.
---

# Anti-rot

A stale rule sends the next agent to the wrong place; it is worse than no rule.

1. Mechanical pass: `python3 scripts/check_docs.py` (dead links and paths, unreachable rules, leaves
   without triggers, globs matching nothing, sizes). Fix everything it reports.
2. Judgement pass, per rule touched by recent changes (`git log --stat -20` to find them): open the
   rule, open the code it describes, and check each claim — function names, flows, numbers (timeouts,
   thresholds, limits), commands. The code wins: fix the rule, not the code.
3. Numbers and "verified" statements carry dates or versions (e.g. "Claude Code 2.1.283"); re-verify or
   mark them as unverified rather than silently keeping them.
4. Keep `AGENTS.md` an index: if you are adding explanations there, they belong in a rule.
5. Report what you changed and anything you couldn't verify.
