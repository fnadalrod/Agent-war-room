//! `warroom-hook`: lo invoca el agente en cada hook y reenvía el evento a la app.
//!
//! Invariantes: sale siempre con 0, tarda milisegundos si la app no está, y solo escribe en
//! stdout una decisión explícita de la app. Nunca debe romper ni frenar al agente.
//!
//! En `PermissionRequest` espera la decisión de la app (aprobar/denegar desde la war room). No
//! bloquea a nadie: Claude muestra su diálogo a la vez y, si contestas en la terminal, mata este
//! proceso y descarta su respuesta.

use awr_wire::{EnvHints, HookEnvelope, HookReply, PROTOCOL_VERSION, WireProcess};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_PAYLOAD_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ANCESTRY: usize = 12;
const AGENT_PROCESS_NAMES: &[&str] = &["claude"];
/// Por debajo del timeout del hook (600 s) para salir por nuestro pie.
const REPLY_WAIT: Duration = Duration::from_secs(590);

fn main() {
    if let Some(output) = run() {
        let mut stdout = std::io::stdout();
        let _ = stdout.write_all(output.as_bytes());
        let _ = stdout.flush();
    }
    std::process::exit(0);
}

/// Devuelve lo que hay que imprimir para el agente, si la app decidió algo.
fn run() -> Option<String> {
    let mut raw = String::new();
    std::io::stdin().take(MAX_PAYLOAD_BYTES).read_to_string(&mut raw).ok()?;
    let payload: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let event = payload.get("hook_event_name").and_then(|e| e.as_str()).unwrap_or_default().to_owned();

    let ancestry = ancestry(std::os::unix::process::parent_id());
    let agent_pid = ancestry
        .iter()
        .find(|p| AGENT_PROCESS_NAMES.contains(&p.name.as_str()))
        .map(|p| p.pid);

    let envelope = HookEnvelope {
        v: PROTOCOL_VERSION,
        provider: std::env::var("WARROOM_PROVIDER").unwrap_or_else(|_| "claude".into()),
        received_at_ms: now_ms(),
        agent_command: agent_pid.and_then(command_line),
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
        expects_reply: event == "PermissionRequest",
    };
    let mut line = serde_json::to_vec(&envelope).ok()?;
    line.push(b'\n');

    if let Ok(dump) = std::env::var("WARROOM_HOOK_DUMP") {
        append_dump(&dump, &line);
    }

    let mut stream = UnixStream::connect(awr_wire::socket_path()).ok()?;
    stream.set_write_timeout(Some(Duration::from_millis(500))).ok()?;
    stream.write_all(&line).ok()?;
    if !envelope.expects_reply {
        return None;
    }

    stream.set_read_timeout(Some(REPLY_WAIT)).ok()?;
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).ok()?;
    let reply: HookReply = serde_json::from_str(reply.trim()).ok()?;
    Some(permission_output(&reply))
}

/// Salida que Claude Code entiende para `PermissionRequest`.
fn permission_output(reply: &HookReply) -> String {
    let decision = match reply {
        HookReply::Allow => serde_json::json!({ "behavior": "allow" }),
        HookReply::Deny { message } => serde_json::json!({
            "behavior": "deny",
            "message": message.clone().unwrap_or_else(|| "Denegado desde Agent War Room".into()),
        }),
    };
    serde_json::json!({
        "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision }
    })
    .to_string()
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

/// `/proc/<pid>/cmdline` legible: argumentos separados por espacios, entrecomillados si hace falta.
fn command_line(pid: u32) -> Option<String> {
    let raw = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let args: Vec<String> = raw
        .split(|&b| b == 0)
        .filter(|a| !a.is_empty())
        .map(|a| {
            let arg = String::from_utf8_lossy(a).into_owned();
            if arg.contains(char::is_whitespace) { format!("'{}'", arg.replace('\'', "'\\''")) } else { arg }
        })
        .collect();
    (!args.is_empty()).then(|| args.join(" "))
}

fn append_dump(path: &str, line: &[u8]) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line);
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

    #[test]
    fn reads_the_command_line_of_a_process() {
        let own = command_line(std::process::id()).unwrap();
        assert!(own.contains("warroom_hook"), "{own}");
    }

    #[test]
    fn permission_output_matches_claude_code_contract() {
        let allow: serde_json::Value = serde_json::from_str(&permission_output(&HookReply::Allow)).unwrap();
        assert_eq!(allow["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(allow["hookSpecificOutput"]["decision"]["behavior"], "allow");

        let deny: serde_json::Value =
            serde_json::from_str(&permission_output(&HookReply::Deny { message: Some("no".into()) })).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert_eq!(deny["hookSpecificOutput"]["decision"]["message"], "no");
    }
}
