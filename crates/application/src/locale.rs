//! Typed access to this crate's user-visible text. The text itself lives in `locales/<lang>.json`
//! under `core.*`; see `awr-i18n`.

use awr_i18n::{t, tf};
use std::fmt::Display;

// Session status labels shown on the cards.
pub fn status_idle() -> &'static str {
    t("core.status.idle")
}
pub fn status_thinking() -> &'static str {
    t("core.status.thinking")
}
pub fn status_asks_permission() -> &'static str {
    t("core.status.asks_permission")
}
pub fn status_asks_question() -> &'static str {
    t("core.status.asks_question")
}
pub fn status_finished() -> &'static str {
    t("core.status.finished")
}
pub fn status_your_turn() -> &'static str {
    t("core.status.your_turn")
}
pub fn status_compacting() -> &'static str {
    t("core.status.compacting")
}
pub fn status_ended() -> &'static str {
    t("core.status.ended")
}

pub fn asks_permission_for(tool: &str) -> String {
    tf("core.status.asks_permission_for", &[("tool", &tool)])
}

pub fn asks_permission_for_detail(tool: &str, detail: &str) -> String {
    tf("core.status.asks_permission_for_detail", &[("tool", &tool), ("detail", &detail)])
}

// Desktop notices.
pub fn needs_you_title(place: &str) -> String {
    tf("core.notice.needs_you_title", &[("place", &place)])
}

pub fn finished_title(place: &str) -> String {
    tf("core.notice.finished_title", &[("place", &place)])
}

pub fn needs_you_fallback_body() -> &'static str {
    t("core.notice.needs_you_body")
}
pub fn finished_fallback_body() -> &'static str {
    t("core.notice.finished_body")
}

pub fn stalled_title(place: &str) -> String {
    tf("core.notice.stalled_title", &[("place", &place)])
}

pub fn stalled_body(minutes: i64, doing: Option<&str>) -> String {
    match doing {
        Some(doing) => tf("core.notice.stalled_body_doing", &[("minutes", &minutes), ("doing", &doing)]),
        None => tf("core.notice.stalled_body", &[("minutes", &minutes)]),
    }
}

// Errors returned to the UI.
pub fn no_pending_permission() -> &'static str {
    t("core.error.no_pending_permission")
}
pub fn already_answered_in_terminal() -> &'static str {
    t("core.error.already_answered_in_terminal")
}
pub fn session_closed() -> &'static str {
    t("core.error.session_closed")
}
pub fn session_still_open() -> &'static str {
    t("core.error.session_still_open")
}
pub fn nothing_waiting() -> &'static str {
    t("core.error.nothing_waiting")
}
pub fn invalid_commit() -> &'static str {
    t("core.error.invalid_commit")
}

pub fn unknown_session(id: impl Display) -> String {
    tf("core.error.unknown_session", &[("id", &id)])
}

pub fn unknown_subagent(id: &str) -> String {
    tf("core.error.unknown_subagent", &[("id", &id)])
}
