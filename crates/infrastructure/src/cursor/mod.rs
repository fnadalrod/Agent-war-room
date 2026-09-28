//! Cursor adapter (IDE and `cursor-agent`): its own hook events in `~/.cursor/hooks.json`, and agent
//! transcripts laid out like Claude's. Built from Cursor's hook contract and real transcripts; not
//! verified against a live Cursor session (see `cursor.mdc`).

use crate::hook_installer::{HOOK_TIMEOUT_SECS as T, HookLayout, HookSpec};

mod provider;
mod transcript;

pub use provider::CursorProvider;
pub use transcript::CursorTranscriptReader;

/// Cursor hooks that feed the state machine (`~/.cursor/hooks.json`, flat entries). The command is the
/// same string as in Claude's settings, so Cursor, which also runs Claude's hooks, drops the duplicate.
pub const CURSOR_HOOKS: HookSpec = HookSpec {
    provider: awr_domain::ProviderKind::Cursor,
    layout: HookLayout::Flat,
    launchable: true,
    events: &[
        ("sessionStart", T),
        ("sessionEnd", T),
        ("beforeSubmitPrompt", T),
        ("preToolUse", T),
        ("postToolUse", T),
        ("postToolUseFailure", T),
        ("afterAgentResponse", T),
        ("stop", T),
        ("subagentStart", T),
        ("subagentStop", T),
        ("preCompact", T),
    ],
};
