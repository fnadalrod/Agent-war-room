//! `/proc`: no syscalls beyond reading files, fast enough for the hook bridge.

pub struct RawEntry {
    pub name: String,
    pub parent: Option<u32>,
}

/// `/proc/<pid>/stat` is `pid (comm) state ppid …`; `comm` may contain spaces and parentheses.
fn stat(pid: u32) -> Option<(String, String, u32)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let mut rest = stat[close + 1..].split_whitespace();
    let state = rest.next()?.to_owned();
    let ppid = rest.next()?.parse().ok()?;
    Some((stat[open + 1..close].to_owned(), state, ppid))
}

pub fn entry(pid: u32) -> Option<RawEntry> {
    let (name, _, ppid) = stat(pid)?;
    Some(RawEntry { name, parent: (ppid > 0).then_some(ppid) })
}

pub fn is_alive(pid: u32) -> bool {
    stat(pid).is_some_and(|(_, state, _)| state != "Z")
}

pub fn args(pid: u32) -> Option<Vec<String>> {
    let raw = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    Some(raw.split(|&b| b == 0).map(|a| String::from_utf8_lossy(a).into_owned()).collect())
}

/// Reads `/proc` lazily, one PID at a time.
pub struct Table;

impl Table {
    pub fn load() -> Self {
        Self
    }

    pub fn entry(&self, pid: u32) -> Option<RawEntry> {
        entry(pid)
    }
}
