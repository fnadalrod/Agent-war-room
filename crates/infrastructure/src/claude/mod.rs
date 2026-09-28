//! Claude Code adapter: its hook dialect, transcripts, skills and prices.

use crate::hook_installer::{HOOK_TIMEOUT_SECS as T, HookSpec, PERMISSION_TIMEOUT_SECS};

pub mod pricing;
mod provider;
mod transcript;

pub use provider::{CLAUDE, ClaudeProvider};
pub use transcript::ClaudeTranscriptReader;

/// Claude hooks that feed the state machine (`~/.claude/settings.json`).
pub const CLAUDE_HOOKS: HookSpec = HookSpec {
    provider: awr_domain::ProviderKind::Claude,
    events: &[
        ("SessionStart", T),
        ("SessionEnd", T),
        ("UserPromptSubmit", T),
        ("PreToolUse", T),
        ("PostToolUse", T),
        ("PostToolUseFailure", T),
        ("PermissionRequest", PERMISSION_TIMEOUT_SECS),
        ("Notification", T),
        ("Stop", T),
        ("SubagentStart", T),
        ("SubagentStop", T),
        ("PreCompact", T),
    ],
};
