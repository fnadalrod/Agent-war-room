//! Every agent's hook payloads through the real `warroom-hook`, socket and service, without the agents
//! themselves (for Cursor and Antigravity, which could not be driven here). Payloads follow each
//! agent's contract; the process tree is the test's, so the agent is recognised from the payload.
//!
//! `cargo build -p warroom-hook && cargo test -p awr-infrastructure --test bridge_e2e -- --ignored`

mod e2e;

use awr_application::view::AttentionView;
use e2e::{Room, bridge, wait_for};
use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

/// Runs the bridge like an agent would; returns what it printed.
fn hook(room: &Room, payload: Value, arg: Option<&str>) -> String {
    let mut child = Command::new(bridge())
        .args(arg)
        .env("XDG_RUNTIME_DIR", &room.runtime)
        .env_remove("WARROOM_PROVIDER")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(payload.to_string().as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "the bridge always exits 0");
    String::from_utf8(out.stdout).unwrap()
}

#[test]
#[ignore]
fn a_cursor_turn_reaches_the_room_with_its_model_and_tokens() {
    let room = Room::start();
    let dir = room.dir().display().to_string();
    let base = |event: &str, extra: Value| {
        let mut p = json!({
            "conversation_id": "c1", "session_id": "c1", "generation_id": "g", "hook_event_name": event,
            "cursor_version": "3.18.9", "workspace_roots": [dir], "transcript_path": null, "model": "gpt-5.5",
        });
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        p
    };
    let diag = || format!("{:#?}", room.session());
    for (event, extra) in [
        ("sessionStart", json!({})),
        ("beforeSubmitPrompt", json!({ "prompt": "fix it" })),
        ("preToolUse", json!({ "tool_name": "Shell", "tool_input": { "command": "ls" }, "tool_use_id": "t" })),
    ] {
        assert_eq!(hook(&room, base(event, extra), None), "", "Cursor gets no output from us");
    }
    wait_for(
        "working in the room",
        Duration::from_secs(5),
        || room.session().is_some_and(|s| s.attention == AttentionView::Working),
        &diag,
    );
    let s = room.session().unwrap();
    assert_eq!(s.provider, "cursor");
    assert_eq!(s.status_label, "Shell");

    hook(
        &room,
        base(
            "afterAgentResponse",
            json!({ "text": "done", "input_tokens": 1000, "output_tokens": 50, "cache_read_tokens": 9000 }),
        ),
        None,
    );
    hook(&room, base("stop", json!({ "status": "completed", "loop_count": 0 })), None);
    wait_for(
        "finished with model and tokens",
        Duration::from_secs(5),
        || room.session().is_some_and(|s| s.attention == AttentionView::Finished && s.usage.total_tokens == 10_050),
        &diag,
    );
    let s = room.session().unwrap();
    assert_eq!(s.model.as_deref(), Some("gpt-5.5"));
    assert!(s.usage.partial_cost, "no price for Cursor");
}

#[test]
#[ignore]
fn an_antigravity_turn_reaches_the_room_and_always_gets_json_back() {
    let room = Room::start();
    let dir = room.dir().display().to_string();
    let base = |extra: Value| {
        let mut p = json!({
            "conversationId": "ec33ebf9-0cba-4100-8142-c61503f6c587", "workspacePaths": [dir],
            "transcriptPath": "/nonexistent/transcript.jsonl", "modelName": "gemini-3.1-pro",
        });
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        p
    };
    let diag = || format!("{:#?}", room.session());
    assert_eq!(hook(&room, base(json!({ "invocationNum": 1 })), Some("PreInvocation")), "{}");
    wait_for(
        "working in the room",
        Duration::from_secs(5),
        || room.session().is_some_and(|s| s.attention == AttentionView::Working),
        &diag,
    );
    let s = room.session().unwrap();
    assert_eq!(s.provider, "antigravity");
    assert_eq!(s.model.as_deref(), Some("gemini-3.1-pro"));

    assert_eq!(
        hook(&room, base(json!({ "stepIdx": 2, "toolCall": { "name": "run_command" } })), Some("PostToolUse")),
        "{}"
    );
    assert_eq!(hook(&room, base(json!({ "terminationReason": "model_stop", "fullyIdle": true })), Some("Stop")), "{}");
    wait_for(
        "finished",
        Duration::from_secs(5),
        || room.session().is_some_and(|s| s.attention == AttentionView::Finished),
        &diag,
    );

    // With the app gone the answer is still valid JSON, instantly.
    let gone = Room::start();
    drop(room);
    let started = std::time::Instant::now();
    let mut child = Command::new(bridge())
        .arg("Stop")
        .env("XDG_RUNTIME_DIR", gone.dir().join("nothing-here"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(br#"{"conversationId":"x"}"#).unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(String::from_utf8(out.stdout).unwrap(), "{}");
    assert!(started.elapsed() < Duration::from_secs(1));
}
