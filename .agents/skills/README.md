# Skills

Procedures you follow yourself (they spend your context; their value is in the steps). One folder per
skill with a `SKILL.md` (`name` + `description` frontmatter — the description is loaded every session,
keep it to what decides *when* to use it). `.claude/skills` is a symlink to this folder.

| Skill | Use when |
|---|---|
| `verify` | after any change, before saying it works: picks checks, screenshots, e2e |
| `extend-session-model` | a feature needs new per-session data (hook signal or transcript fact) end to end |
| `add-provider` | supporting another coding agent (Codex, Gemini, opencode…) |
| `e2e` | touching the bridge, socket, approvals, PTYs or launcher: real-Claude tests |
| `close-task` | finishing a change: full check, self-review against the invariants, docs, commit |
| `anti-rot` | docs may be stale (after a refactor, or when a rule contradicts the code) |

Rule of thumb (same as `.agents/agents/README.md`): if it reads 10× more than it writes, it is a
subagent; if it only wraps a deterministic command, it belongs in `scripts/`, not here.
