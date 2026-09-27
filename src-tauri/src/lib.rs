//! Raíz de composición: construye los adaptadores, los conecta al servicio y arranca Tauri.

mod adapters;
mod commands;
mod tray;

use awr_application::{Ports, WarRoomService};
use awr_application::ports::IntegrationInstaller;
use awr_infrastructure::claude::{ClaudeHookInstaller, ClaudeProvider, ClaudeTranscriptReader};
use awr_infrastructure::desktop::DesktopNavigator;
use awr_infrastructure::git::GitRepoResolver;
use awr_infrastructure::sqlite::SqliteEventStore;
use awr_infrastructure::system::{ProcProbe, SystemClock};
use awr_infrastructure::ingress;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const TICK_EVERY: Duration = Duration::from_secs(5);
pub const MAIN_WINDOW: &str = "main";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_view,
            commands::mark_seen,
            commands::mark_all_seen,
            commands::focus,
            commands::archive,
            commands::unarchive,
            commands::mute,
            commands::unmute,
            commands::integration_status,
            commands::install_integration,
            commands::uninstall_integration,
        ])
        .setup(|app| {
            compose(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar la ventana no apaga la vigilancia: la app sigue en la bandeja.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar Agent War Room");
}

fn compose(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = dirs::data_dir().ok_or("sin directorio de datos")?.join("agent-war-room");
    let tray = tray::create(app)?;

    let service = Arc::new(WarRoomService::new(Ports {
        providers: vec![Arc::new(ClaudeProvider)],
        resolver: Arc::new(GitRepoResolver::new()),
        store: Arc::new(SqliteEventStore::open(&data_dir.join("events.db"))?),
        clock: Arc::new(SystemClock),
        probe: Arc::new(ProcProbe),
        notifier: Arc::new(adapters::DesktopNotifier::new(app.clone())),
        publisher: Arc::new(adapters::TauriPublisher::new(app.clone(), tray)),
        transcripts: Arc::new(ClaudeTranscriptReader::new()),
        navigator: Arc::new(DesktopNavigator::detect()),
    }));
    service.restore()?;
    app.manage(service.clone());

    let installer: Arc<dyn IntegrationInstaller> = Arc::new(ClaudeHookInstaller::new(
        dirs::home_dir().ok_or("sin HOME")?.join(".claude/settings.json"),
        built_bridge(),
        data_dir.join("bin/warroom-hook"),
    ));
    app.manage(installer);

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
            Err(e) => eprintln!("[ingress] no se pudo abrir el socket: {e}"),
        }
    });

    // Procesos muertos sin SessionEnd y transcripts de las sesiones en marcha.
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

/// El puente se compila en el mismo `target/` que la app (workspace), junto al ejecutable.
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
