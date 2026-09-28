//! Socket contract between `warroom-hook` and the app.
//!
//! One connection per hook: the bridge writes a [`HookEnvelope`] on a single line (`\n`). If it sets
//! `expects_reply`, it keeps the connection open and waits for a line with a [`HookReply`]; if the app
//! closes it without replying, the agent carries on as normal.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookEnvelope {
    pub v: u8,
    /// Provider that emitted the hook (`claude`).
    pub provider: String,
    pub received_at_ms: i64,
    /// PID of the agent process, if found in the parent chain.
    pub agent_pid: Option<u32>,
    /// Process chain from the hook's parent upwards.
    pub ancestry: Vec<WireProcess>,
    /// Command line the agent was launched with (`claude --resume …`).
    #[serde(default)]
    pub agent_command: Option<String>,
    pub env: EnvHints,
    /// Hook JSON exactly as the agent delivered it.
    pub payload: serde_json::Value,
    /// The bridge waits for a decision (e.g. a permission that can be approved from the app).
    #[serde(default)]
    pub expects_reply: bool,
}

/// The app's decision on a hook that was waiting for one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum HookReply {
    Allow,
    Deny { message: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireProcess {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct EnvHints {
    pub tmux: Option<String>,
    pub tmux_pane: Option<String>,
    pub term_program: Option<String>,
    /// `$WARP_FOCUS_URL`: focuses the exact Warp pane.
    pub warp_focus_url: Option<String>,
    /// `$AWR_PTY_ID`: the session runs in a terminal launched by the app itself.
    pub pty_id: Option<String>,
}

/// `$XDG_RUNTIME_DIR/agent-war-room/ingress.sock`, or `/tmp/agent-war-room-$USER/…` without XDG.
pub fn socket_path() -> PathBuf {
    runtime_dir().join("ingress.sock")
}

pub fn runtime_dir() -> PathBuf {
    match std::env::var_os("XDG_RUNTIME_DIR") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir).join("agent-war-room"),
        _ => {
            let user = std::env::var("USER").unwrap_or_else(|_| "unknown".into());
            std::env::temp_dir().join(format!("agent-war-room-{user}"))
        }
    }
}
