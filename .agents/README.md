# `.agents/`: single source for skills and subagents

Knowledge (how the code works) lives in `.cursor/rules/`; the index is `AGENTS.md`; procedures are
`skills/`; delegable workers are `agents/`. One rule: **single source + thin adapter per tool** (a
symlink, a settings file or a one-line import), never a copy — copies rot in weeks.

## What each tool loads

| Tool | Index `AGENTS.md` | Area rules (`.cursor/rules`) | Layer 0 (`engineering-discipline`) | Skills | Subagents |
|---|---|---|---|---|---|
| **Claude Code** (verified) | `@AGENTS.md` in `CLAUDE.md` | hook `scripts/rules_for_path.py` announces the rule of each file read/edited (once per session, with a section index for big ones); nested `CLAUDE.md` pointers | `@` import in `CLAUDE.md` | `.claude/skills` → symlink | `.claude/agents` → symlink |
| **Cursor** | native | native (`globs:` attach them) | `alwaysApply: true` | `.claude/skills` | `.claude/agents` |
| Codex, Gemini CLI, opencode, Copilot | read `AGENTS.md` natively (not verified here) | open them yourself from the `AGENTS.md` area list, or `python3 scripts/rules_for_path.py <file>` | obey "always read" in `AGENTS.md` | `.agents/skills` if supported | follow as playbooks |

## What it costs

Everything loaded every session is paid on every turn: `AGENTS.md` + `engineering-discipline.mdc` +
skill and subagent `description`s. Keep them lean: `AGENTS.md` names routers without listing their
leaves; explanations go into rules; rules push rarely-needed detail into leaves with a trigger.
Measure with `wc -c AGENTS.md .cursor/rules/engineering-discipline.mdc` before adding lines.

## What is lost outside Claude Code

- "No AI attribution" and "ask before push/reset" are enforced in `.claude/settings.json`; elsewhere
  only the prose in `AGENTS.md` and `close-task` protects them — keep that prose.
- Which rule covers a file: Cursor knows from `globs`; Claude Code from the hook; everyone else runs
  `scripts/rules_for_path.py`.
