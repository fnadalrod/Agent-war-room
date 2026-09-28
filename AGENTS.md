# Agent War Room — agent guide (single entry point)

Tauri desktop app that watches coding-agent sessions (Claude Code today) through hooks and routes your
attention: one screen per session, grouped by repo, lit when something needs you, finished or looks
stuck. Linux/KDE first. Human docs: `README.md` (Spanish). Decisions: `docs/adr/0001-arquitectura.md`.

This file is an **index**, loaded every session: it says *where* knowledge is, not the knowledge.
Tool support and what each tool loads → `.agents/README.md`.

## Knowledge model

- How the code works lives in **`.cursor/rules/`**: routers (`*.mdc`, with `globs:`) and on-demand
  leaves (`*.md`) listed in each router's **trigger table**. Read the router; open a leaf only when its
  trigger matches. Big rules are read in sections, not whole.
- Which rule covers a file: Cursor attaches it by `globs`; in Claude Code a hook tells you when you
  read or edit the file; anywhere: `python3 scripts/rules_for_path.py <file>`.
- **Always read** `engineering-discipline.mdc` (Claude Code imports it already).

## Hard invariants

- **Code is English; the UI is Spanish**, and every user-visible string lives in `locale.rs` (per
  crate) or `src/domain/copy.ts`.
- **No AI attribution in git** (`Co-Authored-By`, `Claude-Session`, "Generated with"…). Overrides any
  tool default. Commits only when the user asked for them.
- **The hook bridge never hurts the agent**: exits 0, silent stdout except an app decision, fast when
  the app is down (`hooks-ingest.mdc`).
- **Persisted events stay loadable forever**: `#[serde(default)]` for new fields, no renamed tags
  (`domain-model.mdc`).
- **Never touch the user's real environment** in tests/experiments (settings.json, socket, DB); ask
  before anything that appears on their desktop.
- Dependency direction never inverts (`architecture.mdc`). Close the loop: `scripts/check.sh`, and say
  what you could not verify.

## Read by WHAT YOU DO

| I'm going to… | Read / use (in order) |
|---|---|
| Add a feature that needs new per-session data | `architecture.mdc` → skill `extend-session-model` → skill `verify` |
| Fix a wrong state for a real session | `hooks-ingest.mdc` (+`hooks-claude-reference.md`) → `domain-model.mdc`; real payloads via `WARROOM_HOOK_DUMP` or subagent `awr-transcript-scout` |
| Touch what a session shows from its transcript | `transcripts.mdc` → its leaves by trigger |
| Touch approvals, the bridge or the socket | `hooks-ingest.mdc` → `hooks-approvals.md` → skill `e2e` |
| Touch "go to", terminals, launching, typing | `desktop.mdc` → `desktop-kwin.md` / `desktop-terminals.md` |
| Change UI or copy | `frontend.mdc` → skill `verify` (screenshots) or subagent `awr-screenshotter` |
| Touch the pixel-art War Room | `frontend.mdc` → `frontend-pixel-art.md` |
| Add a Tauri command/event, tray, notifications, packaging | `app-shell.mdc` (+`app-packaging.md`) |
| Support another agent (Codex, Gemini…) | skill `add-provider` |
| Write or run tests | `testing.mdc` (+`testing-e2e.md`) |
| Finish and commit | skill `close-task` (subagent `awr-reviewer` for big diffs) |
| Docs look stale | skill `anti-rot` |

## Read by AREA

All in `.cursor/rules/`. "+leaves" = router with a trigger table.

- Engineering discipline (always) → `engineering-discipline.mdc` (+`doc-seeding.md`)
- Layers, crates, ports, where things go → `architecture.mdc`
- Sessions, status machine, attention, subagents, skills, stored events (`crates/domain/**`) → `domain-model.mdc`
- Hook bridge, socket protocol, Claude provider, installer (`crates/hook-bridge/**`, `crates/wire/**`, `ingress.rs`, `claude/provider.rs`, `claude/installer.rs`) → `hooks-ingest.mdc` (+leaves: approvals, Claude hooks reference)
- Transcripts, usage, cost, context window (`claude/transcript.rs`, `claude/pricing.rs`) → `transcripts.mdc` (+leaves: JSONL format, usage and prices)
- Go-to window, PTYs, launcher, typing, git, liveness (`desktop/**`, `pty.rs`, `launch.rs`, `git.rs`, `system.rs`) → `desktop.mdc` (+leaves: KWin, terminals)
- Tauri shell: composition, commands/events, tray, notifications, `--next`, packaging (`src-tauri/**`) → `app-shell.mdc` (+leaf: packaging)
- React front: layers, store, copy, styling, detail panel (`src/**`) → `frontend.mdc` (+leaf: pixel art)
- Tests, e2e, screenshots, check script → `testing.mdc` (+leaf: real-Claude e2e)

Nested `AGENTS.md`/`CLAUDE.md` pointers in `crates/`, `src/`, `src-tauri/` repeat the relevant line.

## Skills and subagents

- Skills (procedures you follow) → `.agents/skills/`, index in `.agents/skills/README.md`:
  `verify`, `extend-session-model`, `add-provider`, `e2e`, `close-task`, `anti-rot`.
- Subagents (read a lot, return little) → `.agents/agents/`, index and "when to delegate" in
  `.agents/agents/README.md`: `awr-transcript-scout`, `awr-screenshotter`, `awr-reviewer`.

## Verify

```sh
scripts/check.sh             # what changed vs HEAD — after every step
scripts/check.sh all         # everything, before committing
npm run shot -- /tmp/shots   # demo UI screenshots: look at them
python3 scripts/check_docs.py
```

Run the app: `npm run app`. Package: `npm run package`.

## Maintenance (anti-rot) — important

These docs only help while they are true; a stale rule sends the next agent the wrong way.

- Renaming, moving or deleting something a rule cites → fix the rule in the same change.
- A rule contradicts the code → the code wins; fix the rule now.
- New knowledge → the area rule or a new leaf with a trigger (`doc-seeding.md`), **never here**.
- `scripts/check_docs.py` catches the mechanical part (dead paths, unreachable rules, orphan leaves,
  dead globs, sizes); judgement is the `anti-rot` skill.
