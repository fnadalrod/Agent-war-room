//! "Go to" a session: Warp (exact pane), tmux (pane + client) and the OS window of a process
//! (`WindowRaiser`: KWin on Linux, the app on macOS, the top-level window on Windows).

#[cfg(target_os = "linux")]
mod kwin;
#[cfg(target_os = "macos")]
mod macos;
mod proc;
pub mod tmux;
#[cfg(windows)]
mod windows;

use crate::locale;
use awr_application::ports::{FocusOutcome, FocusTarget, PortResult, WindowNavigator};
use std::process::Stdio;

#[cfg(target_os = "linux")]
use kwin::Kwin as WindowRaiser;
#[cfg(target_os = "macos")]
use macos::AppActivator as WindowRaiser;
#[cfg(windows)]
use windows::Win32Windows as WindowRaiser;

/// A desktop with no `WindowRaiser`: "go to" explains why instead.
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
struct WindowRaiser;
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
impl WindowRaiser {
    const VIA: &str = "none";
    fn detect() -> Option<Self> {
        None
    }
    fn activate(&self, _: &[u32], _: &[String]) -> Result<(), String> {
        Err(locale::unsupported_desktop().into())
    }
}

pub struct DesktopNavigator {
    raiser: Option<WindowRaiser>,
}

impl DesktopNavigator {
    pub fn detect() -> Self {
        Self { raiser: WindowRaiser::detect() }
    }

    fn raise(&self, pids: &[u32], hints: &[String]) -> Result<(), String> {
        match &self.raiser {
            Some(raiser) => raiser.activate(pids, hints),
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
                        Ok(()) => FocusOutcome::Focused { via: format!("tmux + {}", WindowRaiser::VIA) },
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
            Ok(()) => FocusOutcome::Focused { via: WindowRaiser::VIA.into() },
            Err(reason) => FocusOutcome::Unreachable { reason },
        })
    }
}

/// Opens a URL with the desktop's handler without blocking.
pub fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    // Not `cmd /C start`: cmd would split the URL at `&`.
    #[cfg(windows)]
    let mut command = {
        let mut c = crate::system::quiet_command("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let mut command = std::process::Command::new("xdg-open");
    if let Ok(mut child) = command.arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
        std::thread::spawn(move || child.wait());
    }
}

/// Which window to raise among `windows` (`(pid, caption)`): the process nearest the agent in
/// `pids` wins, unless a caption names one of the `hints` (an IDE with several projects in one
/// process); a whole-word match weighs ten times a substring ("Harbor" must not win on
/// "Harbor3Repo"). The KWin script applies the same rule in JavaScript.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn pick_window(windows: &[(u32, String)], pids: &[u32], hints: &[String]) -> Option<usize> {
    let hints: Vec<String> = hints.iter().map(|h| h.to_lowercase()).filter(|h| !h.is_empty()).collect();
    let mut best: Option<(usize, usize)> = None;
    for (i, (pid, caption)) in windows.iter().enumerate() {
        let Some(rank) = pids.iter().position(|p| p == pid) else { continue };
        let caption = caption.to_lowercase();
        let bonus = hints
            .iter()
            .enumerate()
            .map(|(h, hint)| {
                let weight = (hints.len() - h) * 1000;
                if whole_word(&caption, hint) {
                    weight * 10
                } else if caption.contains(hint.as_str()) {
                    weight
                } else {
                    0
                }
            })
            .max()
            .unwrap_or(0);
        let score = (100usize.saturating_sub(rank)) + bonus;
        if best.is_none_or(|(_, b)| score > b) {
            best = Some((i, score));
        }
    }
    best.map(|(i, _)| i)
}

fn whole_word(text: &str, word: &str) -> bool {
    let is_word = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    text.match_indices(word)
        .any(|(i, _)| !is_word(text[..i].chars().next_back()) && !is_word(text[i + word.len()..].chars().next()))
}

#[cfg(test)]
mod tests {
    use super::pick_window;

    #[test]
    fn the_nearest_process_wins_unless_a_caption_names_the_worktree() {
        let windows: Vec<(u32, String)> = [
            (5638, "HarborBackend – Makefile"),
            (5638, "Harbor3Repo – Commit: x.ts"),
            (5638, "Harbor2Repo – .env"),
            (5638, "Harbor – Commit: y.ts"),
            (9, "Konsole"),
        ]
        .into_iter()
        .map(|(p, c)| (p, c.to_owned()))
        .collect();
        let hints = |h: &[&str]| h.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let pick = |pids: &[u32], h: &[&str]| pick_window(&windows, pids, &hints(h)).map(|i| windows[i].1.as_str());

        assert_eq!(pick(&[5638], &["Harbor", "Harbor"]), Some("Harbor – Commit: y.ts"));
        assert_eq!(pick(&[5638], &["Harbor3Repo-wt-f1", "Harbor3Repo"]), Some("Harbor3Repo – Commit: x.ts"));
        assert_eq!(pick(&[5638], &["Some title", "Harbor2Repo"]), Some("Harbor2Repo – .env"));
        assert_eq!(pick(&[9, 5638], &[]), Some("Konsole"));
        assert_eq!(pick(&[1234], &["Harbor"]), None);
    }
}
