//! Contrato del socket entre `warroom-hook` y la app. Un envelope JSON por conexión.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookEnvelope {
    pub v: u8,
    /// Proveedor que emitió el hook (`claude`).
    pub provider: String,
    pub received_at_ms: i64,
    /// PID del proceso del agente, si se encontró en la cadena de padres.
    pub agent_pid: Option<u32>,
    /// Cadena de procesos desde el padre del hook hacia arriba.
    pub ancestry: Vec<WireProcess>,
    pub env: EnvHints,
    /// JSON del hook tal cual lo entregó el agente.
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireProcess {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvHints {
    pub tmux: Option<String>,
    pub tmux_pane: Option<String>,
    pub term_program: Option<String>,
}

/// `$XDG_RUNTIME_DIR/agent-war-room/ingress.sock`, o `/tmp/agent-war-room-$USER/…` sin XDG.
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
