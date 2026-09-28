//! Núcleo puro de Agent War Room: sesiones de agentes, su estado y la atención que piden.
//! Sin IO ni dependencias de framework; todo cambio de estado entra como un [`SessionEvent`].

mod attention;
mod event;
mod ids;
mod room;
mod session;
mod workspace;

pub use attention::Attention;
pub use event::{
    EndReason, SessionContext, SessionEvent, SessionEventKind, SkillInvoker, SkillSource, WaitReason,
};
pub use ids::{ProviderKind, RepoId, SessionId, Timestamp};
pub use room::{AttentionChange, WarRoom};
pub use session::{Session, SessionStatus, SkillUse, Subagent};
pub use workspace::{ProcessInfo, TerminalHost, Workspace};
