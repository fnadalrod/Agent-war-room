//! Spanish user-facing copy. The product UI is in Spanish; keep every user-visible string here so
//! the rest of the code stays in English.

use std::fmt::Display;

// Typing into sessions and launching agents.

pub const EXTERNAL_TERMINAL_NO_INPUT: &str =
    "esta sesión vive en una terminal externa: no se puede escribir desde aquí, usa \"Ir a\"";

pub fn invalid_session_id(id: impl Display) -> String {
    format!("id de sesión no válido: {id}")
}

pub fn unknown_terminal(id: &str) -> String {
    format!("terminal desconocido: {id}")
}

/// Name of the Warp tab opened for an agent.
pub fn warp_tab_name(label: &str) -> String {
    format!("War Room · {label}")
}

// "Go to" a session: reasons shown when its window cannot be reached.

pub const UNSUPPORTED_DESKTOP: &str = "escritorio no soportado (de momento solo KDE Plasma)";
pub const UNKNOWN_SESSION_TERMINAL: &str = "no se conoce la terminal de esta sesión";
pub const NO_CANDIDATE_PROCESSES: &str = "sin procesos candidatos";

pub fn tmux_no_client(pane: &str) -> String {
    format!("pane {pane} seleccionado, pero no hay ningún cliente de tmux adjunto")
}

pub fn tmux_failed(error: &str) -> String {
    format!("tmux: {error}")
}

pub fn kwin_script_not_loaded(reply: &str) -> String {
    format!("KWin no cargó el script: {reply}")
}

// Hook installation.

pub const SETTINGS_NOT_AN_OBJECT: &str = "settings.json no es un objeto JSON";
pub const BRIDGE_NOT_FOUND: &str =
    "no se encuentra el binario warroom-hook; compílalo con `cargo build -p warroom-hook`";

pub fn settings_invalid_json(error: impl Display) -> String {
    format!("settings.json no es JSON válido: {error}")
}

pub fn invalid_bridge(path: impl Display) -> String {
    format!("{path} no es un ejecutable válido del puente")
}
