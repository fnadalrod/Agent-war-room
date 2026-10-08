//! Windows: the visible top-level window of the session's processes, raised with
//! `SetForegroundWindow`. Windows only lets the foreground app hand focus over; "go to" is a click
//! in the war room, so we are that app. Console windows report their client process (the shell),
//! so the PID chain reaches them as it reaches Windows Terminal or an IDE.

use super::pick_window;
use crate::locale;
use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GetWindow, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SW_RESTORE, SetForegroundWindow, ShowWindow,
};
use windows_sys::core::BOOL;

pub struct Win32Windows;

struct Candidate {
    hwnd: HWND,
    pid: u32,
    caption: String,
}

impl Win32Windows {
    pub const VIA: &str = "windows";

    pub fn detect() -> Option<Self> {
        Some(Self)
    }

    pub fn activate(&self, pids: &[u32], hints: &[String]) -> Result<(), String> {
        if pids.is_empty() {
            return Err(locale::no_candidate_processes().into());
        }
        let windows = top_level_windows();
        let captions: Vec<(u32, String)> = windows.iter().map(|w| (w.pid, w.caption.clone())).collect();
        let best = pick_window(&captions, pids, hints).ok_or_else(|| locale::no_window_for_session().to_owned())?;
        let hwnd = windows[best].hwnd;
        // SAFETY: `hwnd` came from EnumWindows just now; a window closed meanwhile only makes the
        // calls fail.
        let raised = unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd) != 0
        };
        if raised { Ok(()) } else { Err(locale::window_refused().into()) }
    }
}

/// Visible, unowned top-level windows (what the taskbar shows) with their PID and caption.
fn top_level_windows() -> Vec<Candidate> {
    unsafe extern "system" fn collect(hwnd: HWND, list: LPARAM) -> BOOL {
        // SAFETY: `list` is the `&mut Vec` passed to EnumWindows below, alive for the whole call.
        let list = unsafe { &mut *(list as *mut Vec<Candidate>) };
        // SAFETY: plain queries on a window handle given by the enumeration.
        unsafe {
            if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
                return 1;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            let mut title = [0u16; 512];
            let len = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32).max(0) as usize;
            list.push(Candidate { hwnd, pid, caption: String::from_utf16_lossy(&title[..len]) });
        }
        1
    }
    let mut list: Vec<Candidate> = Vec::new();
    // SAFETY: the callback only touches `list` through the pointer, during this call.
    unsafe {
        EnumWindows(Some(collect), &mut list as *mut Vec<Candidate> as LPARAM);
    }
    list
}
