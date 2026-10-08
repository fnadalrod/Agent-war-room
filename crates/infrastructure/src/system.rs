use awr_application::ports::{Clock, ProcessProbe};
use awr_domain::Timestamp;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Timestamp {
        Timestamp(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default())
    }

    fn day(&self, at: Timestamp) -> i64 {
        use chrono::Datelike;
        crate::jsonl::local_day(at.0).map(|d| i64::from(d.num_days_from_ce())).unwrap_or(at.0.div_euclid(86_400_000))
    }
}

/// A command for a console program that must not flash a console window on Windows (the app is a
/// GUI program there, so every child would get its own).
pub fn quiet_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Asks the OS process table (`awr-procs`) whether the PID still exists and is not a zombie.
pub struct ProcProbe;

impl ProcessProbe for ProcProbe {
    fn is_alive(&self, pid: u32) -> bool {
        awr_procs::is_alive(pid)
    }
}
