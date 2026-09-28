//! Claude Code adapter: hook translation and bridge installation.

mod installer;
mod provider;
mod skills;
mod tools;
mod transcript;

pub use installer::ClaudeHookInstaller;
pub use provider::ClaudeProvider;
pub use skills::FsSkillCatalog;
pub use transcript::ClaudeTranscriptReader;
