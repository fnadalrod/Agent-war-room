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

/// Checks in `/proc` that the PID still exists and is not a zombie.
pub struct ProcProbe;

impl ProcessProbe for ProcProbe {
    fn is_alive(&self, pid: u32) -> bool {
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };
        let state = stat.rfind(')').and_then(|i| stat[i + 1..].split_whitespace().next());
        state != Some("Z")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_process_is_alive_and_absurd_pid_is_not() {
        assert!(ProcProbe.is_alive(std::process::id()));
        assert!(!ProcProbe.is_alive(u32::MAX - 1));
    }
}
