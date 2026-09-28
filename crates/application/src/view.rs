//! Read model que consume el front. Se exporta a TS con `ts-rs` (`cargo test -p awr-application`).

use crate::ports::TranscriptSummary;
use awr_domain::{Attention, Session, SessionId, SessionStatus, WaitReason, WarRoom};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
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
    /// Título que genera el agente; `null` hasta que lo escribe.
    pub title: Option<String>,
    /// El encargo con el que empezó la sesión.
    pub first_prompt: Option<String>,
    /// Cómo se lanzó el agente (`claude --resume …`).
    pub command: Option<String>,
    pub last_prompt: Option<String>,
    pub last_reply: Option<String>,
    pub last_action: Option<String>,
    pub model: Option<String>,
    #[ts(type = "number | null")]
    pub context_tokens: Option<u64>,
    pub worktree_path: String,
    pub branch: Option<String>,
    pub is_linked_worktree: bool,
    pub subagents: Vec<SubagentView>,
    /// Skills usadas, la más reciente primero.
    pub skills: Vec<SkillView>,
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
    /// Hay enlace directo al pane de Warp.
    pub in_warp: bool,
    /// Terminal propio de la app: se puede ver y escribir desde aquí.
    pub pty_id: Option<String>,
    /// Hay un permiso pendiente que se puede aprobar o denegar desde la app.
    pub can_approve: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct SubagentView {
    pub id: String,
    pub kind: Option<String>,
    pub description: Option<String>,
    pub last_tool: Option<String>,
    pub running: bool,
    #[ts(type = "number")]
    pub started_at: i64,
    #[ts(type = "number | null")]
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SkillSourceView {
    Project,
    Personal,
    Plugin,
    Builtin,
}

impl From<awr_domain::SkillSource> for SkillSourceView {
    fn from(s: awr_domain::SkillSource) -> Self {
        use awr_domain::SkillSource;
        match s {
            SkillSource::Project => Self::Project,
            SkillSource::Personal => Self::Personal,
            SkillSource::Plugin => Self::Plugin,
            SkillSource::Builtin => Self::Builtin,
        }
    }
}

/// Una skill usada en la sesión: quién la lanzó y de dónde sale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct SkillView {
    pub name: String,
    pub source: SkillSourceView,
    pub by_user: bool,
    pub by_agent: bool,
    pub count: u32,
    #[ts(type = "number")]
    pub last_at: i64,
}

/// Vista previa de un subagente: qué le encargaron, qué contestó y qué fue haciendo.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct SubagentPreview {
    pub session_id: String,
    pub agent: SubagentView,
    pub first_prompt: Option<String>,
    pub last_reply: Option<String>,
    pub timeline: Vec<TimelineEntryView>,
}

/// Vista previa de una sesión: su tarjeta y la conversación reciente.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct SessionDetail {
    pub session: SessionView,
    pub timeline: Vec<TimelineEntryView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct TimelineEntryView {
    /// "prompt" (tú), "reply" (el agente, Markdown) o "tool" (resumen de una herramienta).
    pub kind: TimelineKindView,
    pub text: String,
    #[ts(type = "number | null")]
    pub at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TimelineKindView {
    Prompt,
    Reply,
    Tool,
}

impl From<crate::ports::TimelineItem> for TimelineEntryView {
    fn from(item: crate::ports::TimelineItem) -> Self {
        use crate::ports::TimelineKind;
        Self {
            kind: match item.kind {
                TimelineKind::Prompt => TimelineKindView::Prompt,
                TimelineKind::Reply => TimelineKindView::Reply,
                TimelineKind::Tool => TimelineKindView::Tool,
            },
            text: item.text,
            at: item.at,
        }
    }
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

pub fn project(
    room: &WarRoom,
    summaries: &HashMap<SessionId, TranscriptSummary>,
    approvable: &HashSet<SessionId>,
) -> WarRoomView {
    let mut by_repo: BTreeMap<String, RoomView> = BTreeMap::new();
    for session in room.sessions() {
        let entry = by_repo.entry(session.workspace.repo.0.clone()).or_insert_with(|| RoomView {
            repo_id: session.workspace.repo.0.clone(),
            repo_name: session.workspace.repo_name.clone(),
            attention: AttentionView::Offline,
            sessions: Vec::new(),
        });
        entry.sessions.push(session_view(session, summaries.get(&session.id), approvable.contains(&session.id)));
    }

    let mut rooms: Vec<RoomView> = by_repo
        .into_values()
        .map(|mut r| {
            r.sessions.sort_by_key(|s| (std::cmp::Reverse(s.attention), std::cmp::Reverse(s.last_activity_at)));
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

pub(crate) fn session_view(s: &Session, summary: Option<&TranscriptSummary>, can_approve: bool) -> SessionView {
    let summary = summary.cloned().unwrap_or_default();
    let detail = |id: &str| summary.subagents.iter().find(|d| d.id == id).cloned().unwrap_or_default();
    let mut view = SessionView {
        id: s.id.0.clone(),
        provider: format!("{:?}", s.provider).to_lowercase(),
        attention: s.attention().into(),
        status_label: status_label(s),
        title: summary.title.clone(),
        first_prompt: summary.first_prompt.clone(),
        command: s.host.agent_command.clone(),
        last_prompt: summary.last_prompt.clone(),
        last_reply: summary.last_reply.clone(),
        last_action: summary.last_action.clone(),
        model: summary.model.clone(),
        context_tokens: summary.context_tokens,
        worktree_path: s.workspace.worktree_path.clone(),
        branch: s.workspace.branch.clone(),
        is_linked_worktree: s.workspace.is_linked_worktree,
        subagents: s
            .subagents
            .values()
            .map(|a| {
                let d = detail(&a.id);
                SubagentView {
                    id: a.id.clone(),
                    kind: a.kind.clone(),
                    description: d.description,
                    // El transcript da más detalle ("Grep · patrón"); el hook, al menos el nombre.
                    last_tool: d.last_tool.or_else(|| a.current_tool.clone()),
                    running: a.is_running(),
                    started_at: a.started_at.0,
                    finished_at: a.finished_at.map(|t| t.0),
                }
            })
            .collect(),
        skills: {
            let mut skills: Vec<SkillView> = s
                .skills
                .values()
                .map(|k| SkillView {
                    name: k.name.clone(),
                    source: k.source.into(),
                    by_user: k.by_user,
                    by_agent: k.by_agent,
                    count: k.count,
                    last_at: k.last_at.0,
                })
                .collect();
            skills.sort_by_key(|k| std::cmp::Reverse(k.last_at));
            skills
        },
        turns: s.turns,
        started_at: s.started_at.0,
        last_activity_at: s.last_activity_at.0,
        status_since: s.status_since.0,
        archived: s.archived,
        muted: s.muted,
        alive: s.is_alive(),
        terminal: terminal_name(s),
        tmux_pane: s.host.tmux_pane.clone(),
        in_warp: s.host.warp_focus_url.is_some(),
        pty_id: s.host.pty_id.clone(),
        can_approve,
    };
    // Primero los que siguen trabajando; dentro de cada grupo, por orden de llegada.
    view.subagents.sort_by_key(|a| (!a.running, a.started_at));
    view
}

fn status_label(s: &Session) -> String {
    match &s.status {
        SessionStatus::Idle => "En espera".into(),
        SessionStatus::Working { tool: Some(tool) } => tool.clone(),
        SessionStatus::Working { tool: None } => "Pensando".into(),
        SessionStatus::AwaitingYou { reason: WaitReason::Permission, tool, detail } => match (tool, detail) {
            (Some(tool), Some(detail)) => format!("Pide permiso: {tool} · {detail}"),
            (Some(tool), None) => format!("Pide permiso: {tool}"),
            _ => "Pide permiso".into(),
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
