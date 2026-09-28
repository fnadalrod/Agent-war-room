//! Adaptador de Claude Code: traducción de hooks e instalación del puente.

mod installer;
mod provider;
mod skills;
mod tools;
mod transcript;

pub use installer::ClaudeHookInstaller;
pub use provider::ClaudeProvider;
pub use skills::FsSkillCatalog;
pub use transcript::ClaudeTranscriptReader;
