use crate::RepoId;
use serde::{Deserialize, Serialize};

/// Dónde trabaja una sesión: el repo (sala) y el worktree concreto (puesto).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub repo: RepoId,
    pub repo_name: String,
    pub worktree_path: String,
    pub branch: Option<String>,
    /// `true` si la carpeta es un worktree secundario, no el checkout principal.
    pub is_linked_worktree: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

/// Dónde vive la sesión en el escritorio. Es lo que permitirá "ir a" ella.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalHost {
    /// PID del proceso del agente, para saber si sigue vivo.
    pub agent_pid: Option<u32>,
    /// Cadena de procesos desde el agente hacia arriba (terminal, multiplexor…).
    pub ancestry: Vec<ProcessInfo>,
    pub tmux_pane: Option<String>,
    pub term_program: Option<String>,
}
