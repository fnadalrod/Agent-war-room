use crate::{ProviderKind, SessionId, TerminalHost, Timestamp, Workspace};
use serde::{Deserialize, Serialize};

/// Single entry point for state changes. Persisted as is (append-only).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionEvent {
    pub session: SessionId,
    pub at: Timestamp,
    /// Present on agent signals; absent on user intents.
    pub context: Option<SessionContext>,
    pub kind: SessionEventKind,
}

/// What we know about the session's environment at the time of the signal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionContext {
    pub provider: ProviderKind,
    pub workspace: Workspace,
    pub host: TerminalHost,
    pub transcript_path: Option<String>,
    /// Exact directory the agent runs in (may be a subdirectory of the worktree). Needed to
    /// resume: Claude stores sessions per directory.
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitReason {
    Permission,
    Question,
}

/// Who launched a skill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillInvoker {
    /// You, with `/skill` in the prompt.
    User,
    /// The agent (or a subagent), on its own.
    Agent,
}

/// Where a skill comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    /// Defined in the repository (`.claude/skills`, `.claude/commands`).
    Project,
    /// Yours, for every project (`~/.claude/skills`, `~/.claude/commands`).
    Personal,
    /// From a plugin (`plugin:skill`).
    Plugin,
    /// Built into the agent.
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
    // Agent signals.
    Started,
    PromptSubmitted,
    ToolStarted {
        tool: String,
    },
    ToolFinished {
        tool: String,
        failed: bool,
    },
    AwaitingYou {
        reason: WaitReason,
        tool: Option<String>,
        /// What exactly it asks for: the command, the file…
        #[serde(default)]
        detail: Option<String>,
    },
    /// The agent has been waiting for input for a while (not necessarily after an observed turn end).
    IdlePrompt,
    TurnEnded,
    SubagentStarted {
        id: String,
        kind: Option<String>,
    },
    SubagentStopped {
        id: String,
    },
    /// A subagent uses a tool. Does not change the main session's tool.
    SubagentTool {
        id: String,
        tool: String,
    },
    CompactionStarted,
    Ended {
        reason: EndReason,
    },
    SkillInvoked {
        name: String,
        by: SkillInvoker,
        source: SkillSource,
    },

    // User intents.
    Seen,
    Archived,
    Unarchived,
    Muted,
    Unmuted,
}

impl SessionEventKind {
    pub fn is_user_intent(&self) -> bool {
        matches!(self, Self::Seen | Self::Archived | Self::Unarchived | Self::Muted | Self::Unmuted)
    }
}
