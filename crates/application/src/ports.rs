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

/// Integra el puente de hooks en la configuración del agente.
pub trait IntegrationInstaller: Send + Sync {
    fn status(&self) -> PortResult<IntegrationStatus>;
    fn install(&self) -> PortResult<IntegrationStatus>;
    fn uninstall(&self) -> PortResult<IntegrationStatus>;
}
