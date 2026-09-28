use crate::RepoId;
use serde::{Deserialize, Serialize};

/// Where a session works: the repo (room) and the specific worktree (desk).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub repo: RepoId,
    pub repo_name: String,
    pub worktree_path: String,
    pub branch: Option<String>,
    /// `true` if the directory is a linked worktree, not the main checkout.
    pub is_linked_worktree: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

/// Where the session lives on the desktop. This is what makes it possible to "go to" it.
/// `serde(default)`: already stored events stay readable when fields are added.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TerminalHost {
    /// PID of the agent process, to know whether it is still alive.
    pub agent_pid: Option<u32>,
    /// How the agent was launched (`claude --resume …`).
    pub agent_command: Option<String>,
    /// Process chain from the hook's parent upwards (shell, agent, terminal…).
    pub ancestry: Vec<ProcessInfo>,
    pub tmux_pane: Option<String>,
    /// tmux server socket (first field of `$TMUX`).
    pub tmux_socket: Option<String>,
    pub term_program: Option<String>,
    /// `warp://session/<uuid>`: link that focuses the exact Warp pane.
    pub warp_focus_url: Option<String>,
    /// Terminal launched by the app itself in which the session runs (can be viewed and typed into).
    pub pty_id: Option<String>,
}

impl TerminalHost {
    /// PIDs above the agent, nearest first: candidates for its window.
    pub fn pids_above_agent(&self) -> Vec<u32> {
        let above = match self.agent_pid {
            Some(agent) => self.ancestry.iter().skip_while(|p| p.pid != agent).skip(1).collect::<Vec<_>>(),
            None => self.ancestry.iter().collect(),
        };
        above.into_iter().map(|p| p.pid).collect()
    }
}
