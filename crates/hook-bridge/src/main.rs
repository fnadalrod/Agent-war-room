//! `warroom-hook`: invoked by the agent on every hook; forwards the event to the app.
//!
//! Invariants: always exits with 0, takes milliseconds if the app is not running, and only writes
//! an explicit decision from the app to stdout. It must never break or slow down the agent.
//!
//! On `PermissionRequest` it waits for the app's decision (approve/deny from the war room) or, for
//! `AskUserQuestion`, its answers. It blocks nobody: the agent shows its own dialog at the same time
//! and, if you answer in the terminal, kills this process and discards its reply. Claude Code and
//! Codex share this protocol.

use awr_wire::{EnvHints, HookEnvelope, HookReply, PROTOCOL_VERSION, WireProcess};
use std::io::{BufRead, BufReader, Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_PAYLOAD_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ANCESTRY: usize = 12;
/// Agent processes that run hooks, and the provider each one is: the bridge is the same binary for
/// all of them, so the agent is recognised by walking up to it.
const AGENTS: &[(&str, &str)] =
    &[("claude", "claude"), ("codex", "codex"), ("cursor-agent", "cursor"), ("language_server", "antigravity")];
/// Agents that show their own permission dialog while this hook waits for the war room, so the first
/// answer wins. Codex runs the hook first and shows its dialog only after it returns: waiting there
/// would freeze its terminal, so for Codex the war room only reports the request.
const DIALOG_WHILE_WAITING: &[&str] = &["claude"];

fn main() {
    // Antigravity names the event in our command (its payloads don't) and expects JSON back, always.
    let event_arg = std::env::args().nth(1).filter(|a| !a.is_empty());
    let output = run(event_arg.as_deref()).or_else(|| event_arg.map(|_| "{}".to_owned()));
    if let Some(output) = output {
        let mut stdout = std::io::stdout();
        let _ = stdout.write_all(output.as_bytes());
        let _ = stdout.flush();
    }
    std::process::exit(0);
}

/// Returns what to print for the agent, if the app decided something.
fn run(event_arg: Option<&str>) -> Option<String> {
    let mut raw = String::new();
    std::io::stdin().take(MAX_PAYLOAD_BYTES).read_to_string(&mut raw).ok()?;
    let mut payload: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if let (Some(event), Some(map)) = (event_arg, payload.as_object_mut()) {
        map.entry("hook_event_name").or_insert_with(|| event.into());
    }
    let event = payload.get("hook_event_name").and_then(|e| e.as_str()).unwrap_or_default().to_owned();

    let ancestry: Vec<WireProcess> = awr_procs::parent_id()
        .map(|parent| awr_procs::ancestry(parent, MAX_ANCESTRY))
        .unwrap_or_default()
        .into_iter()
        .map(|(pid, name)| WireProcess { pid, name })
        .collect();
    let agent = ancestry
        .iter()
        .find_map(|p| AGENTS.iter().find(|(name, _)| *name == p.name).map(|(_, provider)| (p.pid, *provider)))
        .or_else(|| ancestry.iter().find_map(|p| node_agent(p).map(|provider| (p.pid, provider))));
    let agent_pid = agent.map(|(pid, _)| pid);

    let provider = provider(std::env::var("WARROOM_PROVIDER").ok(), fingerprint(&payload), agent.map(|(_, p)| p));
    let expects_reply = event == "PermissionRequest" && DIALOG_WHILE_WAITING.contains(&provider.as_str());
    let envelope = HookEnvelope {
        v: PROTOCOL_VERSION,
        provider,
        received_at_ms: now_ms(),
        agent_command: agent_pid.and_then(awr_procs::command_line),
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
        expects_reply,
    };
    let mut line = serde_json::to_vec(&envelope).ok()?;
    line.push(b'\n');

    if let Ok(dump) = std::env::var("WARROOM_HOOK_DUMP") {
        append_dump(&dump, &line);
    }

    let mut stream = transport::connect(&awr_wire::socket_path())?;
    stream.write_all(&line).ok()?;
    if !envelope.expects_reply {
        return None;
    }

    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).ok()?;
    let reply: HookReply = serde_json::from_str(reply.trim()).ok()?;
    Some(hook_output(&reply, &envelope.payload))
}

/// An agent installed with npm whose process is still called `node`: on Linux Claude and Codex rename
/// their process, but macOS and Windows name it after the executable. Its script path tells.
fn node_agent(process: &WireProcess) -> Option<&'static str> {
    if process.name != "node" {
        return None;
    }
    let command = awr_procs::command_line(process.pid)?;
    agent_in_node_command(&command)
}

fn agent_in_node_command(command: &str) -> Option<&'static str> {
    // Paths with spaces come quoted: look at the whole line for the package, at the script for a bin link.
    let line = command.split_once(char::is_whitespace)?.1.replace('\\', "/");
    let script = line.split_whitespace().next()?.trim_matches('\'');
    if line.contains("@anthropic-ai/claude-code") || script.ends_with("/claude") {
        Some("claude")
    } else if line.contains("@openai/codex") || script.ends_with("/codex") {
        Some("codex")
    } else {
        None
    }
}

/// Agents recognisable by their payload alone. Cursor also runs the hooks in Claude's settings, with
/// its own payload, so the process tree is not enough.
fn fingerprint(payload: &serde_json::Value) -> Option<&'static str> {
    if payload.get("cursor_version").is_some() {
        Some("cursor")
    } else if payload.get("conversationId").is_some() {
        Some("antigravity")
    } else {
        None
    }
}

/// `WARROOM_PROVIDER` wins; then the payload; then the agent found among the ancestors; Claude by default.
fn provider(env: Option<String>, payload: Option<&str>, ancestor: Option<&str>) -> String {
    env.filter(|p| !p.is_empty())
        .or_else(|| payload.map(str::to_owned))
        .or_else(|| ancestor.map(str::to_owned))
        .unwrap_or_else(|| "claude".into())
}

/// Output Claude Code and Codex understand for `PermissionRequest` (the same contract). Answers to
/// `AskUserQuestion` are an "allow" whose `updatedInput` is the original input plus `answers`.
fn hook_output(reply: &HookReply, payload: &serde_json::Value) -> String {
    let decision = match reply {
        HookReply::Allow => serde_json::json!({ "behavior": "allow" }),
        HookReply::Deny { message } => serde_json::json!({
            "behavior": "deny",
            "message": message.clone().unwrap_or_else(|| awr_i18n::t("bridge.default_deny").into()),
        }),
        HookReply::Answer { answers } => {
            let mut input = payload.get("tool_input").cloned().unwrap_or_else(|| serde_json::json!({}));
            if let Some(input) = input.as_object_mut() {
                input.insert("answers".into(), serde_json::json!(answers));
            }
            serde_json::json!({ "behavior": "allow", "updatedInput": input })
        }
    };
    serde_json::json!({
        "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision }
    })
    .to_string()
}

fn append_dump(path: &str, line: &[u8]) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line);
    }
}

/// Connection to the app. It must fail at once when the app is not running.
#[cfg(unix)]
mod transport {
    use std::os::unix::net::UnixStream;
    use std::path::Path;
    use std::time::Duration;

    /// Below the hook timeout (600 s) so we exit on our own terms.
    const REPLY_WAIT: Duration = Duration::from_secs(590);

    pub fn connect(socket: &Path) -> Option<UnixStream> {
        let stream = UnixStream::connect(socket).ok()?;
        stream.set_write_timeout(Some(Duration::from_millis(500))).ok()?;
        stream.set_read_timeout(Some(REPLY_WAIT)).ok()?;
        Some(stream)
    }
}

/// Windows: the app's named pipe, opened as a file. A missing pipe (app down) fails at once; a busy
/// one (every instance taken by other hooks for an instant) is retried briefly. Pipe handles have no
/// read timeout: if the app hangs while we wait for a decision, the agent's own hook timeout ends us.
#[cfg(windows)]
mod transport {
    use std::fs::File;
    use std::path::Path;
    use std::time::Duration;

    const ERROR_PIPE_BUSY: i32 = 231;

    pub fn connect(socket: &Path) -> Option<File> {
        let name = awr_wire::pipe_name(socket);
        for _ in 0..20 {
            match std::fs::OpenOptions::new().read(true).write(true).open(&name) {
                // Pipe names are global: only a server run by this same user may receive our
                // payloads and, above all, send back an "allow".
                Ok(pipe) => return same_user_server(&pipe).then_some(pipe),
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => return None,
            }
        }
        None
    }

    fn same_user_server(pipe: &File) -> bool {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
        use windows_sys::Win32::System::Threading::{
            GetCurrentProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        let mut server = 0u32;
        // SAFETY: a valid pipe handle owned by `pipe` and an out-pointer to a local.
        if unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut server) } == 0 {
            return false;
        }
        // SAFETY: plain query; a null handle is checked below and every handle opened is closed.
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, server);
            if process.is_null() {
                return false;
            }
            let same = match (user_sid(process), user_sid(GetCurrentProcess())) {
                (Some(theirs), Some(ours)) => same_sid(&theirs, &ours),
                _ => false,
            };
            windows_sys::Win32::Foundation::CloseHandle(process);
            same
        }
    }

    /// The `TOKEN_USER` of a process, as raw bytes (the SID lives inside the buffer).
    unsafe fn user_sid(process: windows_sys::Win32::Foundation::HANDLE) -> Option<Vec<u8>> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TokenUser};
        use windows_sys::Win32::System::Threading::OpenProcessToken;
        let mut token = std::ptr::null_mut();
        // SAFETY: caller passes a process handle with query rights.
        if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
            return None;
        }
        let mut buf = vec![0u8; 256];
        let mut len = 0u32;
        // SAFETY: `buf` is writable for its length; the token is closed right after.
        let ok = unsafe { GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), buf.len() as u32, &mut len) };
        unsafe { CloseHandle(token) };
        (ok != 0).then_some(buf)
    }

    fn same_sid(a: &[u8], b: &[u8]) -> bool {
        use windows_sys::Win32::Security::{EqualSid, TOKEN_USER};
        // SAFETY: both buffers hold a TOKEN_USER written by GetTokenInformation, whose SID pointer
        // points inside the same (still alive) buffer.
        unsafe {
            let a = &*(a.as_ptr() as *const TOKEN_USER);
            let b = &*(b.as_ptr() as *const TOKEN_USER);
            EqualSid(a.User.Sid, b.User.Sid) != 0
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_provider_comes_from_the_environment_the_payload_then_the_agent_process() {
        assert_eq!(provider(Some("codex".into()), None, Some("claude")), "codex");
        assert_eq!(provider(None, None, Some("codex")), "codex");
        assert_eq!(provider(Some(String::new()), None, None), "claude");
        // Cursor running the hooks from Claude's settings, from a terminal where `claude` is an ancestor.
        let cursor = serde_json::json!({ "cursor_version": "3.18.9", "hook_event_name": "stop" });
        assert_eq!(provider(None, fingerprint(&cursor), Some("claude")), "cursor");
        assert_eq!(fingerprint(&serde_json::json!({ "conversationId": "x" })), Some("antigravity"));
    }

    #[test]
    fn npm_installs_running_under_node_are_recognised_by_their_script() {
        assert_eq!(
            agent_in_node_command(r"node C:\Users\a\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js"),
            Some("claude")
        );
        assert_eq!(agent_in_node_command("node /opt/homebrew/bin/codex --yolo"), Some("codex"));
        assert_eq!(
            agent_in_node_command(r"node 'C:\Program Files\nodejs\node_modules\@anthropic-ai\claude-code\cli.js'"),
            Some("claude")
        );
        assert_eq!(agent_in_node_command("node /usr/local/bin/vite"), None);
        assert_eq!(agent_in_node_command("node"), None);
    }

    #[test]
    fn permission_output_matches_claude_code_contract() {
        let allow: serde_json::Value = serde_json::from_str(&hook_output(&HookReply::Allow, &serde_json::json!({}))).unwrap();
        assert_eq!(allow["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(allow["hookSpecificOutput"]["decision"]["behavior"], "allow");

        let deny: serde_json::Value =
            serde_json::from_str(&hook_output(&HookReply::Deny { message: Some("no".into()) }, &serde_json::json!({}))).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert_eq!(deny["hookSpecificOutput"]["decision"]["message"], "no");
    }

    #[test]
    fn question_output_preserves_the_questions_and_supplies_answers() {
        let payload = serde_json::json!({
            "tool_input": {
                "questions": [{
                    "question": "Which framework?",
                    "header": "Framework",
                    "options": [{"label": "React", "description": "Components"}],
                    "multiSelect": false
                }]
            }
        });
        let answer = HookReply::Answer {
            answers: [("Which framework?".into(), "React".into())].into_iter().collect(),
        };
        let output: serde_json::Value = serde_json::from_str(&hook_output(&answer, &payload)).unwrap();
        let decision = &output["hookSpecificOutput"]["decision"];
        assert_eq!(output["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(decision["behavior"], "allow");
        assert_eq!(decision["updatedInput"]["questions"], payload["tool_input"]["questions"]);
        assert_eq!(decision["updatedInput"]["answers"]["Which framework?"], "React");
    }
}
