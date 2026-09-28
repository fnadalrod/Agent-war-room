# Rust core (crates/)

## Flow of a hook

`warroom-hook` (stdin JSON + /proc ancestry + env hints) → Unix socket `ingress.rs` →
`IncomingSignal` → `WarRoomService::ingest` → `AgentProvider::translate` (Claude: `provider.rs`) →
`SessionEvent` (+ `extra` events) → `WarRoom::apply` (domain) → `EventStore::append` (SQLite) →
transcript refresh → `ViewPublisher::publish` (Tauri event + tray) → `Notifier` if attention escalates.

User intents (seen, archive, mute…) are `SessionEvent`s without context, persisted the same way.
State = fold of events (`restore()` replays 3 days; events older than 14 days are pruned).

## Ports (crates/application/src/ports.rs)

AgentProvider, RepoResolver, EventStore, Clock, ProcessProbe, Notifier, ViewPublisher,
TranscriptReader, WindowNavigator, AgentLauncher, SessionInput, SkillCatalog, ApprovalResponder,
IntegrationInstaller. All bundled in `service::Ports`; tests use in-file fakes (`service.rs` bottom).

## Rules

- Domain stays pure: no filesystem, time or process calls. Time comes in the event (`Timestamp`).
- Derived, non-persisted data (transcript summaries, pending approvals) lives in the service, not in the domain.
- Lock order in the service: `room` → `summaries` → `approvals`. Never call ports while holding `room`
  except pure projections.
- User-facing text only via each crate's `locale.rs`.
- `view.rs` types are exported to TS by `cargo test -p awr-application` (ts-rs → `src/domain/generated`).
  Changing them means regenerating and fixing the front (`scripts/check.sh` does both).
- Tests: `cargo test -p <crate>`; manual/live ones are `#[ignore]` (`kwin_live`, `transcript_live`,
  `claude_e2e`) — run only when asked or when touching that integration.
