//! Adaptador de Claude Code: traducción de hooks e instalación del puente.

mod installer;
mod provider;
mod transcript;

pub use installer::ClaudeHookInstaller;
pub use provider::ClaudeProvider;
pub use transcript::ClaudeTranscriptReader;
