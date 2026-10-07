use crate::view::{IntegrationStatus, WarRoomView};
use awr_domain::{Attention, ProviderKind, SessionEvent, SessionEventKind, SessionId, Timestamp, Workspace};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionOption {
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionPrompt {
    pub question: String,
    pub header: Option<String>,
    pub options: Vec<QuestionOption>,
    pub multi_select: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum PortError {
    #[error("{0}")]
    Failed(String),
}

pub type PortResult<T> = Result<T, PortError>;

/// What a provider understands from a hook payload.
#[derive(Debug, Clone, PartialEq)]
pub struct Translated {
    pub session: SessionId,
    pub cwd: String,
    pub transcript_path: Option<String>,
    /// `None`: the hook changes no state, it only brings [`HookFacts`].
    pub kind: Option<SessionEventKind>,
    /// Events implied by the same hook besides the main one (e.g. a `/skill` in the prompt).
    /// `SkillInvoked` arrives with a provisional source; [`SkillCatalog`] settles it.
    pub extra: Vec<SessionEventKind>,
    pub facts: HookFacts,
    /// Structured prompts when this signal is an answerable question.
    pub question: Option<Vec<QuestionPrompt>>,
}

/// What a hook says about the session besides its state, for agents whose transcript lacks it
/// (Cursor's carries no model or tokens; Antigravity's no model). Merged over the transcript summary
/// by the service; derived, never persisted.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HookFacts {
    pub model: Option<String>,
    /// Tokens of one response, counted once.
    pub usage: Option<Usage>,
    pub context_tokens: Option<u64>,
    pub context_window: Option<u64>,
}

impl HookFacts {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Works out where a skill comes from (repo, personal, plugin or built-in).
pub trait SkillCatalog: Send + Sync {
    fn classify(&self, name: &str, cwd: &str, worktree: &str) -> awr_domain::SkillSource;
}

/// Translates the hooks of a specific agent (Claude, …) into domain events.
pub trait AgentProvider: Send + Sync {
    fn kind(&self) -> ProviderKind;
    /// Name it arrives with in the envelope.
    fn wire_name(&self) -> &'static str;
    /// `Ok(None)`: known hook, but irrelevant to the state.
    fn translate(&self, payload: &serde_json::Value) -> PortResult<Option<Translated>>;
}

pub trait RepoResolver: Send + Sync {
    fn resolve(&self, cwd: &str) -> Workspace;
}

pub trait EventStore: Send + Sync {
    fn append(&self, event: &SessionEvent) -> PortResult<()>;
    fn load_since(&self, since: Timestamp) -> PortResult<Vec<SessionEvent>>;
    /// Deletes events older than `before`. Returns how many.
    fn prune(&self, before: Timestamp) -> PortResult<usize>;
}

pub trait Clock: Send + Sync {
    fn now(&self) -> Timestamp;
    /// Calendar day of a moment, for "today" totals (the real clock uses the local time zone).
    fn day(&self, at: Timestamp) -> i64 {
        at.0.div_euclid(86_400_000)
    }
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
    /// Can be approved from the notice itself.
    pub approvable: bool,
}

pub trait Notifier: Send + Sync {
    fn notify(&self, notice: &Notice);
}

/// Receives the read model every time it changes (UI, tray…).
pub trait ViewPublisher: Send + Sync {
    fn publish(&self, view: &WarRoomView);
}

/// What the transcript tells about a session that the hooks don't carry.
/// Tokens spent and their estimated cost at API prices. Each API message is counted once.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    /// Estimated cost in millionths of a dollar.
    pub cost_micros: u64,
    /// Messages whose model has no known price (not included in the cost).
    pub unpriced_messages: u32,
}

impl Usage {
    pub fn tokens(&self) -> u64 {
        self.input_tokens + self.output_tokens + self.cache_read_tokens + self.cache_write_tokens
    }

    pub fn add(&mut self, other: &Usage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_read_tokens += other.cache_read_tokens;
        self.cache_write_tokens += other.cache_write_tokens;
        self.cost_micros += other.cost_micros;
        self.unpriced_messages += other.unpriced_messages;
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TranscriptSummary {
    /// The current turn delegates permission decisions to an automatic reviewer.
    pub automatic_permission_review: bool,
    /// Commands confirmed as running in the transcript. Derived, never persisted.
    pub running_commands: usize,
    /// Files edited so far (as the agent wrote the path), subagents included. Derived, never persisted.
    pub edited_files: BTreeSet<String>,
    /// Title the agent itself generates for the session.
    pub title: Option<String>,
    /// The task the session started with.
    pub first_prompt: Option<String>,
    pub last_prompt: Option<String>,
    /// Last agent text (not tool use).
    pub last_reply: Option<String>,
    /// Last tool used with its main argument: "Bash · cargo test".
    pub last_action: Option<String>,
    pub model: Option<String>,
    /// Reasoning effort of the last turn ("low", "medium", "high"…).
    pub effort: Option<String>,
    /// Context tokens of the last turn (input + cache).
    pub context_tokens: Option<u64>,
    pub subagents: Vec<SubagentDetail>,
    /// Whole session, subagents included.
    pub usage: Usage,
    /// Same, only messages from today (local time).
    pub usage_today: Usage,
    /// Context window of the current model, if known.
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SubagentDetail {
    pub id: String,
    pub description: Option<String>,
    pub last_tool: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimelineKind {
    /// What you typed.
    Prompt,
    /// Agent text (Markdown).
    Reply,
    /// Tool use, summarised: "Bash · cargo test".
    Tool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimelineItem {
    pub kind: TimelineKind,
    pub text: String,
    /// Milliseconds since epoch, if the transcript says so.
    pub at: Option<i64>,
    /// Model and effort that produced it (agent entries only).
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// What a subagent's transcript says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentTranscript {
    /// The task the main agent gave it.
    pub first_prompt: Option<String>,
    pub last_reply: Option<String>,
    pub timeline: Vec<TimelineItem>,
}

/// A file the agent (or one of its subagents) edited or created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TouchedFile {
    pub path: String,
    pub edits: u32,
    /// Written whole at least once (Write), usually a new file.
    pub written: bool,
}

pub trait TranscriptReader: Send + Sync {
    /// Incremental read: calling it often must be cheap.
    fn read(&self, transcript_path: &str, subagent_ids: &[String]) -> Option<TranscriptSummary>;
    /// The last `limit` entries of the main conversation. On demand (preview).
    fn recent(&self, transcript_path: &str, limit: usize) -> Vec<TimelineItem>;
    /// Transcript of a subagent of the session whose main transcript is `transcript_path`.
    fn subagent(&self, transcript_path: &str, agent_id: &str, limit: usize) -> Option<AgentTranscript>;
    /// Files edited in the session (main transcript and every subagent). Full scan: on demand only.
    fn touched_files(&self, transcript_path: &str) -> Vec<TouchedFile>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitInfo {
    pub hash: String,
    pub subject: String,
    pub author: String,
    /// Milliseconds since epoch.
    pub at: i64,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

/// Git history of a worktree.
pub trait GitHistory: Send + Sync {
    /// Commits reachable from HEAD made in `[since, until]` (milliseconds), newest first.
    fn commits(&self, worktree: &str, since: i64, until: Option<i64>) -> PortResult<Vec<CommitInfo>>;
    /// `git show` of one commit (patch with stat), possibly truncated.
    fn show(&self, worktree: &str, hash: &str) -> PortResult<String>;
}

/// Where to jump to see a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusTarget {
    pub host: awr_domain::TerminalHost,
    /// Strings likely to appear in the right window's title, by priority.
    pub caption_hints: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusOutcome {
    /// Focus was requested; `via` says how ("tmux + kwin", "kwin"…).
    Focused { via: String },
    /// No known way to get there (no locatable window or unsupported desktop).
    Unreachable { reason: String },
}

pub trait WindowNavigator: Send + Sync {
    fn focus(&self, target: &FocusTarget) -> PortResult<FocusOutcome>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookResponse {
    Allow,
    Deny { message: Option<String> },
    Answer { answers: BTreeMap<String, String> },
}

/// Back channel to an agent waiting for a permission decision or question answer.
pub trait HookResponder: Send + Sync {
    /// The agent is still waiting: nobody has answered in the terminal yet.
    fn is_open(&self) -> bool;
    /// Delivers the decision. `false` if nobody was waiting any more.
    fn respond(&self, response: HookResponse) -> bool;
}

/// Where to open a new or resumed agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchTarget {
    /// The app's own terminal: viewed and typed into from the war room.
    App,
    /// New Warp tab.
    Warp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchRequest {
    /// Which agent to run.
    pub provider: ProviderKind,
    pub cwd: String,
    /// Resume this session (`claude --resume <id>`, `codex resume <id>`) instead of starting a new one.
    pub resume: Option<SessionId>,
    pub target: LaunchTarget,
    /// Name for the tab or terminal.
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchOutcome {
    /// App terminal; the UI can open it right away, before the first hook arrives.
    AppTerminal {
        pty_id: String,
    },
    External {
        via: String,
    },
}

pub trait AgentLauncher: Send + Sync {
    fn launch(&self, request: &LaunchRequest) -> PortResult<LaunchOutcome>;
}

/// Writes into a live session as if typed in its terminal.
pub trait SessionInput: Send + Sync {
    /// `Err` if the session's terminal doesn't accept external input ("go to" only).
    fn send(&self, host: &awr_domain::TerminalHost, text: &str) -> PortResult<()>;
}

/// Wires the hook bridge into the agent's configuration.
pub trait IntegrationInstaller: Send + Sync {
    fn status(&self) -> PortResult<IntegrationStatus>;
    fn install(&self) -> PortResult<IntegrationStatus>;
    fn uninstall(&self) -> PortResult<IntegrationStatus>;
}
