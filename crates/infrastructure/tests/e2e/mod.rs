//! Shared harness for the end-to-end tests against real agents: a real service with its own socket
//! (`XDG_RUNTIME_DIR`), in-memory store and temp work folder, plus waiting and tmux helpers.
#![allow(dead_code)] // each test binary uses a different part

use awr_application::ports::*;
use awr_application::view::{AttentionView, SessionView, WarRoomView};
use awr_application::{AgentPorts, Ports, WarRoomService};
use awr_infrastructure::antigravity::{AntigravityProvider, AntigravityTranscriptReader};
use awr_infrastructure::claude::{ClaudeProvider, ClaudeTranscriptReader};
use awr_infrastructure::codex::{CodexProvider, CodexTranscriptReader};
use awr_infrastructure::cursor::{CursorProvider, CursorTranscriptReader};
use awr_infrastructure::git::{GitCli, GitRepoResolver};
use awr_infrastructure::ingress;
use awr_infrastructure::launch::{DesktopLauncher, TerminalInput};
use awr_infrastructure::pty::PtyManager;
use awr_infrastructure::skills::FsSkillCatalog;
use awr_infrastructure::sqlite::SqliteEventStore;
use awr_infrastructure::system::{ProcProbe, SystemClock};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct LastView(Mutex<Option<WarRoomView>>);
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

pub fn bridge() -> PathBuf {
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/warroom-hook");
    assert!(target.exists(), "build the bridge first: cargo build -p warroom-hook");
    target.canonicalize().unwrap()
}

/// Real service (every agent wired, like the app) with its own socket and a git work folder.
pub struct Room {
    work: tempfile::TempDir,
    pub runtime: PathBuf,
    _rt: tokio::runtime::Runtime,
    pub service: Arc<WarRoomService>,
    view: Arc<LastView>,
    pub pty: Arc<PtyManager>,
}

impl Room {
    pub fn start() -> Self {
        let work = tempfile::Builder::new().prefix("awr-e2e").tempdir_in("/tmp").unwrap();
        let dir = work.path();
        // Short paths: a Unix socket path cannot exceed 108 bytes.
        let runtime = dir.join("r");
        std::fs::create_dir_all(&runtime).unwrap();
        Command::new("git").arg("-C").arg(dir).args(["init", "-q"]).status().unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let view = Arc::new(LastView::default());
        let pty = PtyManager::new(Arc::new(|_| {}));
        let home = dir.join("home");
        let service = Arc::new(WarRoomService::new(Ports {
            agents: vec![
                AgentPorts {
                    provider: Arc::new(ClaudeProvider),
                    transcripts: Arc::new(ClaudeTranscriptReader::new()),
                    skills: Arc::new(FsSkillCatalog::claude(&home)),
                },
                AgentPorts {
                    provider: Arc::new(CodexProvider),
                    transcripts: Arc::new(CodexTranscriptReader::new()),
                    skills: Arc::new(FsSkillCatalog::codex(&home, home.join(".codex"))),
                },
                AgentPorts {
                    provider: Arc::new(CursorProvider),
                    transcripts: Arc::new(CursorTranscriptReader::new()),
                    skills: Arc::new(FsSkillCatalog::cursor(&home)),
                },
                AgentPorts {
                    provider: Arc::new(AntigravityProvider::new(home.join(".gemini/antigravity/brain"))),
                    transcripts: Arc::new(AntigravityTranscriptReader::new()),
                    skills: Arc::new(FsSkillCatalog::antigravity(&home)),
                },
            ],
            resolver: Arc::new(GitRepoResolver::new()),
            store: Arc::new(SqliteEventStore::in_memory().unwrap()),
            clock: Arc::new(SystemClock),
            probe: Arc::new(ProcProbe),
            notifier: Arc::new(Quiet),
            publisher: view.clone(),
            navigator: Arc::new(NoWindows),
            launcher: Arc::new(DesktopLauncher::new(pty.clone(), dir.join("warp"))),
            input: Arc::new(TerminalInput::new(pty.clone())),
            git: Arc::new(GitCli),
        }));
        let listener = rt.block_on(ingress::bind(&runtime.join("agent-war-room/ingress.sock"))).unwrap();
        let ingest = service.clone();
        rt.spawn(ingress::serve(listener, Arc::new(move |s| ingest.ingest(s).unwrap())));

        Self { work, runtime, _rt: rt, service, view, pty }
    }

    pub fn dir(&self) -> &Path {
        self.work.path()
    }

    pub fn session(&self) -> Option<SessionView> {
        self.view.0.lock().unwrap().clone()?.rooms.first()?.sessions.first().cloned()
    }

    pub fn diag(&self, screen: &dyn Fn() -> String) -> String {
        format!("--- screen ---\n{}\n--- view ---\n{:#?}", screen(), self.view.0.lock().unwrap())
    }
}

pub fn wait_for(what: &str, timeout: Duration, mut check: impl FnMut() -> bool, diag: &dyn Fn() -> String) {
    let start = Instant::now();
    while !check() {
        assert!(start.elapsed() < timeout, "timed out waiting for: {what}\n{}", diag());
        std::thread::sleep(Duration::from_millis(300));
    }
}

pub fn is_busy(s: &SessionView) -> bool {
    matches!(s.attention, AttentionView::Working | AttentionView::NeedsYou)
}

pub fn tmux(socket: &Path, args: &[&str]) -> String {
    let out = Command::new("tmux").arg("-S").arg(socket).args(args).output().unwrap();
    String::from_utf8_lossy(&out.stdout).into_owned()
}
