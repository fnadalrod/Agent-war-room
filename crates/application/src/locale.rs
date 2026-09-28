//! User-facing copy. Keep every user-visible string here so wording lives in one place and the rest
//! of the code stays free of UI text.

// Session status labels shown on the cards.
pub const STATUS_IDLE: &str = "Idle";
pub const STATUS_THINKING: &str = "Thinking";
pub const STATUS_ASKS_PERMISSION: &str = "Asks permission";
pub const STATUS_ASKS_QUESTION: &str = "Asks you";
pub const STATUS_FINISHED: &str = "Finished";
pub const STATUS_YOUR_TURN: &str = "Your turn";
pub const STATUS_COMPACTING: &str = "Compacting";
pub const STATUS_ENDED: &str = "Closed";

pub fn asks_permission_for(tool: &str) -> String {
    format!("{STATUS_ASKS_PERMISSION}: {tool}")
}

pub fn asks_permission_for_detail(tool: &str, detail: &str) -> String {
    format!("{STATUS_ASKS_PERMISSION}: {tool} · {detail}")
}

// Desktop notices.
pub fn needs_you_title(place: &str) -> String {
    format!("{place} needs you")
}

pub fn finished_title(place: &str) -> String {
    format!("{place} has finished")
}

pub const NEEDS_YOU_FALLBACK_BODY: &str = "Waiting for your decision";
pub const FINISHED_FALLBACK_BODY: &str = "Your turn to review";

// Errors returned to the UI.
pub const NO_PENDING_PERMISSION: &str = "there is no pending permission in that session";
pub const ALREADY_ANSWERED_IN_TERMINAL: &str = "it was already answered in the terminal";
pub const SESSION_CLOSED: &str = "the session is closed";
pub const SESSION_STILL_OPEN: &str = "the session is still open: use \"Go to\"";

pub fn unknown_session(id: impl std::fmt::Display) -> String {
    format!("unknown session: {id}")
}

pub fn unknown_subagent(id: &str) -> String {
    format!("unknown subagent: {id}")
}

pub fn stalled_title(place: &str) -> String {
    format!("{place} looks stuck")
}

pub fn stalled_body(minutes: i64, doing: Option<&str>) -> String {
    match doing {
        Some(doing) => format!("No activity for {minutes} min · {doing}"),
        None => format!("No activity for {minutes} min"),
    }
}

pub const NOTHING_WAITING: &str = "nothing is waiting for you";
pub const INVALID_COMMIT: &str = "invalid commit";
