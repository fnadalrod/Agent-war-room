//! Adaptadores de salida que dependen de Tauri.

use crate::tray;
use awr_application::ports::{Notice, Notifier, ViewPublisher};
use awr_application::view::WarRoomView;
use awr_infrastructure::pty::{PtyEvent, PtySink};
use std::sync::Arc;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

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

pub struct DesktopNotifier {
    app: AppHandle,
}

impl DesktopNotifier {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Notifier for DesktopNotifier {
    fn notify(&self, notice: &Notice) {
        let _ = self
            .app
            .notification()
            .builder()
            .title(&notice.title)
            .body(&notice.body)
            .show();
    }
}
