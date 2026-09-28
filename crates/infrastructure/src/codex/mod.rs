//! Codex adapter. Hooks share Claude Code's protocol (`crate::hooks`); what is Codex's own is its
//! dialect, its rollout transcripts and where its configuration lives.

use crate::hook_installer::{HOOK_TIMEOUT_SECS as T, HookSpec, PERMISSION_TIMEOUT_SECS};

mod provider;
mod transcript;

pub use provider::{CODEX, CodexProvider};
pub use transcript::CodexTranscriptReader;

/// `$CODEX_HOME`, or `~/.codex`.
pub fn codex_home(home: &std::path::Path) -> std::path::PathBuf {
    std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()).map(Into::into).unwrap_or_else(|| home.join(".codex"))
}

/// Codex hooks that feed the state machine (`~/.codex/hooks.json`). Codex caps `SessionEnd` and
/// `Interrupt` at 3 s and warns on every start if asked for more. After installing, Codex asks you
/// once to review and trust the new hooks; until then it does not run them.
pub const CODEX_HOOKS: HookSpec = HookSpec {
    provider: awr_domain::ProviderKind::Codex,
    layout: crate::hook_installer::HookLayout::Grouped,
    launchable: true,
    events: &[
        ("SessionStart", T),
        ("SessionEnd", 3),
        ("UserPromptSubmit", T),
        ("PreToolUse", T),
        ("PostToolUse", T),
        ("PermissionRequest", PERMISSION_TIMEOUT_SECS),
        ("Stop", T),
        ("Interrupt", 3),
        ("SubagentStart", T),
        ("SubagentStop", T),
        ("PreCompact", T),
    ],
};
