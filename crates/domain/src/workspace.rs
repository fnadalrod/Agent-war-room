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

/// Dónde vive la sesión en el escritorio. Es lo que permite "ir a" ella.
/// `serde(default)`: los eventos ya guardados siguen siendo legibles al añadir campos.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TerminalHost {
    /// PID del proceso del agente, para saber si sigue vivo.
    pub agent_pid: Option<u32>,
    /// Cadena de procesos desde el padre del hook hacia arriba (shell, agente, terminal…).
    pub ancestry: Vec<ProcessInfo>,
    pub tmux_pane: Option<String>,
    /// Socket del servidor tmux (primer campo de `$TMUX`).
    pub tmux_socket: Option<String>,
    pub term_program: Option<String>,
    /// `warp://session/<uuid>`: enlace que enfoca el pane exacto de Warp.
    pub warp_focus_url: Option<String>,
    /// Terminal lanzado por la propia app en el que corre la sesión (se puede ver y escribir).
    pub pty_id: Option<String>,
}

impl TerminalHost {
    /// PIDs por encima del agente, del más cercano al más lejano: candidatos a ser su ventana.
    pub fn pids_above_agent(&self) -> Vec<u32> {
        let above = match self.agent_pid {
            Some(agent) => self.ancestry.iter().skip_while(|p| p.pid != agent).skip(1).collect::<Vec<_>>(),
            None => self.ancestry.iter().collect(),
        };
        above.into_iter().map(|p| p.pid).collect()
    }
}
