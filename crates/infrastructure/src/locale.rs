//! User-facing copy. Keep every user-visible string here so wording lives in one place and the rest
//! of the code stays free of UI text.

use std::fmt::Display;

// Typing into sessions and launching agents.

pub const EXTERNAL_TERMINAL_NO_INPUT: &str =
    "this session lives in an external terminal: you can't write to it from here, use \"Go to\"";

pub fn invalid_session_id(id: impl Display) -> String {
    format!("invalid session id: {id}")
}

pub fn unknown_terminal(id: &str) -> String {
    format!("unknown terminal: {id}")
}

/// Name of the Warp tab opened for an agent.
pub fn warp_tab_name(label: &str) -> String {
    format!("War Room · {label}")
}

// "Go to" a session: reasons shown when its window cannot be reached.

pub const UNSUPPORTED_DESKTOP: &str = "unsupported desktop (only KDE Plasma for now)";
pub const UNKNOWN_SESSION_TERMINAL: &str = "this session's terminal is unknown";
pub const NO_CANDIDATE_PROCESSES: &str = "no candidate processes";

pub fn tmux_no_client(pane: &str) -> String {
    format!("pane {pane} selected, but no tmux client is attached")
}

pub fn tmux_failed(error: &str) -> String {
    format!("tmux: {error}")
}

pub fn kwin_script_not_loaded(reply: &str) -> String {
    format!("KWin did not load the script: {reply}")
}

// Hook installation.

pub const SETTINGS_NOT_AN_OBJECT: &str = "settings.json is not a JSON object";
pub const BRIDGE_NOT_FOUND: &str = "the warroom-hook binary was not found; build it with `cargo build -p warroom-hook`";

pub fn settings_invalid_json(error: impl Display) -> String {
    format!("settings.json is not valid JSON: {error}")
}

pub fn invalid_bridge(path: impl Display) -> String {
    format!("{path} is not a valid bridge executable")
}
