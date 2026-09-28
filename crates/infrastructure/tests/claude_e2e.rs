//! End-to-end tests against a real Claude Code: hooks → `warroom-hook` → socket → service.
//!
//! Manual (each one costs a short Claude call):
//! `cargo build -p warroom-hook && cargo test -p awr-infrastructure --test claude_e2e -- --ignored --nocapture`
//!
//! Everything is isolated: temp folder, own `XDG_RUNTIME_DIR` (socket), own tmux server and
//! `--settings` only for these sessions. It does not touch `~/.claude/settings.json`.

use awr_application::ports::*;
use awr_application::view::{AttentionView, SessionView, WarRoomView};
use awr_application::{Ports, WarRoomService};
use awr_domain::SessionId;
use awr_infrastructure::claude::{ClaudeProvider, ClaudeTranscriptReader, FsSkillCatalog};
use awr_infrastructure::git::{GitCli, GitRepoResolver};
use awr_infrastructure::ingress;
use awr_infrastructure::launch::{DesktopLauncher, TerminalInput, inherited_agent_markers};
use awr_infrastructure::pty::{PtyManager, PtySpec};
use awr_infrastructure::sqlite::SqliteEventStore;
use awr_infrastructure::system::{ProcProbe, SystemClock};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
struct LastView(Mutex<Option<WarRoomView>>);
impl ViewPublisher for LastView {
    fn publish(&self, view: &WarRoomView) {
        *self.0.lock().unwrap() = Some(view.clone());
    }
}
struct Quiet;
impl Notifier for Quiet {
    fn notify(&self, _: &Notice) {}
}
struct NoWindows;
impl WindowNavigator for NoWindows {
    fn focus(&self, _: &FocusTarget) -> PortResult<FocusOutcome> {
        Ok(FocusOutcome::Unreachable { reason: "test".into() })
    }
}

fn bridge() -> PathBuf {
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/warroom-hook");
    assert!(target.exists(), "build the bridge first: cargo build -p warroom-hook");
    target.canonicalize().unwrap()
}

/// Real service with its own socket and a work folder whose `--settings` point at the bridge.
struct Room {
    work: tempfile::TempDir,
    runtime: PathBuf,
    _rt: tokio::runtime::Runtime,
    service: Arc<WarRoomService>,
    view: Arc<LastView>,
    pty: Arc<PtyManager>,
}

impl Room {
    fn start() -> Self {
        let work = tempfile::Builder::new().prefix("awr-e2e").tempdir_in("/tmp").unwrap();
        let dir = work.path();
        // Short paths: a Unix socket path cannot exceed 108 bytes.
        let runtime = dir.join("r");
        std::fs::create_dir_all(&runtime).unwrap();
        Command::new("git").arg("-C").arg(dir).args(["init", "-q"]).status().unwrap();

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
        let settings: serde_json::Map<String, serde_json::Value> =
            events.iter().map(|e| (e.to_string(), hook(e))).collect();
        std::fs::write(dir.join("settings.json"), serde_json::json!({ "hooks": settings }).to_string()).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let view = Arc::new(LastView::default());
        let pty = PtyManager::new(Arc::new(|_| {}));
        let service = Arc::new(WarRoomService::new(Ports {
            providers: vec![Arc::new(ClaudeProvider)],
            resolver: Arc::new(GitRepoResolver::new()),
            store: Arc::new(SqliteEventStore::in_memory().unwrap()),
            clock: Arc::new(SystemClock),
            probe: Arc::new(ProcProbe),
            notifier: Arc::new(Quiet),
            publisher: view.clone(),
            transcripts: Arc::new(ClaudeTranscriptReader::new()),
            navigator: Arc::new(NoWindows),
            launcher: Arc::new(DesktopLauncher::new(pty.clone(), dir.join("warp"))),
            input: Arc::new(TerminalInput::new(pty.clone())),
            skills: Arc::new(FsSkillCatalog::new(dir.join("home/.claude"))),
            git: Arc::new(GitCli),
        }));
        let listener = rt.block_on(ingress::bind(&runtime.join("agent-war-room/ingress.sock"))).unwrap();
        let ingest = service.clone();
        rt.spawn(ingress::serve(listener, Arc::new(move |s| ingest.ingest(s).unwrap())));

        Self { work, runtime, _rt: rt, service, view, pty }
    }

    fn dir(&self) -> &Path {
        self.work.path()
    }

    fn claude_args(&self, prompt: Option<&str>) -> Vec<String> {
        let mut args = vec![
            "--settings".into(),
            self.dir().join("settings.json").display().to_string(),
            "--permission-mode".into(),
            "default".into(),
        ];
        args.extend(prompt.map(str::to_owned));
        args
    }

    fn session(&self) -> Option<SessionView> {
        self.view.0.lock().unwrap().clone()?.rooms.first()?.sessions.first().cloned()
    }

    fn diag(&self, screen: &dyn Fn() -> String) -> String {
        format!("--- screen ---\n{}\n--- view ---\n{:#?}", screen(), self.view.0.lock().unwrap())
    }
}

fn wait_for(what: &str, timeout: Duration, mut check: impl FnMut() -> bool, diag: &dyn Fn() -> String) {
    let start = Instant::now();
    while !check() {
        assert!(start.elapsed() < timeout, "timed out waiting for: {what}\n{}", diag());
        std::thread::sleep(Duration::from_millis(300));
    }
}

fn is_busy(s: &SessionView) -> bool {
    matches!(s.attention, AttentionView::Working | AttentionView::NeedsYou)
}

fn tmux(socket: &Path, args: &[&str]) -> String {
    let out = Command::new("tmux").arg("-S").arg(socket).args(args).output().unwrap();
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
#[ignore]
fn a_real_permission_request_is_approved_from_the_war_room() {
    let room = Room::start();
    let dir = room.dir();
    let tmux_socket = dir.join("t.sock");
    let args: Vec<String> = room
        .claude_args(Some("Run exactly this with Bash: touch approved.txt"))
        .into_iter()
        .map(|a| format!("'{a}'"))
        .collect();
    let command = format!("XDG_RUNTIME_DIR={} claude {}", room.runtime.display(), args.join(" "));
    tmux(&tmux_socket, &["new-session", "-d", "-x", "160", "-y", "40", "-c", dir.to_str().unwrap(), &command]);

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
        tmux(&tmux_socket, &["send-keys", "Down"]);
        std::thread::sleep(Duration::from_millis(300));
        tmux(&tmux_socket, &["send-keys", "Enter"]);
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

    tmux(&tmux_socket, &["kill-server"]);
}

#[test]
#[ignore]
fn a_session_in_an_app_terminal_is_linked_and_can_be_typed_into() {
    let room = Room::start();
    let pty_id = room
        .pty
        .spawn(PtySpec {
            program: "claude".into(),
            args: room.claude_args(None),
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
