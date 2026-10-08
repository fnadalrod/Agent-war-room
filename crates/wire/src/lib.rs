//! Socket contract between `warroom-hook` and the app.
//!
//! Transport: a Unix socket at [`socket_path`] on Linux and macOS; on Windows, a named pipe whose
//! name is derived from that same path ([`pipe_name`]), so a private runtime dir isolates both.
//!
//! One connection per hook: the bridge writes a [`HookEnvelope`] on a single line (`\n`). If it sets
//! `expects_reply`, it keeps the connection open and waits for a line with a [`HookReply`]; if the app
//! closes it without replying, the agent carries on as normal.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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
    Answer { answers: BTreeMap<String, String> },
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

/// `$XDG_RUNTIME_DIR/agent-war-room/ingress.sock`, or `<temp dir>/agent-war-room-$USER/…` without XDG
/// (macOS: a per-user `$TMPDIR`). On Windows it only names the pipe (see [`pipe_name`]).
pub fn socket_path() -> PathBuf {
    // Windows: not under the temp dir, which a hook under Git Bash and the GUI app may spell
    // differently (8.3 short names), so they would never meet. A private XDG_RUNTIME_DIR still wins
    // for tests.
    if cfg!(windows) && std::env::var_os("XDG_RUNTIME_DIR").is_none_or(|d| d.is_empty()) {
        return PathBuf::from(format!("agent-war-room-{}", user())).join("ingress.sock");
    }
    runtime_dir().join("ingress.sock")
}

fn user() -> String {
    std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_else(|_| "unknown".into())
}

pub fn runtime_dir() -> PathBuf {
    match std::env::var_os("XDG_RUNTIME_DIR") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir).join("agent-war-room"),
        _ => {
            std::env::temp_dir().join(format!("agent-war-room-{}", user()))
        }
    }
}

/// The Windows named pipe for a socket path: `\\.\pipe\` plus the path, with the characters a pipe
/// name can't hold replaced. Bridge and app compute it from the same path, so they meet.
pub fn pipe_name(socket: &Path) -> String {
    let flat: String = socket
        .to_string_lossy()
        .chars()
        .map(|c| if matches!(c, '\\' | '/' | ':') { '-' } else { c })
        .collect();
    format!(r"\\.\pipe\{}", flat.trim_matches('-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pipe_name_is_the_socket_path_without_separators() {
        assert_eq!(
            pipe_name(Path::new(r"C:\Users\ana\AppData\Local\Temp\agent-war-room-ana\ingress.sock")),
            r"\\.\pipe\C--Users-ana-AppData-Local-Temp-agent-war-room-ana-ingress.sock"
        );
        assert_eq!(pipe_name(Path::new("/run/user/1000/agent-war-room/ingress.sock")), r"\\.\pipe\run-user-1000-agent-war-room-ingress.sock");
    }
}
