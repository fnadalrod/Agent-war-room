//! Composition root: builds the adapters, wires them into the service and starts Tauri.

mod adapters;
mod commands;
mod locale;
mod tray;

use awr_application::ports::IntegrationInstaller;
use awr_application::{Ports, WarRoomService};
use awr_infrastructure::claude::{ClaudeHookInstaller, ClaudeProvider, ClaudeTranscriptReader, FsSkillCatalog};
use awr_infrastructure::desktop::DesktopNavigator;
use awr_infrastructure::git::{GitCli, GitRepoResolver};
use awr_infrastructure::ingress;
use awr_infrastructure::launch::{DesktopLauncher, TerminalInput};
use awr_infrastructure::pty::PtyManager;
use awr_infrastructure::sqlite::SqliteEventStore;
use awr_infrastructure::system::{ProcProbe, SystemClock};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const TICK_EVERY: Duration = Duration::from_secs(5);
pub const MAIN_WINDOW: &str = "main";
/// Autostart on login: straight to the tray, no window.
const HIDDEN_FLAG: &str = "--hidden";
/// `agent-war-room --next` (bind it to a global shortcut): jump to what has waited longest.
const NEXT_FLAG: &str = "--next";
pub const OPEN_DETAIL_EVENT: &str = "warroom://open-detail";

/// Payload of [`OPEN_DETAIL_EVENT`]: which session, and whether to focus its message box.
#[derive(Clone, serde::Serialize)]
struct OpenDetail {
    id: String,
    reply: bool,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _| {
            if argv.iter().any(|a| a == NEXT_FLAG) {
                go_next(app);
            } else {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_FLAG]),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::ui_language,
            commands::get_view,
            commands::session_detail,
            commands::subagent_detail,
            commands::open_external,
            commands::mark_seen,
            commands::mark_all_seen,
            commands::focus,
            commands::focus_next,
            commands::session_changes,
            commands::commit_diff,
            commands::approve,
            commands::deny,
            commands::send_input,
            commands::launch,
            commands::resume,
            commands::pty_list,
            commands::pty_snapshot,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::archive,
            commands::unarchive,
            commands::mute,
            commands::unmute,
            commands::integration_status,
            commands::install_integration,
            commands::uninstall_integration,
            commands::autostart_enabled,
            commands::set_autostart,
        ])
        .setup(|app| {
            compose(app.handle())?;
            if std::env::args().any(|a| a == HIDDEN_FLAG || a == NEXT_FLAG)
                && let Some(window) = app.get_webview_window(MAIN_WINDOW)
            {
                let _ = window.hide();
            }
            if std::env::args().any(|a| a == NEXT_FLAG) {
                go_next(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window does not stop monitoring: the app stays in the tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start Agent War Room");
}

fn compose(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = dirs::data_dir().ok_or("no data directory")?.join("agent-war-room");
    let tray = tray::create(app)?;
    let (notice_actions, picked) = std::sync::mpsc::channel();
    let pty = PtyManager::new(adapters::pty_sink(app.clone()));
    app.manage(pty.clone());
    let warp_tab_configs = dirs::data_dir().ok_or("no data directory")?.join("warp-terminal/tab_configs");

    let service = Arc::new(WarRoomService::new(Ports {
        providers: vec![Arc::new(ClaudeProvider)],
        resolver: Arc::new(GitRepoResolver::new()),
        store: Arc::new(SqliteEventStore::open(&data_dir.join("events.db"))?),
        clock: Arc::new(SystemClock),
        probe: Arc::new(ProcProbe),
        notifier: Arc::new(adapters::DesktopNotifier::new(notice_actions)),
        publisher: Arc::new(adapters::TauriPublisher::new(app.clone(), tray)),
        transcripts: Arc::new(ClaudeTranscriptReader::new()),
        navigator: Arc::new(DesktopNavigator::detect()),
        launcher: Arc::new(DesktopLauncher::new(pty.clone(), warp_tab_configs)),
        input: Arc::new(TerminalInput::new(pty)),
        skills: Arc::new(FsSkillCatalog::new(dirs::home_dir().ok_or("no HOME directory")?.join(".claude"))),
        git: Arc::new(GitCli),
    }));
    service.restore()?;
    app.manage(service.clone());
    // First full transcript reads (token totals) can take a while: off the startup path.
    let reader = service.clone();
    std::thread::spawn(move || reader.refresh_all_summaries());

    let installer: Arc<dyn IntegrationInstaller> = Arc::new(ClaudeHookInstaller::new(
        dirs::home_dir().ok_or("no HOME directory")?.join(".claude/settings.json"),
        built_bridge(),
        data_dir.join("bin/warroom-hook"),
    ));
    app.manage(installer);

    // Notification buttons.
    let (on_notice, handle) = (service.clone(), app.clone());
    std::thread::spawn(move || {
        use adapters::NoticeAction;
        for action in picked {
            let outcome = match action {
                NoticeAction::Open(id) => open_detail(&handle, id.0, false),
                NoticeAction::Reply(id) => open_detail(&handle, id.0, true),
                NoticeAction::Focus(id) => on_notice.focus(id).map(drop).map_err(|e| e.to_string()),
                NoticeAction::Approve(id) => on_notice.approve(id).map_err(|e| e.to_string()),
            };
            if let Err(e) = outcome {
                eprintln!("[notices] {e}");
            }
        }
    });

    let ingest = service.clone();
    tauri::async_runtime::spawn(async move {
        match ingress::bind(&ingress::default_socket_path()).await {
            Ok(listener) => {
                ingress::serve(
                    listener,
                    Arc::new(move |signal| {
                        if let Err(e) = ingest.ingest(signal) {
                            eprintln!("[ingest] {e}");
                        }
                    }),
                )
                .await
            }
            Err(e) => eprintln!("[ingress] could not open the socket: {e}"),
        }
    });

    // Dead processes without SessionEnd, and transcripts of running sessions.
    let ticker = service;
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(TICK_EVERY);
        loop {
            tick.tick().await;
            let svc = ticker.clone();
            let _ = tokio::task::spawn_blocking(move || svc.tick()).await;
        }
    });

    Ok(())
}

/// Shows the window with a session's preview; `reply` puts the cursor in its message box.
fn open_detail(app: &AppHandle, id: String, reply: bool) -> Result<(), String> {
    use tauri::Emitter;
    show_main(app);
    app.emit(OPEN_DETAIL_EVENT, OpenDetail { id, reply }).map_err(|e| e.to_string())
}

/// Jumps to the session that has waited longest. If its window can't be reached, shows its
/// preview instead; if nothing waits, just shows the war room.
pub fn go_next(app: &AppHandle) {
    let Some(service) = app.try_state::<Arc<WarRoomService>>().map(|s| s.inner().clone()) else { return };
    let app = app.clone();
    std::thread::spawn(move || match service.focus_next() {
        Ok(Some((_, awr_application::ports::FocusOutcome::Focused { .. }))) => {}
        Ok(Some((id, _))) => {
            let _ = open_detail(&app, id.0, false);
        }
        Ok(None) => show_main(&app),
        Err(e) => eprintln!("[next] {e}"),
    });
}

/// The bridge is built into the same `target/` as the app (workspace), next to the executable.
fn built_bridge() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|dir| dir.join("warroom-hook"))
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
