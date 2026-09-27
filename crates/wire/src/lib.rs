//! Contrato del socket entre `warroom-hook` y la app.
//!
//! Una conexión por hook: el puente escribe un [`HookEnvelope`] en una línea (`\n`). Si marca
//! `expects_reply`, deja la conexión abierta y espera una línea con un [`HookReply`]; si la app
//! la cierra sin responder, el agente sigue su flujo normal.

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
    /// Línea de comandos con la que se lanzó el agente (`claude --resume …`).
    #[serde(default)]
    pub agent_command: Option<String>,
    pub env: EnvHints,
    /// JSON del hook tal cual lo entregó el agente.
    pub payload: serde_json::Value,
    /// El puente espera una decisión (p. ej. un permiso que se puede aprobar desde la app).
    #[serde(default)]
    pub expects_reply: bool,
}

/// Decisión de la app sobre un hook que la esperaba.
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
    /// `$WARP_FOCUS_URL`: enfoca el pane exacto de Warp.
    pub warp_focus_url: Option<String>,
    /// `$AWR_PTY_ID`: la sesión corre en un terminal lanzado por la propia app.
    pub pty_id: Option<String>,
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
