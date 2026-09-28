---
name: add-provider
description: Add support for another coding agent (Gemini CLI, opencode…) next to Claude Code and Codex — its hook/event source, translation to domain events, transcript reader, installer, skills and launcher, reusing the shared pieces. Use when asked to monitor an agent that isn't supported yet.
---

# Add an agent provider

Codex was added this way; copy its shape (`crates/infrastructure/src/codex/`, `codex.mdc`). Read
`architecture.mdc` and `hooks-ingest.mdc` first. Aim: the new agent brings only what differs.

1. **Research the real integration points, don't assume.** Run the agent isolated (its own config
   home, temp dir, private tmux) with a hook that dumps stdin, and keep the samples as fixtures.
   Schemas may be embedded in the binary (Codex's were). Check: event names and fields, where the
   transcript lives, how approvals behave **while a hook runs** (Claude shows its dialog, Codex waits),
   any trust/consent step for new hooks.
2. `ProviderKind` gets a variant (`crates/domain/src/ids.rs`); stored events stay compatible. A new
   event kind only if no existing one fits (skill `extend-session-model`).
3. **Hooks.** Own events (Cursor, Antigravity): an `AgentProvider` with its own `translate`, a
   payload fingerprint in the bridge's `fingerprint`, and the right `HookLayout`; facts its
   transcript lacks (model, tokens) go in `Translated.facts`. If it speaks the Claude-style protocol: a `Dialect` + an `AgentProvider` that calls
   `hooks::translate` (see `codex/provider.rs`, ~30 lines), a `HookSpec` for the installer, and its
   process name in the bridge's `AGENTS` (+ `DIALOG_WHILE_WAITING` if it shows its own dialog while
   the hook waits). Otherwise a new ingress adapter producing `IncomingSignal`s.
4. **Transcripts.** A `TranscriptReader` on top of `jsonl::Follow`/`head_lines`/`tail_lines` and
   `tools::tool_label`, so labels read like the others ("Bash · cargo test"). Unknown prices → count
   the usage as unpriced; never invent a price.
5. **Skills.** `FsSkillCatalog::new(repo folders, personal folders)`.
6. **Wiring.** An `AgentPorts` in `src-tauri/src/lib.rs` and in `tests/e2e/mod.rs`; an installer
   entry in the `Integrations` list; `launch.rs::agent_command` for start/resume.
7. **Front.** Its name in every `locales/*.json` (`ui.provider.<id>`); anything it lacks degrades on
   its own (no approve buttons without `can_approve`, tokens without price). Add a demo session.
8. **Prove it.** Unit tests on the captured fixtures, an ignored `<agent>_e2e.rs` on the shared
   harness, screenshots. Document it: `<agent>.mdc` with `globs`, listed in `AGENTS.md`; README.
