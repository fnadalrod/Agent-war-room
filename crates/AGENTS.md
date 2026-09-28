# crates/ — Rust core

Map and dependency rule → `.cursor/rules/architecture.mdc`. Per crate: `domain/` → `domain-model.mdc`;
`hook-bridge/`, `wire/`, `infrastructure/src/{ingress.rs,claude/provider.rs,claude/installer.rs}` →
`hooks-ingest.mdc`; `infrastructure/src/claude/{transcript,pricing}.rs` → `transcripts.mdc`;
`infrastructure/src/{desktop,pty.rs,launch.rs,git.rs,system.rs}` → `desktop.mdc`; `i18n/` and every
`locale.rs` → `i18n.mdc`. Tests → `testing.mdc`.
