---
name: extend-session-model
description: Checklist to add something a session knows or shows (a new hook signal, event kind, field, transcript fact or label) end to end through domain, application, infrastructure, Tauri and the React front. Use when a feature needs new per-session data.
---

# Extend the session model end to end

Decide the source first:
- **Hook signal** (exact, live, persisted as an event): provider → domain event. Rules: `hooks-ingest.mdc`, `domain-model.mdc`.
- **Transcript fact** (derived, recomputed, works for already-open sessions): TranscriptReader → summary. Rules: `transcripts.mdc`.
- **Time-derived** (like "stuck"): computed in `view.rs` from state + clock; never stored.

Look at real data before coding: a real hook payload (`WARROOM_HOOK_DUMP=/tmp/x.jsonl`) or a real
transcript (subagent `awr-transcript-scout`).

Hook signal path (each step compiles on its own):
1. `crates/domain/src/event.rs`: new variant (or field with `#[serde(default)]`). Never rename tags.
2. `crates/domain/src/session.rs`: state + `apply`; test in `room.rs` (and the old-event load test if you added a field).
3. `crates/infrastructure/src/claude/provider.rs`: map the payload (main `kind` or `extra`); test with a real-shaped payload.
4. Needs the OS/filesystem to classify? Port in `ports.rs`, adapter in infrastructure, wiring in
   `src-tauri/src/lib.rs` **and** `crates/infrastructure/tests/claude_e2e.rs`, fake in `service.rs` tests.

Transcript fact path:
1. `ports.rs::TranscriptSummary` (or `TimelineItem` / `SubagentDetail`).
2. `transcript.rs`: `Facts` + `absorb*` (incremental; must stay cheap) + a test with real-shaped lines.

Then, for all:
5. `crates/application/src/view.rs`: expose it; `cargo test -p awr-application` regenerates TS.
6. Front: helper in `src/domain/attention.ts` (+ test), text in `src/domain/copy.ts`, render in `src/ui`
   (card, detail, queue, pixel), fixtures (`src/test/fixtures.ts`) and demo data (`demoGateway.ts`).
7. Optional filter: `Filter` + `applyFilter` + `filterOptions` + `FilterBar` + `localFilterStorage`.
8. Skill `verify` (check + screenshots). Update the area rule if the mechanism is non-obvious.
