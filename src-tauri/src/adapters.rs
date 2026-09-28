//! Outbound adapters that depend on Tauri.

use crate::{locale, tray};
use awr_application::ports::{Notice, Notifier, ViewPublisher};
use awr_application::view::WarRoomView;
use awr_domain::{Attention, SessionId};
use awr_infrastructure::pty::{PtyEvent, PtySink};
use std::sync::Arc;
use std::sync::mpsc::Sender;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter};

pub const VIEW_EVENT: &str = "warroom://view";
pub const PTY_OUTPUT_EVENT: &str = "pty://output";
pub const PTY_EXIT_EVENT: &str = "pty://exit";

#[derive(Clone, serde::Serialize)]
struct PtyChunk {
    id: String,
    /// Raw bytes in base64: a chunk may split a UTF-8 character in half.
    data: String,
}

/// Forwards the output of the app's own terminals to the UI.
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

/// Pushes the read model to the front end and repaints the tray.
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

/// What the user clicked on a notification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoticeAction {
    /// Click on the notification or its "open" button: show the preview.
    Open(SessionId),
    Focus(SessionId),
    Approve(SessionId),
    /// Freedesktop notifications can't take inline replies: open the preview with the message box focused.
    Reply(SessionId),
}

/// Desktop notifications with buttons (freedesktop). Each session replaces its previous notification.
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
        // `wait_for_action` blocks until the notification is clicked or closed.
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
                .action("default", locale::notice_open())
                .action("focus", locale::notice_focus());
            if notice.approvable {
                n.action("approve", locale::notice_approve());
            }
            if notice.attention != Attention::Working {
                n.action("reply", locale::notice_reply());
            }
            match n.show() {
                Ok(handle) => handle.wait_for_action(|action| {
                    let session = notice.session.clone();
                    let picked = match action {
                        "default" => Some(NoticeAction::Open(session)),
                        "focus" => Some(NoticeAction::Focus(session)),
                        "approve" => Some(NoticeAction::Approve(session)),
                        "reply" => Some(NoticeAction::Reply(session)),
                        _ => None, // "__closed"
                    };
                    if let Some(picked) = picked {
                        let _ = actions.send(picked);
                    }
                }),
                Err(e) => eprintln!("[notices] {e}"),
            }
        });
    }
}

/// Stable non-zero id per session: a new notification replaces the previous one of the same session.
fn notification_id(session: &SessionId) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for b in session.0.bytes() {
        h = (h ^ b as u32).wrapping_mul(16_777_619);
    }
    h.max(1)
}
