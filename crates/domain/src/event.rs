use crate::{ProviderKind, SessionId, TerminalHost, Timestamp, Workspace};
use serde::{Deserialize, Serialize};

/// Único punto de entrada de cambios de estado. Se persiste tal cual (append-only).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionEvent {
    pub session: SessionId,
    pub at: Timestamp,
    /// Presente en las señales del agente; ausente en las intenciones del usuario.
    pub context: Option<SessionContext>,
    pub kind: SessionEventKind,
}

/// Lo que sabemos del entorno de la sesión en el momento de la señal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionContext {
    pub provider: ProviderKind,
    pub workspace: Workspace,
    pub host: TerminalHost,
    pub transcript_path: Option<String>,
    /// Carpeta exacta donde corre el agente (puede ser una subcarpeta del worktree). Hace falta
    /// para reanudar: Claude guarda las sesiones por carpeta.
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitReason {
    Permission,
    Question,
}

/// Quién lanzó una skill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillInvoker {
    /// Tú, con `/skill` en el prompt.
    User,
    /// El agente (o un subagente), por su cuenta.
    Agent,
}

/// De dónde sale una skill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    /// Definida en el repositorio (`.claude/skills`, `.claude/commands`).
    Project,
    /// Tuya, para todos los proyectos (`~/.claude/skills`, `~/.claude/commands`).
    Personal,
    /// De un plugin (`plugin:skill`).
    Plugin,
    /// Integrada en el agente.
    Builtin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    Exited(String),
    ProcessLost,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEventKind {
    // Señales del agente.
    Started,
    PromptSubmitted,
    ToolStarted { tool: String },
    ToolFinished { tool: String, failed: bool },
    AwaitingYou {
        reason: WaitReason,
        tool: Option<String>,
        /// Qué pide exactamente: el comando, el fichero…
        #[serde(default)]
        detail: Option<String>,
    },
    /// El agente lleva un rato esperando input (no necesariamente tras un fin de turno visto).
    IdlePrompt,
    TurnEnded,
    SubagentStarted { id: String, kind: Option<String> },
    SubagentStopped { id: String },
    /// Un subagente usa una herramienta. No cambia la herramienta de la sesión principal.
    SubagentTool { id: String, tool: String },
    CompactionStarted,
    Ended { reason: EndReason },
    SkillInvoked { name: String, by: SkillInvoker, source: SkillSource },

    // Intenciones del usuario.
    Seen,
    Archived,
    Unarchived,
    Muted,
    Unmuted,
}

impl SessionEventKind {
    pub fn is_user_intent(&self) -> bool {
        matches!(
            self,
            Self::Seen | Self::Archived | Self::Unarchived | Self::Muted | Self::Unmuted
        )
    }
}
