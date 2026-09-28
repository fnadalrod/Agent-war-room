//! Pure core of Agent War Room: agent sessions, their state and the attention they ask for.
//! No IO or framework dependencies; every state change comes in as a [`SessionEvent`].

mod attention;
mod event;
mod ids;
mod room;
mod session;
mod workspace;

pub use attention::Attention;
pub use event::{EndReason, SessionContext, SessionEvent, SessionEventKind, SkillInvoker, SkillSource, WaitReason};
pub use ids::{ProviderKind, RepoId, SessionId, Timestamp};
pub use room::{AttentionChange, WarRoom};
pub use session::{Session, SessionStatus, SkillUse, Subagent};
pub use workspace::{ProcessInfo, TerminalHost, Workspace};
