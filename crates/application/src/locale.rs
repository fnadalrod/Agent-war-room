//! Spanish user-facing copy. The product UI is in Spanish; keep every user-visible string here so
//! the rest of the code stays in English.

// Session status labels shown on the cards.
pub const STATUS_IDLE: &str = "En espera";
pub const STATUS_THINKING: &str = "Pensando";
pub const STATUS_ASKS_PERMISSION: &str = "Pide permiso";
pub const STATUS_ASKS_QUESTION: &str = "Te pregunta";
pub const STATUS_FINISHED: &str = "Terminado";
pub const STATUS_YOUR_TURN: &str = "Te toca";
pub const STATUS_COMPACTING: &str = "Compactando";
pub const STATUS_ENDED: &str = "Cerrada";

pub fn asks_permission_for(tool: &str) -> String {
    format!("{STATUS_ASKS_PERMISSION}: {tool}")
}

pub fn asks_permission_for_detail(tool: &str, detail: &str) -> String {
    format!("{STATUS_ASKS_PERMISSION}: {tool} · {detail}")
}

// Desktop notices.
pub fn needs_you_title(place: &str) -> String {
    format!("{place} te necesita")
}

pub fn finished_title(place: &str) -> String {
    format!("{place} ha terminado")
}

pub const NEEDS_YOU_FALLBACK_BODY: &str = "Está esperando tu decisión";
pub const FINISHED_FALLBACK_BODY: &str = "Te toca revisar";

// Errors returned to the UI.
pub const NO_PENDING_PERMISSION: &str = "no hay ningún permiso pendiente en esa sesión";
pub const ALREADY_ANSWERED_IN_TERMINAL: &str = "ya se había respondido en la terminal";
pub const SESSION_CLOSED: &str = "la sesión está cerrada";
pub const SESSION_STILL_OPEN: &str = "la sesión sigue abierta: usa \"Ir a\"";

pub fn unknown_session(id: impl std::fmt::Display) -> String {
    format!("sesión desconocida: {id}")
}

pub fn unknown_subagent(id: &str) -> String {
    format!("subagente desconocido: {id}")
}
