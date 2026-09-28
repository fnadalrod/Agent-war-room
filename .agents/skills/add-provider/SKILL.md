---
name: add-provider
description: Add support for another coding agent (Codex, Gemini CLI, opencode…) next to Claude Code — its hook/event source, translation to domain events, transcript reader, installer and launcher. Use when asked to monitor an agent that isn't Claude.
---

# Add an agent provider

The domain and application are provider-agnostic; Claude lives in `crates/infrastructure/src/claude/`.
Read `architecture.mdc` and `hooks-ingest.mdc` first.

1. **Research the agent's real integration points** (don't assume): does it have hooks or an event
   stream? What does each carry (session id, cwd, tool, permission prompts, turn end)? Where are its
   transcripts and in what format? Capture real samples.
2. `ProviderKind` gets a variant (`crates/domain/src/ids.rs`); stored events stay compatible.
3. New module `crates/infrastructure/src/<agent>/` with a `provider.rs` implementing `AgentProvider`
   (`wire_name` must match what its bridge sends as `provider`). Map to the **existing** event kinds;
   add a new kind only if no existing one fits (then skill `extend-session-model`).
4. Getting events in: if it can run a command per event, reuse `warroom-hook` with
   `WARROOM_PROVIDER=<name>` (the bridge already reads it) and teach the bridge any agent-specific
   parts (agent process name for the PID walk, reply format if it supports approvals). Otherwise a new
   ingress adapter that produces `IncomingSignal`s.
5. Transcripts: implement `TranscriptReader` for its format, or return `None` (the UI degrades).
6. Installer: an `IntegrationInstaller` for its config; the UI currently shows one integration — extend
   `IntegrationStatus`/`IntegrationBar` if both must be managed.
7. Launcher: teach `DesktopLauncher` its command and resume syntax.
8. Wire it in `src-tauri/src/lib.rs` (`providers: vec![…]`), add tests with real-shaped payloads, a demo
   session, and document it (new rule `<agent>.mdc` with `globs`, added to `AGENTS.md`).
