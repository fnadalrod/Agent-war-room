//! Typed access to this crate's user-visible text. The text itself lives in `locales/<lang>.json`
//! under `desktop.*`; see `awr-i18n`.

use awr_i18n::{t, tf};
use std::fmt::Display;

// Typing into sessions and launching agents.

pub fn external_terminal_no_input() -> &'static str {
    t("desktop.external_terminal_no_input")
}

pub fn invalid_session_id(id: impl Display) -> String {
    tf("desktop.invalid_session_id", &[("id", &id)])
}

pub fn unknown_terminal(id: &str) -> String {
    tf("desktop.unknown_terminal", &[("id", &id)])
}

pub fn agent_not_launchable(agent: &str) -> String {
    tf("desktop.agent_not_launchable", &[("agent", &agent)])
}

/// Name of the Warp tab opened for an agent.
pub fn warp_tab_name(label: &str) -> String {
    tf("desktop.warp_tab_name", &[("label", &label)])
}

// "Go to" a session: reasons shown when its window cannot be reached.

pub fn unsupported_desktop() -> &'static str {
    t("desktop.unsupported_desktop")
}
pub fn unknown_session_terminal() -> &'static str {
    t("desktop.unknown_session_terminal")
}
pub fn no_candidate_processes() -> &'static str {
    t("desktop.no_candidate_processes")
}
pub fn no_window_for_session() -> &'static str {
    t("desktop.no_window_for_session")
}
pub fn window_refused() -> &'static str {
    t("desktop.window_refused")
}

pub fn tmux_no_client(pane: &str) -> String {
    tf("desktop.tmux_no_client", &[("pane", &pane)])
}

pub fn tmux_failed(error: &str) -> String {
    tf("desktop.tmux_failed", &[("error", &error)])
}

pub fn kwin_script_not_loaded(reply: &str) -> String {
    tf("desktop.kwin_script_not_loaded", &[("reply", &reply)])
}

// Hook installation.

pub fn settings_not_an_object() -> &'static str {
    t("desktop.settings_not_an_object")
}
pub fn bridge_not_found() -> &'static str {
    t("desktop.bridge_not_found")
}

pub fn settings_invalid_json(error: impl Display) -> String {
    tf("desktop.settings_invalid_json", &[("error", &error)])
}

pub fn invalid_bridge(path: impl Display) -> String {
    tf("desktop.invalid_bridge", &[("path", &path)])
}
