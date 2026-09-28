//! User-facing copy. Keep every user-visible string here so wording lives in one place and the rest
//! of the code stays free of UI text.

// Tray.

pub const TRAY_OPEN: &str = "Open the war room";
pub const TRAY_QUIT: &str = "Quit";
pub const TRAY_NEEDS_YOU: &str = "need you";
pub const TRAY_FINISHED: &str = "finished";
pub const TRAY_WORKING: &str = "working";
pub const TRAY_ALL_QUIET: &str = "Agent War Room · all quiet";

/// Tooltip listing the non-empty counters, e.g. "2 need you · 1 working".
pub fn tray_summary(parts: &[String]) -> String {
    format!("Agent War Room · {}", parts.join(" · "))
}

// Notification buttons.

pub const NOTICE_OPEN: &str = "View";
pub const NOTICE_FOCUS: &str = "Go to";
pub const NOTICE_APPROVE: &str = "Approve";
pub const NOTICE_REPLY: &str = "Reply";

// Tray menu.

pub const TRAY_NEXT: &str = "Go to the next one that needs you";

// Command errors.

pub const ONLY_HTTP_LINKS: &str = "only http(s) links are opened";
