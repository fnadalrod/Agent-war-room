//! Typed access to the shell's user-visible text. The text itself lives in `locales/<lang>.json`
//! under `shell.*`; see `awr-i18n`.

use awr_i18n::{t, tf};

// Tray.

pub fn tray_open() -> &'static str {
    t("shell.tray.open")
}
pub fn tray_next() -> &'static str {
    t("shell.tray.next")
}
pub fn tray_quit() -> &'static str {
    t("shell.tray.quit")
}
pub fn tray_needs_you(n: usize) -> String {
    tf("shell.tray.needs_you", &[("n", &n)])
}
pub fn tray_finished(n: usize) -> String {
    tf("shell.tray.finished", &[("n", &n)])
}
pub fn tray_working(n: usize) -> String {
    tf("shell.tray.working", &[("n", &n)])
}
pub fn tray_all_quiet() -> &'static str {
    t("shell.tray.all_quiet")
}

/// Tooltip listing the non-empty counters, e.g. "2 need you · 1 working".
pub fn tray_summary(parts: &[String]) -> String {
    tf("shell.tray.summary", &[("parts", &parts.join(" · "))])
}

// Notification buttons.

pub fn notice_open() -> &'static str {
    t("shell.notice.open")
}
pub fn notice_focus() -> &'static str {
    t("shell.notice.focus")
}
pub fn notice_approve() -> &'static str {
    t("shell.notice.approve")
}
pub fn notice_reply() -> &'static str {
    t("shell.notice.reply")
}

// Command errors.

pub fn only_http_links() -> &'static str {
    t("shell.error.only_http_links")
}
