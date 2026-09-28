//! Antigravity adapter: lifecycle hooks in its global customization root (`~/.gemini/config/
//! hooks.json`, one named block of ours) and step transcripts in `~/.gemini/antigravity/brain/<id>/
//! .system_generated/logs/transcript.jsonl`. Built from the documentation embedded in Antigravity
//! and real transcripts; not verified against a live conversation (see `antigravity.mdc`).

use crate::hook_installer::{HOOK_TIMEOUT_SECS as T, HookLayout, HookSpec};

mod provider;
mod transcript;

pub use provider::AntigravityProvider;
pub use transcript::AntigravityTranscriptReader;

/// Antigravity events we listen to. Not `PreToolUse`: it must answer with a decision, and any answer
/// changes how Antigravity asks for permissions. Hooks run synchronously in its agent loop.
pub const ANTIGRAVITY_HOOKS: HookSpec = HookSpec {
    provider: awr_domain::ProviderKind::Antigravity,
    layout: HookLayout::Named("agent-war-room"),
    launchable: false,
    events: &[("PreInvocation", T), ("PostToolUse", T), ("PostInvocation", T), ("Stop", T)],
};
