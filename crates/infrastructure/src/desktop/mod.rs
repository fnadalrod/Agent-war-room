//! "Go to" a session: Warp (exact pane), tmux (pane + client) and KWin (window by PID).

mod kwin;
mod proc;
pub mod tmux;

use crate::locale;
use awr_application::ports::{FocusOutcome, FocusTarget, PortResult, WindowNavigator};
pub use kwin::Kwin;
use std::process::{Command, Stdio};

pub struct DesktopNavigator {
    kwin: Option<Kwin>,
}

impl DesktopNavigator {
    pub fn detect() -> Self {
        Self { kwin: Kwin::detect() }
    }

    fn raise(&self, pids: &[u32], hints: &[String]) -> Result<(), String> {
        match &self.kwin {
            Some(kwin) => kwin.activate(pids, hints),
            None => Err(locale::unsupported_desktop().into()),
        }
    }
}

impl WindowNavigator for DesktopNavigator {
    fn focus(&self, target: &FocusTarget) -> PortResult<FocusOutcome> {
        let host = &target.host;
        let hints = &target.caption_hints;

        // Warp: its link focuses the exact pane; KWin makes sure the window is raised (Wayland may
        // just flash the taskbar entry).
        if let Some(url) = &host.warp_focus_url {
            open_url(url);
            let _ = self.raise(&host.pids_above_agent(), hints);
            return Ok(FocusOutcome::Focused { via: "warp".into() });
        }

        if let Some(pane) = &host.tmux_pane {
            return Ok(match tmux::select(host.tmux_socket.as_deref(), pane) {
                Ok(Some(client)) => {
                    let pids = proc::ancestry(client);
                    match self.raise(&pids, hints) {
                        Ok(()) => FocusOutcome::Focused { via: "tmux + kwin".into() },
                        Err(_) => FocusOutcome::Focused { via: "tmux".into() },
                    }
                }
                Ok(None) => FocusOutcome::Unreachable { reason: locale::tmux_no_client(pane) },
                Err(e) => FocusOutcome::Unreachable { reason: locale::tmux_failed(&e) },
            });
        }

        let pids = host.pids_above_agent();
        if pids.is_empty() {
            return Ok(FocusOutcome::Unreachable { reason: locale::unknown_session_terminal().into() });
        }
        Ok(match self.raise(&pids, hints) {
            Ok(()) => FocusOutcome::Focused { via: "kwin".into() },
            Err(reason) => FocusOutcome::Unreachable { reason },
        })
    }
}

/// Opens a URL with the desktop's handler without blocking.
pub fn open_url(url: &str) {
    if let Ok(mut child) = Command::new("xdg-open").arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
        std::thread::spawn(move || child.wait());
    }
}
