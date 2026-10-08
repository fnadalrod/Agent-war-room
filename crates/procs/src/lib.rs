//! The process table, the same on every OS: name and parent of a PID, its command line, liveness.
//! Used by the hook bridge (to find the agent among its ancestors) and by the app (liveness, focus).
//!
//! Linux reads `/proc`; macOS and Windows ask the OS through `sysinfo`. Names are normalised so the
//! callers can match them across systems: no `.exe` suffix.

#[cfg_attr(target_os = "linux", path = "linux.rs")]
#[cfg_attr(not(target_os = "linux"), path = "other.rs")]
mod os;

/// One process: what the OS calls it (`claude`, `konsole`, `Code`) and its parent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessEntry {
    pub name: String,
    pub parent: Option<u32>,
}

/// Name and parent of `pid`, if it exists.
pub fn entry(pid: u32) -> Option<ProcessEntry> {
    os::entry(pid).map(|e| ProcessEntry { name: normalise(e.name), parent: e.parent.filter(|p| *p != pid) })
}

/// The process exists and is not a zombie.
pub fn is_alive(pid: u32) -> bool {
    os::is_alive(pid)
}

/// Readable command line: space-separated arguments, quoted when needed.
pub fn command_line(pid: u32) -> Option<String> {
    let args: Vec<String> = os::args(pid)?
        .into_iter()
        .filter(|a| !a.is_empty())
        .map(|arg| if arg.contains(char::is_whitespace) { format!("'{}'", arg.replace('\'', "'\\''")) } else { arg })
        .collect();
    (!args.is_empty()).then(|| args.join(" "))
}

/// The parent of this process.
pub fn parent_id() -> Option<u32> {
    entry(std::process::id())?.parent
}

/// `pid` and its ancestors, nearest first, with their names; at most `limit`, stopping before the
/// system's root process (init, launchd, System).
pub fn ancestry(pid: u32, limit: usize) -> Vec<(u32, String)> {
    let table = os::Table::load();
    let mut chain = Vec::new();
    let mut current = Some(pid);
    while let Some(pid) = current.filter(|p| *p > 1 && chain.len() < limit) {
        let Some(entry) = table.entry(pid).map(|e| ProcessEntry { name: normalise(e.name), parent: e.parent }) else {
            break;
        };
        // A recycled parent PID could point back into the chain.
        if chain.iter().any(|(p, _)| *p == pid) {
            break;
        }
        chain.push((pid, entry.name));
        current = entry.parent;
    }
    chain
}

fn normalise(name: String) -> String {
    match name.len().checked_sub(4) {
        Some(cut) if name[cut..].eq_ignore_ascii_case(".exe") => name[..cut].to_owned(),
        _ => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_own_process_is_alive_named_and_has_a_parent() {
        let me = entry(std::process::id()).unwrap();
        assert!(!me.name.is_empty());
        assert!(me.parent.is_some());
        assert!(is_alive(std::process::id()));
        assert!(!is_alive(u32::MAX - 1));
    }

    #[test]
    fn the_chain_starts_with_the_pid_and_climbs_to_the_parent() {
        let chain = ancestry(std::process::id(), 16);
        assert_eq!(chain[0].0, std::process::id());
        assert_eq!(chain.get(1).map(|(p, _)| *p), parent_id());
    }

    #[test]
    fn reads_the_command_line_of_a_process() {
        let own = command_line(std::process::id()).unwrap();
        assert!(own.contains("awr_procs"), "{own}");
    }

    #[test]
    fn windows_names_lose_the_exe_suffix() {
        assert_eq!(normalise("claude.exe".into()), "claude");
        assert_eq!(normalise("Code.EXE".into()), "Code");
        assert_eq!(normalise("exe".into()), "exe");
        assert_eq!(normalise("claude".into()), "claude");
    }
}
