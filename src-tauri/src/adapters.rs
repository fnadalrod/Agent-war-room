//! Adaptadores de salida que dependen de Tauri.

use crate::tray;
use awr_application::ports::{Notice, Notifier, ViewPublisher};
use awr_domain::{Attention, SessionId};
use std::sync::mpsc::Sender;
use awr_application::view::WarRoomView;
use awr_infrastructure::pty::{PtyEvent, PtySink};
use std::sync::Arc;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter};

pub const VIEW_EVENT: &str = "warroom://view";
pub const PTY_OUTPUT_EVENT: &str = "pty://output";
pub const PTY_EXIT_EVENT: &str = "pty://exit";

#[derive(Clone, serde::Serialize)]
struct PtyChunk {
    id: String,
    /// Bytes crudos en base64: un trozo puede cortar un carácter UTF-8 por la mitad.
    data: String,
}

/// Reenvía la salida de los terminales propios a la UI.
pub fn pty_sink(app: AppHandle) -> PtySink {
    use base64::Engine;
    Arc::new(move |event| match event {
        PtyEvent::Output { id, data } => {
            let data = base64::engine::general_purpose::STANDARD.encode(data);
            let _ = app.emit(PTY_OUTPUT_EVENT, PtyChunk { id, data });
        }
        PtyEvent::Exited { id } => {
            let _ = app.emit(PTY_EXIT_EVENT, id);
        }
    })
}

/// Empuja el read model al front y repinta la bandeja.
pub struct TauriPublisher {
    app: AppHandle,
    tray: TrayIcon,
}

impl TauriPublisher {
    pub fn new(app: AppHandle, tray: TrayIcon) -> Self {
        Self { app, tray }
    }
}

impl ViewPublisher for TauriPublisher {
    fn publish(&self, view: &WarRoomView) {
        let _ = self.app.emit(VIEW_EVENT, view);
        tray::paint(&self.tray, view);
    }
}

/// Lo que pulsaste en un aviso.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoticeAction {
    /// Clic en el aviso o "Ver": abrir la vista previa.
    Open(SessionId),
    Focus(SessionId),
    Approve(SessionId),
}

/// Avisos de escritorio con botones (freedesktop). Cada sesión reemplaza su aviso anterior.
pub struct DesktopNotifier {
    actions: Sender<NoticeAction>,
}

impl DesktopNotifier {
    pub fn new(actions: Sender<NoticeAction>) -> Self {
        Self { actions }
    }
}

impl Notifier for DesktopNotifier {
    fn notify(&self, notice: &Notice) {
        use notify_rust::{Notification, Timeout, Urgency};
        let notice = notice.clone();
        let actions = self.actions.clone();
        // `wait_for_action` bloquea hasta que se pulsa o se cierra el aviso.
        std::thread::spawn(move || {
            let urgent = notice.attention == Attention::NeedsYou;
            let mut n = Notification::new();
            n.appname("Agent War Room")
                .summary(&notice.title)
                .body(&notice.body)
                .icon("dialog-information")
                .id(notification_id(&notice.session))
                .urgency(if urgent { Urgency::Critical } else { Urgency::Normal })
                .timeout(if urgent { Timeout::Never } else { Timeout::Milliseconds(10_000) })
                .action("default", "Ver")
                .action("focus", "Ir a");
            if notice.approvable {
                n.action("approve", "Aprobar");
            }
            match n.show() {
                Ok(handle) => handle.wait_for_action(|action| {
                    let session = notice.session.clone();
                    let picked = match action {
                        "default" => Some(NoticeAction::Open(session)),
                        "focus" => Some(NoticeAction::Focus(session)),
                        "approve" => Some(NoticeAction::Approve(session)),
                        _ => None, // "__closed"
                    };
                    if let Some(picked) = picked {
                        let _ = actions.send(picked);
                    }
                }),
                Err(e) => eprintln!("[avisos] {e}"),
            }
        });
    }
}

/// Id estable por sesión (distinto de 0): un aviso nuevo sustituye al anterior de la misma sesión.
fn notification_id(session: &SessionId) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for b in session.0.bytes() {
        h = (h ^ b as u32).wrapping_mul(16_777_619);
    }
    h.max(1)
}
