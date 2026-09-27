use crate::view::{IntegrationStatus, WarRoomView};
use awr_domain::{Attention, ProviderKind, SessionEvent, SessionEventKind, SessionId, Timestamp, Workspace};

#[derive(Debug, thiserror::Error)]
pub enum PortError {
    #[error("{0}")]
    Failed(String),
}

pub type PortResult<T> = Result<T, PortError>;

/// Lo que un proveedor entiende de un payload de hook.
#[derive(Debug, Clone, PartialEq)]
pub struct Translated {
    pub session: SessionId,
    pub cwd: String,
    pub transcript_path: Option<String>,
    pub kind: SessionEventKind,
}

/// Traduce los hooks de un agente concreto (Claude, …) a eventos de dominio.
pub trait AgentProvider: Send + Sync {
    fn kind(&self) -> ProviderKind;
    /// Nombre con el que llega en el envelope.
    fn wire_name(&self) -> &'static str;
    /// `Ok(None)`: hook conocido pero irrelevante para el estado.
    fn translate(&self, payload: &serde_json::Value) -> PortResult<Option<Translated>>;
}

pub trait RepoResolver: Send + Sync {
    fn resolve(&self, cwd: &str) -> Workspace;
}

pub trait EventStore: Send + Sync {
    fn append(&self, event: &SessionEvent) -> PortResult<()>;
    fn load_since(&self, since: Timestamp) -> PortResult<Vec<SessionEvent>>;
}

pub trait Clock: Send + Sync {
    fn now(&self) -> Timestamp;
}

pub trait ProcessProbe: Send + Sync {
    fn is_alive(&self, pid: u32) -> bool;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub session: SessionId,
    pub attention: Attention,
    pub title: String,
    pub body: String,
}

pub trait Notifier: Send + Sync {
    fn notify(&self, notice: &Notice);
}

/// Recibe el read model cada vez que cambia (UI, bandeja…).
pub trait ViewPublisher: Send + Sync {
    fn publish(&self, view: &WarRoomView);
}

/// Lo que el transcript cuenta de una sesión y que los hooks no traen.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TranscriptSummary {
    /// Título que el propio agente genera para la sesión.
    pub title: Option<String>,
    pub last_prompt: Option<String>,
    /// Último texto del agente (no herramientas).
    pub last_reply: Option<String>,
    /// Última herramienta usada con su argumento principal: "Bash · cargo test".
    pub last_action: Option<String>,
    pub model: Option<String>,
    /// Tokens de contexto del último turno (entrada + caché).
    pub context_tokens: Option<u64>,
    pub subagents: Vec<SubagentDetail>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SubagentDetail {
    pub id: String,
    pub description: Option<String>,
    pub last_tool: Option<String>,
}

pub trait TranscriptReader: Send + Sync {
    /// Lectura incremental: llamarla a menudo debe ser barato.
    fn read(&self, transcript_path: &str, subagent_ids: &[String]) -> Option<TranscriptSummary>;
}

/// A dónde saltar para ver una sesión.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusTarget {
    pub host: awr_domain::TerminalHost,
    /// Textos que probablemente aparecen en el título de la ventana correcta, por prioridad.
    pub caption_hints: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusOutcome {
    /// Se pidió enfocar; `via` dice cómo ("tmux + kwin", "kwin"…).
    Focused { via: String },
    /// No hay forma conocida de llegar (sin ventana localizable o escritorio no soportado).
    Unreachable { reason: String },
}

pub trait WindowNavigator: Send + Sync {
    fn focus(&self, target: &FocusTarget) -> PortResult<FocusOutcome>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalDecision {
    Allow,
    Deny { message: Option<String> },
}

/// Canal de vuelta hacia un agente que espera una decisión de permiso.
pub trait ApprovalResponder: Send + Sync {
    /// El agente sigue esperando: nadie ha contestado aún en la terminal.
    fn is_open(&self) -> bool;
    /// Entrega la decisión. `false` si ya no había nadie esperando.
    fn respond(&self, decision: ApprovalDecision) -> bool;
}

/// Dónde abrir un agente nuevo o reanudado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchTarget {
    /// Terminal propio de la app: se ve y se escribe desde la war room.
    App,
    /// Pestaña nueva de Warp.
    Warp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchRequest {
    pub cwd: String,
    /// Reanudar esta sesión (`claude --resume <id>`) en vez de empezar una nueva.
    pub resume: Option<SessionId>,
    pub target: LaunchTarget,
    /// Nombre para la pestaña o el terminal.
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchOutcome {
    /// Terminal de la app; la UI puede abrirlo ya, antes de que llegue el primer hook.
    AppTerminal { pty_id: String },
    External { via: String },
}

pub trait AgentLauncher: Send + Sync {
    fn launch(&self, request: &LaunchRequest) -> PortResult<LaunchOutcome>;
}

/// Escribe en una sesión viva como si se tecleara en su terminal.
pub trait SessionInput: Send + Sync {
    /// `Err` si la terminal de la sesión no admite escritura desde fuera (solo "ir a").
    fn send(&self, host: &awr_domain::TerminalHost, text: &str) -> PortResult<()>;
}

/// Integra el puente de hooks en la configuración del agente.
pub trait IntegrationInstaller: Send + Sync {
    fn status(&self) -> PortResult<IntegrationStatus>;
    fn install(&self) -> PortResult<IntegrationStatus>;
    fn uninstall(&self) -> PortResult<IntegrationStatus>;
}
