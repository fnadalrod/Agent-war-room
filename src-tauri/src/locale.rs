//! Spanish user-facing copy. The product UI is in Spanish; keep every user-visible string here so
//! the rest of the code stays in English.

// Tray.

pub const TRAY_OPEN: &str = "Abrir la war room";
pub const TRAY_QUIT: &str = "Salir";
pub const TRAY_NEEDS_YOU: &str = "te necesitan";
pub const TRAY_FINISHED: &str = "terminadas";
pub const TRAY_WORKING: &str = "trabajando";
pub const TRAY_ALL_QUIET: &str = "Agent War Room · todo tranquilo";

/// Tooltip listing the non-empty counters, e.g. "2 te necesitan · 1 trabajando".
pub fn tray_summary(parts: &[String]) -> String {
    format!("Agent War Room · {}", parts.join(" · "))
}

// Notification buttons.

pub const NOTICE_OPEN: &str = "Ver";
pub const NOTICE_FOCUS: &str = "Ir a";
pub const NOTICE_APPROVE: &str = "Aprobar";
pub const NOTICE_REPLY: &str = "Responder";

// Tray menu.

pub const TRAY_NEXT: &str = "Ir al siguiente que te necesita";

// Command errors.

pub const ONLY_HTTP_LINKS: &str = "solo se abren enlaces http(s)";
