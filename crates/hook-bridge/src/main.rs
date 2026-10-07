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
use std::os::unix::net::UnixStream;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
/// Below the hook timeout (600 s) so we exit on our own terms.
const REPLY_WAIT: Duration = Duration::from_secs(590);

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

    let ancestry = ancestry(std::os::unix::process::parent_id());
    let agent = ancestry
        .iter()
        .find_map(|p| AGENTS.iter().find(|(name, _)| *name == p.name).map(|(_, provider)| (p.pid, *provider)));
    let agent_pid = agent.map(|(pid, _)| pid);

    let provider = provider(std::env::var("WARROOM_PROVIDER").ok(), fingerprint(&payload), agent.map(|(_, p)| p));
    let expects_reply = event == "PermissionRequest" && DIALOG_WHILE_WAITING.contains(&provider.as_str());
    let envelope = HookEnvelope {
        v: PROTOCOL_VERSION,
        provider,
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
        expects_reply,
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
    Some(hook_output(&reply, &envelope.payload))
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

/// Walks up `/proc/<pid>/stat` from the hook's parent. The agent may launch the hook through a
/// shell, so `getppid()` is not enough.
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

/// `/proc/<pid>/stat` is `pid (comm) state ppid …`; `comm` may contain spaces and parentheses.
fn read_stat(pid: u32) -> Option<(String, u32)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let name = stat[open + 1..close].to_string();
    let ppid = stat[close + 1..].split_whitespace().nth(1)?.parse().ok()?;
    Some((name, ppid))
}

/// Readable `/proc/<pid>/cmdline`: space-separated arguments, quoted when needed.
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
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default()
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
