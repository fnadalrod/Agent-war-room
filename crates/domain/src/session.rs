use crate::{
    Attention, EndReason, ProviderKind, SessionContext, SessionEventKind, SessionId, SkillInvoker,
    SkillSource, TerminalHost, Timestamp, WaitReason, Workspace,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionStatus {
    /// Esperando tu primer prompt o ya revisada.
    Idle,
    Working { tool: Option<String> },
    AwaitingYou { reason: WaitReason, tool: Option<String>, detail: Option<String> },
    /// Turno terminado: te toca.
    AwaitingInput,
    Compacting,
    Ended { reason: EndReason },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Subagent {
    pub id: String,
    pub kind: Option<String>,
    pub started_at: Timestamp,
    #[serde(default)]
    pub current_tool: Option<String>,
    /// Terminado: se conserva un rato para poder ver qué hizo.
    #[serde(default)]
    pub finished_at: Option<Timestamp>,
}

impl Subagent {
    pub fn is_running(&self) -> bool {
        self.finished_at.is_none()
    }
}

/// Una skill usada en la sesión.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillUse {
    pub name: String,
    pub source: SkillSource,
    pub by_user: bool,
    pub by_agent: bool,
    pub count: u32,
    pub last_at: Timestamp,
}

/// Subagentes terminados que se conservan por sesión (los más recientes).
const KEPT_FINISHED_SUBAGENTS: usize = 6;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: SessionId,
    pub provider: ProviderKind,
    pub workspace: Workspace,
    pub host: TerminalHost,
    pub transcript_path: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    pub status: SessionStatus,
    pub subagents: BTreeMap<String, Subagent>,
    #[serde(default)]
    pub skills: BTreeMap<String, SkillUse>,
    pub started_at: Timestamp,
    pub last_activity_at: Timestamp,
    pub status_since: Timestamp,
    pub turns: u32,
    /// Hay un fin de turno que aún no has mirado.
    pub unseen: bool,
    pub archived: bool,
    pub muted: bool,
}

impl Session {
    pub fn open(id: SessionId, context: SessionContext, at: Timestamp) -> Self {
        Self {
            id,
            provider: context.provider,
            workspace: context.workspace,
            host: context.host,
            transcript_path: context.transcript_path,
            cwd: context.cwd,
            status: SessionStatus::Idle,
            subagents: BTreeMap::new(),
            skills: BTreeMap::new(),
            started_at: at,
            last_activity_at: at,
            status_since: at,
            turns: 0,
            unseen: false,
            archived: false,
            muted: false,
        }
    }

    pub fn attention(&self) -> Attention {
        match &self.status {
            SessionStatus::AwaitingYou { .. } => Attention::NeedsYou,
            SessionStatus::AwaitingInput if self.unseen => Attention::Finished,
            SessionStatus::Working { .. } | SessionStatus::Compacting => Attention::Working,
            SessionStatus::Idle | SessionStatus::AwaitingInput => Attention::Idle,
            SessionStatus::Ended { .. } => Attention::Offline,
        }
    }

    /// Si la sesión cuenta para el color de la bandeja y para los avisos.
    pub fn is_on_watch(&self) -> bool {
        !self.archived && !self.muted
    }

    /// Dónde relanzar el agente para reanudar esta sesión.
    pub fn launch_dir(&self) -> &str {
        self.cwd.as_deref().unwrap_or(&self.workspace.worktree_path)
    }

    pub fn is_alive(&self) -> bool {
        !matches!(self.status, SessionStatus::Ended { .. })
    }

    pub fn apply(&mut self, context: Option<SessionContext>, kind: &SessionEventKind, at: Timestamp) {
        if let Some(context) = context {
            self.absorb(context);
        }
        if !kind.is_user_intent() {
            self.last_activity_at = self.last_activity_at.max(at);
        }

        match kind {
            SessionEventKind::Started => {
                // Tras una compactación automática el turno sigue en marcha.
                let next = if self.status == SessionStatus::Compacting {
                    SessionStatus::Working { tool: None }
                } else {
                    SessionStatus::Idle
                };
                self.set_status(next, at);
            }
            SessionEventKind::PromptSubmitted => {
                self.turns += 1;
                self.unseen = false;
                // Volver a escribirle a una sesión despedida la trae de vuelta.
                self.archived = false;
                self.set_status(SessionStatus::Working { tool: None }, at);
            }
            SessionEventKind::ToolStarted { tool } => {
                self.set_status(SessionStatus::Working { tool: Some(tool.clone()) }, at);
            }
            SessionEventKind::ToolFinished { .. } => {
                self.set_status(SessionStatus::Working { tool: None }, at);
            }
            SessionEventKind::AwaitingYou { reason, tool, detail } => {
                // Un segundo aviso de la misma espera (sin herramienta) no borra lo que ya sabíamos.
                let (tool, detail) = match &self.status {
                    SessionStatus::AwaitingYou { reason: current, tool: known_tool, detail: known_detail }
                        if current == reason =>
                    {
                        (tool.clone().or_else(|| known_tool.clone()), detail.clone().or_else(|| known_detail.clone()))
                    }
                    _ => (tool.clone(), detail.clone()),
                };
                self.set_status(SessionStatus::AwaitingYou { reason: *reason, tool, detail }, at);
            }
            SessionEventKind::IdlePrompt => {
                // Solo corrige si se perdió el fin de turno; no reabre algo ya visto.
                if matches!(self.status, SessionStatus::Working { .. }) {
                    self.unseen = true;
                    self.set_status(SessionStatus::AwaitingInput, at);
                }
            }
            SessionEventKind::TurnEnded => {
                self.unseen = true;
                self.set_status(SessionStatus::AwaitingInput, at);
            }
            SessionEventKind::SubagentStarted { id, kind } => {
                self.subagents.insert(
                    id.clone(),
                    Subagent { id: id.clone(), kind: kind.clone(), started_at: at, current_tool: None, finished_at: None },
                );
            }
            SessionEventKind::SubagentStopped { id } => {
                if let Some(subagent) = self.subagents.get_mut(id) {
                    subagent.finished_at = Some(at);
                    subagent.current_tool = None;
                }
                self.forget_old_subagents();
            }
            SessionEventKind::SubagentTool { id, tool } => {
                let subagent = self.subagents.entry(id.clone()).or_insert_with(|| Subagent {
                    id: id.clone(),
                    kind: None,
                    started_at: at,
                    current_tool: None,
                    finished_at: None,
                });
                subagent.current_tool = Some(tool.clone());
                // Si un subagente sigue trabajando, el permiso que se esperaba ya se resolvió.
                if matches!(self.status, SessionStatus::AwaitingYou { .. }) {
                    self.set_status(SessionStatus::Working { tool: None }, at);
                }
            }
            SessionEventKind::CompactionStarted => {
                self.set_status(SessionStatus::Compacting, at);
            }
            SessionEventKind::Ended { reason } => {
                if self.is_alive() {
                    for subagent in self.subagents.values_mut().filter(|s| s.is_running()) {
                        subagent.finished_at = Some(at);
                        subagent.current_tool = None;
                    }
                    self.forget_old_subagents();
                    self.set_status(SessionStatus::Ended { reason: reason.clone() }, at);
                }
            }
            SessionEventKind::SkillInvoked { name, by, source } => {
                let skill = self.skills.entry(name.clone()).or_insert_with(|| SkillUse {
                    name: name.clone(),
                    source: *source,
                    by_user: false,
                    by_agent: false,
                    count: 0,
                    last_at: at,
                });
                skill.count += 1;
                skill.last_at = at;
                match by {
                    SkillInvoker::User => skill.by_user = true,
                    SkillInvoker::Agent => skill.by_agent = true,
                }
            }
            SessionEventKind::Seen => self.unseen = false,
            SessionEventKind::Archived => self.archived = true,
            SessionEventKind::Unarchived => self.archived = false,
            SessionEventKind::Muted => self.muted = true,
            SessionEventKind::Unmuted => self.muted = false,
        }
    }

    pub fn running_subagents(&self) -> usize {
        self.subagents.values().filter(|s| s.is_running()).count()
    }

    fn forget_old_subagents(&mut self) {
        let mut finished: Vec<(Timestamp, String)> = self
            .subagents
            .values()
            .filter_map(|s| s.finished_at.map(|at| (at, s.id.clone())))
            .collect();
        if finished.len() <= KEPT_FINISHED_SUBAGENTS {
            return;
        }
        finished.sort();
        for (_, id) in &finished[..finished.len() - KEPT_FINISHED_SUBAGENTS] {
            self.subagents.remove(id);
        }
    }

    fn absorb(&mut self, context: SessionContext) {
        self.workspace = context.workspace;
        if context.transcript_path.is_some() {
            self.transcript_path = context.transcript_path;
        }
        if context.cwd.is_some() {
            self.cwd = context.cwd;
        }
        // Los hooks de una misma sesión pueden llegar sin cadena de procesos (p. ej. al cerrar).
        if context.host.agent_pid.is_some() {
            self.host = context.host;
        }
    }

    fn set_status(&mut self, status: SessionStatus, at: Timestamp) {
        if self.status != status {
            self.status = status;
            self.status_since = at;
        }
    }
}
