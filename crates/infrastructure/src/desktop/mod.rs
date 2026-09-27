//! "Ir a" una sesión: Warp (pane exacto), tmux (pane + cliente) y KWin (ventana por PID).

mod kwin;
mod proc;
pub mod tmux;

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
            None => Err("escritorio no soportado (de momento solo KDE Plasma)".into()),
        }
    }
}

impl WindowNavigator for DesktopNavigator {
    fn focus(&self, target: &FocusTarget) -> PortResult<FocusOutcome> {
        let host = &target.host;
        let hints = &target.caption_hints;

        // Warp: su enlace enfoca el pane exacto; KWin asegura que la ventana sube (Wayland puede
        // limitarse a hacer parpadear la barra de tareas).
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
                Ok(None) => FocusOutcome::Unreachable {
                    reason: format!("pane {pane} seleccionado, pero no hay ningún cliente de tmux adjunto"),
                },
                Err(e) => FocusOutcome::Unreachable { reason: format!("tmux: {e}") },
            });
        }

        let pids = host.pids_above_agent();
        if pids.is_empty() {
            return Ok(FocusOutcome::Unreachable { reason: "no se conoce la terminal de esta sesión".into() });
        }
        Ok(match self.raise(&pids, hints) {
            Ok(()) => FocusOutcome::Focused { via: "kwin".into() },
            Err(reason) => FocusOutcome::Unreachable { reason },
        })
    }
}

/// Abre una URL con el manejador del escritorio sin bloquear.
pub fn open_url(url: &str) {
    if let Ok(mut child) = Command::new("xdg-open")
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        std::thread::spawn(move || child.wait());
    }
}
