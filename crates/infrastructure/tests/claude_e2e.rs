//! End-to-end tests against a real Claude Code: hooks → `warroom-hook` → socket → service.
//!
//! Manual (each one costs a short Claude call):
//! `cargo build -p warroom-hook && cargo test -p awr-infrastructure --test claude_e2e -- --ignored --nocapture`
//!
//! Everything is isolated: temp folder, own `XDG_RUNTIME_DIR` (socket), own tmux server and
//! `--settings` only for these sessions. It does not touch `~/.claude/settings.json`.

mod e2e;

use awr_application::view::AttentionView;
use awr_domain::SessionId;
use awr_infrastructure::launch::inherited_agent_markers;
use awr_infrastructure::pty::PtySpec;
use e2e::{Room, TmuxServer, bridge, is_busy, tmux, wait_for};
use std::collections::BTreeMap;
use std::time::Duration;

/// `settings.json` for these sessions only, pointing every hook we use at the bridge.
fn claude_args(room: &Room, prompt: Option<&str>) -> Vec<String> {
    let settings = room.dir().join("settings.json");
    if !settings.exists() {
        let events = [
            "SessionStart",
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PermissionRequest",
            "Notification",
            "Stop",
            "SessionEnd",
        ];
        let hook = |event: &str| {
            let timeout = if event == "PermissionRequest" { 600 } else { 5 };
            serde_json::json!([{ "matcher": "", "hooks": [{ "type": "command", "command": bridge(), "timeout": timeout }] }])
        };
        let hooks: serde_json::Map<String, serde_json::Value> =
            events.iter().map(|e| (e.to_string(), hook(e))).collect();
        std::fs::write(&settings, serde_json::json!({ "hooks": hooks }).to_string()).unwrap();
    }
    let mut args =
        vec!["--settings".into(), settings.display().to_string(), "--permission-mode".into(), "default".into()];
    args.extend(prompt.map(str::to_owned));
    args
}

/// The trust dialog defaults to "No, exit" and renders before its keys work: a `Down` sent too early
/// is lost and `Enter` quits Claude. Move until "Yes" is selected, then confirm.
fn trust_folder(socket: &std::path::Path, diag: &dyn Fn() -> String) {
    wait_for(
        "\"Yes, I trust\" selected",
        Duration::from_secs(10),
        || {
            if tmux(socket, &["capture-pane", "-p"]).contains("❯ Yes, I trust") {
                return true;
            }
            tmux(socket, &["send-keys", "Down"]);
            std::thread::sleep(Duration::from_millis(300));
            false
        },
        diag,
    );
    tmux(socket, &["send-keys", "Enter"]);
}

#[test]
#[ignore]
fn a_real_permission_request_is_approved_from_the_war_room() {
    let room = Room::start();
    let dir = room.dir();
    let tmux_socket = dir.join("t.sock");
    let args: Vec<String> = claude_args(&room, Some("Run exactly this with Bash: touch approved.txt"))
        .into_iter()
        .map(|a| format!("'{a}'"))
        .collect();
    let command = format!("XDG_RUNTIME_DIR={} claude {}", room.runtime.display(), args.join(" "));
    tmux(&tmux_socket, &["new-session", "-d", "-x", "160", "-y", "40", "-c", dir.to_str().unwrap(), &command]);
    let _server = TmuxServer(tmux_socket.clone());

    let screen = || tmux(&tmux_socket, &["capture-pane", "-p"]);
    let diag = || room.diag(&screen);

    // New folder: Claude asks whether we trust it. `SessionStart` arrives before that dialog,
    // so "there is a session" is not enough: wait for work or the dialog itself.
    wait_for(
        "trust dialog or work",
        Duration::from_secs(30),
        || screen().contains("trust this folder") || room.session().is_some_and(|s| is_busy(&s)),
        &diag,
    );
    if screen().contains("trust this folder") {
        trust_folder(&tmux_socket, &diag);
    }

    wait_for(
        "permission approvable from the war room",
        Duration::from_secs(90),
        || room.session().is_some_and(|s| s.attention == AttentionView::NeedsYou && s.can_approve),
        &diag,
    );
    let session = room.session().unwrap();
    println!("status: {}", session.status_label);
    assert!(screen().contains("Do you want to proceed"), "Claude shows its own dialog at the same time");

    room.service.approve(SessionId(session.id.clone())).unwrap();

    wait_for("file created by Claude", Duration::from_secs(60), || dir.join("approved.txt").exists(), &diag);
    wait_for(
        "end of turn",
        Duration::from_secs(60),
        || room.session().is_some_and(|s| s.attention == AttentionView::Finished),
        &diag,
    );
    assert!(screen().contains("Allowed by PermissionRequest hook"));
    println!("title: {:?}", room.service.view().rooms[0].sessions[0].title);
}

#[test]
#[ignore]
fn a_real_permission_request_is_approved_automatically() {
    let room = Room::start();
    assert!(room.service.set_auto_approve(true));
    let dir = room.dir();
    let tmux_socket = dir.join("t.sock");
    let args: Vec<String> = claude_args(&room, Some("Run exactly this with Bash: touch approved.txt"))
        .into_iter()
        .map(|a| format!("'{a}'"))
        .collect();
    let command = format!("XDG_RUNTIME_DIR={} claude {}", room.runtime.display(), args.join(" "));
    tmux(&tmux_socket, &["new-session", "-d", "-x", "160", "-y", "40", "-c", dir.to_str().unwrap(), &command]);
    let _server = TmuxServer(tmux_socket.clone());

    let screen = || tmux(&tmux_socket, &["capture-pane", "-p"]);
    let diag = || room.diag(&screen);

    // New folder: Claude asks whether we trust it. `SessionStart` arrives before that dialog,
    // so "there is a session" is not enough: wait for work or the dialog itself.
    wait_for(
        "trust dialog or work",
        Duration::from_secs(30),
        || screen().contains("trust this folder") || room.session().is_some_and(|s| is_busy(&s)),
        &diag,
    );
    if screen().contains("trust this folder") {
        trust_folder(&tmux_socket, &diag);
    }

    wait_for("file created by Claude", Duration::from_secs(60), || dir.join("approved.txt").exists(), &diag);
    wait_for(
        "end of turn",
        Duration::from_secs(60),
        || room.session().is_some_and(|s| s.attention == AttentionView::Finished),
        &diag,
    );
    assert!(screen().contains("Allowed by PermissionRequest hook"));
    let session = &room.service.view().rooms[0].sessions[0];
    assert!(!session.can_approve, "the automatic decision never becomes a pending approval");
    println!("title: {:?}", session.title);
}

#[test]
#[ignore]
fn a_real_question_is_answered_from_the_war_room() {
    let room = Room::start();
    let dir = room.dir();
    let tmux_socket = dir.join("t.sock");
    let prompt = "Use AskUserQuestion exactly once to ask Which database should we use? with the options SQLite and PostgreSQL. After the answer, reply with CHOSEN followed by the answer.";
    let args: Vec<String> = claude_args(&room, Some(prompt)).into_iter().map(|a| format!("'{a}'")).collect();
    let command = format!("XDG_RUNTIME_DIR={} claude {}", room.runtime.display(), args.join(" "));
    tmux(&tmux_socket, &["new-session", "-d", "-x", "160", "-y", "40", "-c", dir.to_str().unwrap(), &command]);
    let _server = TmuxServer(tmux_socket.clone());

    let screen = || tmux(&tmux_socket, &["capture-pane", "-p"]);
    let diag = || room.diag(&screen);
    wait_for(
        "trust dialog or work",
        Duration::from_secs(30),
        || screen().contains("trust this folder") || room.session().is_some_and(|s| is_busy(&s)),
        &diag,
    );
    if screen().contains("trust this folder") {
        trust_folder(&tmux_socket, &diag);
    }

    wait_for(
        "answerable question",
        Duration::from_secs(90),
        || room.session().is_some_and(|s| s.can_answer_question && !s.questions.is_empty()),
        &diag,
    );
    wait_for("Claude's own dialog at the same time", Duration::from_secs(10), || screen().contains("Enter to select"), &diag);
    let session = room.session().unwrap();
    let prompt = session.questions[0].question.clone();
    assert!(session.questions[0].options.iter().any(|option| option.label == "SQLite"));
    let answers: BTreeMap<String, String> = [(prompt, "SQLite".into())].into_iter().collect();
    room.service.answer_question(SessionId(session.id), answers).unwrap();

    wait_for(
        "Claude continuation after the answer",
        Duration::from_secs(90),
        || {
            room.session().is_some_and(|s| {
                s.attention == AttentionView::Finished
                    && s.last_reply.as_deref().is_some_and(|reply| reply.contains("CHOSEN") && reply.contains("SQLite"))
            })
        },
        &diag,
    );
    println!("reply: {:?}", room.session().unwrap().last_reply);
}

#[test]
#[ignore]
fn a_real_question_answered_in_the_terminal_leaves_the_war_room() {
    let room = Room::start();
    let dir = room.dir();
    let tmux_socket = dir.join("t.sock");
    let prompt = "Use AskUserQuestion exactly once to ask Which database should we use? with the options SQLite and PostgreSQL.";
    let args: Vec<String> = claude_args(&room, Some(prompt)).into_iter().map(|a| format!("'{a}'")).collect();
    let command = format!("XDG_RUNTIME_DIR={} claude {}", room.runtime.display(), args.join(" "));
    tmux(&tmux_socket, &["new-session", "-d", "-x", "160", "-y", "40", "-c", dir.to_str().unwrap(), &command]);
    let _server = TmuxServer(tmux_socket.clone());

    let screen = || tmux(&tmux_socket, &["capture-pane", "-p"]);
    let diag = || room.diag(&screen);
    wait_for(
        "trust dialog or work",
        Duration::from_secs(30),
        || screen().contains("trust this folder") || room.session().is_some_and(|s| is_busy(&s)),
        &diag,
    );
    if screen().contains("trust this folder") {
        trust_folder(&tmux_socket, &diag);
    }

    wait_for(
        "answerable question",
        Duration::from_secs(90),
        || room.session().is_some_and(|s| s.can_answer_question),
        &diag,
    );
    wait_for("Claude's own dialog at the same time", Duration::from_secs(10), || screen().contains("Enter to select"), &diag);

    // The first option is selected: answering in the terminal kills the waiting hook.
    tmux(&tmux_socket, &["send-keys", "Enter"]);
    wait_for(
        "the app's question withdrawn",
        Duration::from_secs(20),
        || {
            let _ = room.service.tick();
            room.session().is_some_and(|s| !s.can_answer_question)
        },
        &diag,
    );
    assert!(room.service.answer_question(SessionId(room.session().unwrap().id), BTreeMap::new()).is_err());
}

#[test]
#[ignore]
fn a_session_in_an_app_terminal_is_linked_and_can_be_typed_into() {
    let room = Room::start();
    let pty_id = room
        .pty
        .spawn(PtySpec {
            program: "claude".into(),
            args: claude_args(&room, None),
            cwd: room.dir().display().to_string(),
            label: "e2e".into(),
            env: vec![("XDG_RUNTIME_DIR".into(), room.runtime.display().to_string())],
            env_remove: inherited_agent_markers(),
        })
        .unwrap();
    let screen = || String::from_utf8_lossy(&room.pty.snapshot(&pty_id).unwrap_or_default()).into_owned();
    let diag = || room.diag(&screen);

    // There is no emulator here (in the app it is xterm.js): answer the TUI's queries like it would.
    let answered = std::cell::Cell::new((0usize, 0usize));
    let answer_queries = || {
        let out = screen();
        let (da1, version) = answered.get();
        let (seen_da1, seen_version) = (out.matches("\x1b[c").count(), out.matches("\x1b[>0q").count());
        for _ in da1..seen_da1 {
            room.pty.write(&pty_id, b"\x1b[?62;22c").unwrap();
        }
        for _ in version..seen_version {
            room.pty.write(&pty_id, b"\x1bP>|xterm(390)\x1b\\").unwrap();
        }
        answered.set((seen_da1, seen_version));
    };

    // Raw PTY output: words are separated by cursor-positioning codes, not spaces.
    let asks_trust = || screen().contains("trust") && screen().contains("folder");
    wait_for(
        "trust dialog or linked session",
        Duration::from_secs(30),
        || {
            answer_queries();
            asks_trust() || room.session().is_some()
        },
        &diag,
    );
    if asks_trust() {
        std::thread::sleep(Duration::from_secs(1));
        room.pty.write(&pty_id, b"\x1b[B").unwrap();
        std::thread::sleep(Duration::from_secs(1));
        room.pty.write(&pty_id, b"\r").unwrap();
    }

    wait_for(
        "session linked to its terminal",
        Duration::from_secs(30),
        || {
            answer_queries();
            room.session().is_some_and(|s| s.pty_id.as_deref() == Some(pty_id.as_str()))
        },
        &diag,
    );
    let id = SessionId(room.session().unwrap().id);
    // The TUI takes a moment to accept input after starting.
    std::thread::sleep(Duration::from_secs(2));

    room.service.send_input(id, "Reply with just the word PONG, without using tools.").unwrap();

    wait_for(
        "reply to the message typed from the war room",
        Duration::from_secs(90),
        || {
            answer_queries();
            room.session().is_some_and(|s| {
                s.attention == AttentionView::Finished && s.last_reply.as_deref().is_some_and(|r| r.contains("PONG"))
            })
        },
        &diag,
    );
    println!("reply: {:?}", room.session().unwrap().last_reply);
    room.pty.close(&pty_id).unwrap();
}
