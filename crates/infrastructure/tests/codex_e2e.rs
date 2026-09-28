//! End-to-end tests against a real Codex: hooks → `warroom-hook` → socket → service.
//!
//! Manual (each one costs a short Codex call):
//! `cargo build -p warroom-hook && cargo test -p awr-infrastructure --test codex_e2e -- --ignored --nocapture`
//!
//! Isolated like the Claude ones, plus its own `CODEX_HOME`: the hooks are installed there by the real
//! installer, and only your login (`auth.json`) is copied in. It does not touch `~/.codex`.

mod e2e;

use awr_application::ports::IntegrationInstaller;
use awr_application::view::AttentionView;
use awr_infrastructure::codex::{CODEX_HOOKS, codex_home};
use awr_infrastructure::hook_installer::HookInstaller;
use e2e::{Room, TmuxServer, bridge, tmux, wait_for};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A `CODEX_HOME` with your login and our hooks, installed by the app's own installer.
fn isolated_codex_home(room: &Room) -> PathBuf {
    let home = room.dir().join("cx");
    std::fs::create_dir_all(&home).unwrap();
    let real = codex_home(&dirs_home());
    std::fs::copy(real.join("auth.json"), home.join("auth.json")).expect("log in to Codex first");
    let installer =
        HookInstaller::new(&CODEX_HOOKS, home.join("hooks.json"), Some(bridge()), room.dir().join("bin/warroom-hook"));
    assert!(installer.install().unwrap().installed);
    home
}

fn dirs_home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME"))
}

/// Codex asks, in a fresh home, to review the new hooks (and maybe to trust the folder). The dialog
/// is drawn over an already visible prompt box, so "ready" means the box stays alone for a while.
fn pass_first_run_dialogs(socket: &Path, screen: &dyn Fn() -> String, diag: &dyn Fn() -> String) {
    let calm = std::cell::Cell::new(0);
    wait_for(
        "Codex ready for a prompt",
        Duration::from_secs(60),
        || {
            let s = screen();
            let answer = |keys: &[&str]| {
                for k in keys {
                    tmux(socket, &["send-keys", k]);
                    std::thread::sleep(Duration::from_millis(300));
                }
                calm.set(0);
                false
            };
            if s.contains("Trust all and continue") {
                return answer(&["2", "Enter"]);
            }
            if s.to_lowercase().contains("trust") && (s.contains("folder") || s.contains("directory")) {
                return answer(&["Enter"]);
            }
            calm.set(if s.contains("Ask Codex") { calm.get() + 1 } else { 0 });
            calm.get() >= 10
        },
        diag,
    );
}

#[test]
#[ignore]
fn a_real_codex_session_is_followed_from_start_to_end() {
    let room = Room::start();
    let dir = room.dir();
    let codex_home = isolated_codex_home(&room);
    let socket = dir.join("t.sock");
    let command = format!(
        "XDG_RUNTIME_DIR={} CODEX_HOME={} codex --sandbox read-only --ask-for-approval on-request",
        room.runtime.display(),
        codex_home.display()
    );
    tmux(&socket, &["new-session", "-d", "-x", "160", "-y", "45", "-c", dir.to_str().unwrap(), &command]);
    let _server = TmuxServer(socket.clone());
    let screen = || tmux(&socket, &["capture-pane", "-p"]);
    let diag = || room.diag(&screen);

    pass_first_run_dialogs(&socket, &screen, &diag);
    tmux(
        &socket,
        &[
            "send-keys",
            "-l",
            "Run exactly this shell command: touch approved.txt . The sandbox is read-only: request approval to run it outside the sandbox. Then reply with just: done",
        ],
    );
    std::thread::sleep(Duration::from_millis(500));
    tmux(&socket, &["send-keys", "Enter"]);

    // Read-only sandbox: writing the file needs your approval. Codex runs the hook before showing
    // its dialog, so the bridge does not hold it: the war room reports it, you answer in Codex.
    wait_for(
        "permission request reported",
        Duration::from_secs(120),
        || room.session().is_some_and(|s| s.attention == AttentionView::NeedsYou),
        &diag,
    );
    let session = room.session().unwrap();
    println!("status: {}", session.status_label);
    assert_eq!(session.provider, "codex", "the bridge recognised the agent by its process");
    assert!(!session.can_approve, "not held for the war room");
    wait_for("Codex's own dialog", Duration::from_secs(20), || screen().contains("Would you like to run"), &diag);

    tmux(&socket, &["send-keys", "y"]);
    wait_for("file created by Codex", Duration::from_secs(60), || dir.join("approved.txt").exists(), &diag);
    wait_for(
        "end of turn",
        Duration::from_secs(120),
        || room.session().is_some_and(|s| s.attention == AttentionView::Finished),
        &diag,
    );
    let session = room.session().unwrap();
    println!("model: {:?} effort: {:?}", session.model, session.effort);
    println!("reply: {:?}", session.last_reply);
    println!("context: {:?}/{:?} usage: {:?}", session.context_tokens, session.context_window, session.usage);
    assert!(session.model.is_some_and(|m| m.starts_with("gpt")), "read from the rollout");
    assert!(session.last_reply.is_some());

    tmux(&socket, &["send-keys", "-l", "/quit"]);
    // The first Enter may only pick the command in the slash popup.
    for _ in 0..2 {
        std::thread::sleep(Duration::from_millis(700));
        tmux(&socket, &["send-keys", "Enter"]);
    }
    wait_for(
        "session end",
        Duration::from_secs(20),
        || room.session().is_some_and(|s| s.attention == AttentionView::Offline),
        &diag,
    );
}
