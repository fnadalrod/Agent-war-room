//! `warroom-hook`: lo invoca el agente en cada hook y reenvía el evento a la app.
//!
//! Invariantes: no escribe nada en stdout (el agente lo interpretaría), sale siempre con 0 y
//! tarda milisegundos aunque la app no esté abierta. Nunca debe romper ni frenar al agente.

use awr_wire::{EnvHints, HookEnvelope, PROTOCOL_VERSION, WireProcess};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_PAYLOAD_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ANCESTRY: usize = 12;
const AGENT_PROCESS_NAMES: &[&str] = &["claude"];

fn main() {
    let _ = run();
    std::process::exit(0);
}

fn run() -> Option<()> {
    let mut raw = String::new();
    std::io::stdin().take(MAX_PAYLOAD_BYTES).read_to_string(&mut raw).ok()?;
    let payload: serde_json::Value = serde_json::from_str(&raw).ok()?;

    let ancestry = ancestry(std::os::unix::process::parent_id());
    let agent_pid = ancestry
        .iter()
        .find(|p| AGENT_PROCESS_NAMES.contains(&p.name.as_str()))
        .map(|p| p.pid);

    let envelope = HookEnvelope {
        v: PROTOCOL_VERSION,
        provider: std::env::var("WARROOM_PROVIDER").unwrap_or_else(|_| "claude".into()),
        received_at_ms: now_ms(),
        agent_pid,
        ancestry,
        env: EnvHints {
            tmux: std::env::var("TMUX").ok(),
            tmux_pane: std::env::var("TMUX_PANE").ok(),
            term_program: std::env::var("TERM_PROGRAM").ok(),
            warp_focus_url: std::env::var("WARP_FOCUS_URL").ok(),
            pty_id: std::env::var("AWR_PTY_ID").ok(),
        },
        payload,
    };
    let line = serde_json::to_vec(&envelope).ok()?;

    if let Ok(dump) = std::env::var("WARROOM_HOOK_DUMP") {
        append_dump(&dump, &line);
    }

    let mut stream = UnixStream::connect(awr_wire::socket_path()).ok()?;
    stream.set_write_timeout(Some(Duration::from_millis(500))).ok()?;
    stream.write_all(&line).ok()?;
    stream.shutdown(std::net::Shutdown::Write).ok()
}

/// Sube por `/proc/<pid>/stat` desde el padre del hook. El agente puede lanzar el hook a través de
/// un shell, así que no basta con `getppid()`.
fn ancestry(start: u32) -> Vec<WireProcess> {
    let mut chain = Vec::new();
    let mut pid = start;
    while pid > 1 && chain.len() < MAX_ANCESTRY {
        let Some((name, ppid)) = read_stat(pid) else { break };
        chain.push(WireProcess { pid, name });
        pid = ppid;
    }
    chain
}

/// `/proc/<pid>/stat` es `pid (comm) state ppid …`; `comm` puede contener espacios y paréntesis.
fn read_stat(pid: u32) -> Option<(String, u32)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let name = stat[open + 1..close].to_string();
    let ppid = stat[close + 1..].split_whitespace().nth(1)?.parse().ok()?;
    Some((name, ppid))
}

fn append_dump(path: &str, line: &[u8]) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line);
        let _ = f.write_all(b"\n");
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_own_process_stat() {
        let (name, ppid) = read_stat(std::process::id()).unwrap();
        assert!(!name.is_empty());
        assert_eq!(ppid, std::os::unix::process::parent_id());
    }
}
