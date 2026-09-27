//! Adaptadores de salida que dependen de Tauri.

use crate::tray;
use awr_application::ports::{Notice, Notifier, ViewPublisher};
use awr_application::view::WarRoomView;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

pub const VIEW_EVENT: &str = "warroom://view";

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
