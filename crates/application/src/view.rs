//! Read model que consume el front. Se exporta a TS con `ts-rs` (`cargo test -p awr-application`).

use awr_domain::{Attention, Session, SessionStatus, WaitReason, WarRoom};
use serde::Serialize;
use std::collections::BTreeMap;
use ts_rs::TS;

/// Mismo orden de urgencia que `Attention`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AttentionView {
    Offline,
    Idle,
    Working,
    Finished,
    NeedsYou,
}

impl From<Attention> for AttentionView {
    fn from(a: Attention) -> Self {
        match a {
            Attention::Offline => Self::Offline,
            Attention::Idle => Self::Idle,
            Attention::Working => Self::Working,
            Attention::Finished => Self::Finished,
            Attention::NeedsYou => Self::NeedsYou,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct WarRoomView {
    pub aggregate: AttentionView,
    pub rooms: Vec<RoomView>,
}

/// Una sala por repositorio.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct RoomView {
    pub repo_id: String,
    pub repo_name: String,
    pub attention: AttentionView,
    pub sessions: Vec<SessionView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct SessionView {
    pub id: String,
    pub provider: String,
    pub attention: AttentionView,
    /// Frase corta para la pantalla: "Bash", "Pide permiso: Edit", "Te toca"…
    pub status_label: String,
    pub worktree_path: String,
    pub branch: Option<String>,
    pub is_linked_worktree: bool,
    pub subagents: Vec<SubagentView>,
    pub turns: u32,
    #[ts(type = "number")]
    pub started_at: i64,
    #[ts(type = "number")]
    pub last_activity_at: i64,
    #[ts(type = "number")]
    pub status_since: i64,
    pub archived: bool,
    pub muted: bool,
    pub alive: bool,
    pub terminal: Option<String>,
    pub tmux_pane: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct SubagentView {
    pub id: String,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct IntegrationStatus {
    pub installed: bool,
    /// Eventos de hook que apuntan a nuestro puente.
    pub hooked_events: Vec<String>,
    pub settings_path: String,
    pub bridge_path: String,
    pub bridge_present: bool,
}

pub fn project(room: &WarRoom) -> WarRoomView {
    let mut by_repo: BTreeMap<String, RoomView> = BTreeMap::new();
    for session in room.sessions() {
        let entry = by_repo.entry(session.workspace.repo.0.clone()).or_insert_with(|| RoomView {
            repo_id: session.workspace.repo.0.clone(),
            repo_name: session.workspace.repo_name.clone(),
            attention: AttentionView::Offline,
            sessions: Vec::new(),
        });
        entry.sessions.push(session_view(session));
    }

    let mut rooms: Vec<RoomView> = by_repo
        .into_values()
        .map(|mut r| {
            r.sessions.sort_by_key(|s| std::cmp::Reverse(s.last_activity_at));
            r.attention = r
                .sessions
                .iter()
                .filter(|s| !s.archived && !s.muted)
                .map(|s| s.attention)
                .max()
                .unwrap_or(AttentionView::Offline);
            r
        })
        .collect();
    rooms.sort_by(|a, b| {
        b.attention
            .cmp(&a.attention)
            .then_with(|| a.repo_name.cmp(&b.repo_name))
    });

    WarRoomView { aggregate: room.aggregate_attention().into(), rooms }
}

fn session_view(s: &Session) -> SessionView {
    SessionView {
        id: s.id.0.clone(),
        provider: format!("{:?}", s.provider).to_lowercase(),
        attention: s.attention().into(),
        status_label: status_label(s),
        worktree_path: s.workspace.worktree_path.clone(),
        branch: s.workspace.branch.clone(),
        is_linked_worktree: s.workspace.is_linked_worktree,
        subagents: s
            .subagents
            .values()
            .map(|a| SubagentView { id: a.id.clone(), kind: a.kind.clone() })
            .collect(),
        turns: s.turns,
        started_at: s.started_at.0,
        last_activity_at: s.last_activity_at.0,
        status_since: s.status_since.0,
        archived: s.archived,
        muted: s.muted,
        alive: s.is_alive(),
        terminal: terminal_name(s),
        tmux_pane: s.host.tmux_pane.clone(),
    }
}

fn status_label(s: &Session) -> String {
    match &s.status {
        SessionStatus::Idle => "En espera".into(),
        SessionStatus::Working { tool: Some(tool) } => tool.clone(),
        SessionStatus::Working { tool: None } => "Pensando".into(),
        SessionStatus::AwaitingYou { reason: WaitReason::Permission, tool } => match tool {
            Some(tool) => format!("Pide permiso: {tool}"),
            None => "Pide permiso".into(),
        },
        SessionStatus::AwaitingYou { reason: WaitReason::Question, .. } => "Te pregunta".into(),
        SessionStatus::AwaitingInput if s.unseen => "Terminado".into(),
        SessionStatus::AwaitingInput => "Te toca".into(),
        SessionStatus::Compacting => "Compactando".into(),
        SessionStatus::Ended { .. } => "Cerrada".into(),
    }
}

/// Primer ancestro del agente que parece una terminal o IDE (lo que habrá que enfocar).
fn terminal_name(s: &Session) -> Option<String> {
    if let Some(program) = &s.host.term_program {
        return Some(program.clone());
    }
    const SHELLS: &[&str] = &["bash", "zsh", "fish", "sh", "dash", "claude", "node", "tmux: server", "tmux"];
    let agent = s.host.agent_pid?;
    s.host
        .ancestry
        .iter()
        .skip_while(|p| p.pid != agent)
        .skip(1)
        .find(|p| !SHELLS.contains(&p.name.as_str()))
        .map(|p| p.name.clone())
}
