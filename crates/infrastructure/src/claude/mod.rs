//! Adaptador de Claude Code: traducción de hooks e instalación del puente.

mod installer;
mod provider;

pub use installer::ClaudeHookInstaller;
pub use provider::ClaudeProvider;
