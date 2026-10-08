//! macOS: activates the application (Terminal, iTerm2, an IDE…) that owns the session. No special
//! permission is needed; the price is that the app comes forward with all its windows, so the
//! caption hints can't choose one among several (that would need the Accessibility API).

use crate::locale;
use objc2_app_kit::{NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication};

pub struct AppActivator;

impl AppActivator {
    pub const VIA: &str = "macos";

    pub fn detect() -> Option<Self> {
        Some(Self)
    }

    /// The first PID in `pids` that is a regular app (has a Dock icon and windows) is activated.
    pub fn activate(&self, pids: &[u32], _hints: &[String]) -> Result<(), String> {
        if pids.is_empty() {
            return Err(locale::no_candidate_processes().into());
        }
        let app = pids
            .iter()
            .filter_map(|pid| i32::try_from(*pid).ok())
            .filter_map(NSRunningApplication::runningApplicationWithProcessIdentifier)
            .find(|app| app.activationPolicy() == NSApplicationActivationPolicy::Regular)
            .ok_or_else(|| locale::no_window_for_session().to_owned())?;
        if app.isHidden() {
            app.unhide();
        }
        if app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows) {
            Ok(())
        } else {
            Err(locale::window_refused().into())
        }
    }
}
