---
name: extend-session-model
description: Checklist to add something a session knows or shows (a new hook signal, event kind, field, transcript fact or label) end to end through domain, application, infrastructure, Tauri and the React front. Use when a feature needs new per-session data.
---

# Extend the session model end to end

Decide the source first:
- **Hook signal** (exact, live, persisted): provider → domain event → persisted.
- **Transcript fact** (derived, recomputed, works for already-open sessions): TranscriptReader → summary.

Hook signal path (in order; each step compiles on its own):
1. `crates/domain/src/event.rs`: new `SessionEventKind` variant (or field with `#[serde(default)]`).
   Never rename existing tags/fields.
2. `crates/domain/src/session.rs`: state + `apply`. Add a test in `room.rs`.
3. `crates/infrastructure/src/claude/provider.rs`: map the hook payload; one hook can also emit
   `extra` events. Test with a real-shaped payload.
4. If it needs the filesystem/OS to classify, add a port in `application/src/ports.rs`, implement it
   in infrastructure, wire it in `src-tauri/src/lib.rs` (and the e2e `Room::start`).

Transcript fact path:
1. `ports.rs::TranscriptSummary` (or `TimelineItem` / `SubagentDetail`) field.
2. `infrastructure/src/claude/transcript.rs`: `Facts` + `absorb*` (incremental; must stay cheap).
   Inspect a real transcript first: `~/.claude/projects/<dir>/<session>.jsonl`.

Then, for both:
5. `crates/application/src/view.rs`: expose it in `SessionView` (ts-rs regenerates TS on `cargo test -p awr-application`).
6. Front: `src/domain` helpers (+ tests), copy in the copy module, render in `ui/` (card, detail
   panel, queue, pixel), demo data in `src/infrastructure/demoGateway.ts`, fixtures in `src/test/fixtures.ts`.
7. Filters (optional): `Filter` + `applyFilter` + `filterOptions` + `FilterBar` + `localFilterStorage`.
8. Verify with the `verify` skill (check + screenshots).
