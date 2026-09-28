//! Inbound adapter: commands invoked by the front end.

use crate::locale;
use awr_application::WarRoomService;
use awr_application::ports::{FocusOutcome, IntegrationInstaller, LaunchOutcome, LaunchTarget, PortResult};
use awr_application::view::{IntegrationStatus, SessionChanges, SessionDetail, SubagentPreview, WarRoomView};
use awr_domain::SessionId;
use awr_infrastructure::pty::{PtyInfo, PtyManager};
use std::sync::Arc;
use tauri::State;

type Service<'a> = State<'a, Arc<WarRoomService>>;
type Installer<'a> = State<'a, Arc<dyn IntegrationInstaller>>;
type Ptys<'a> = State<'a, Arc<PtyManager>>;

/// Result of launching an agent, so the UI can open its terminal if it is an app terminal.
#[derive(serde::Serialize)]
pub struct Launched {
    pty_id: Option<String>,
    via: String,
}

impl From<LaunchOutcome> for Launched {
    fn from(outcome: LaunchOutcome) -> Self {
        match outcome {
            LaunchOutcome::AppTerminal { pty_id } => Self { pty_id: Some(pty_id), via: "app".into() },
            LaunchOutcome::External { via } => Self { pty_id: None, via },
        }
    }
}

/// Runs a use case with blocking IO (processes, sockets) off the UI thread.
async fn blocking<T: Send + 'static>(
    service: &State<'_, Arc<WarRoomService>>,
    work: impl FnOnce(&WarRoomService) -> PortResult<T> + Send + 'static,
) -> Result<T, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || work(&service))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn done(result: PortResult<()>) -> Result<(), String> {
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_view(service: Service) -> WarRoomView {
    service.view()
}

#[tauri::command]
pub fn mark_seen(service: Service, id: String) -> Result<(), String> {
    done(service.mark_seen(SessionId(id)))
}

#[tauri::command]
pub fn mark_all_seen(service: Service) -> Result<(), String> {
    done(service.mark_all_seen())
}

/// Returns how the window was reached ("kwin", "tmux + kwin", "warp") or fails with the reason.
#[tauri::command]
pub async fn focus(service: State<'_, Arc<WarRoomService>>, id: String) -> Result<String, String> {
    match blocking(&service, move |s| s.focus(SessionId(id))).await? {
        FocusOutcome::Focused { via } => Ok(via),
        FocusOutcome::Unreachable { reason } => Err(reason),
    }
}

#[tauri::command]
pub fn archive(service: Service, id: String) -> Result<(), String> {
    done(service.archive(SessionId(id)))
}

#[tauri::command]
pub fn unarchive(service: Service, id: String) -> Result<(), String> {
    done(service.unarchive(SessionId(id)))
}

#[tauri::command]
pub fn mute(service: Service, id: String) -> Result<(), String> {
    done(service.mute(SessionId(id)))
}

#[tauri::command]
pub fn unmute(service: Service, id: String) -> Result<(), String> {
    done(service.unmute(SessionId(id)))
}

#[tauri::command]
pub fn integration_status(installer: Installer) -> Result<IntegrationStatus, String> {
    installer.status().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn install_integration(installer: Installer) -> Result<IntegrationStatus, String> {
    installer.install().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn uninstall_integration(installer: Installer) -> Result<IntegrationStatus, String> {
    installer.uninstall().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn approve(service: State<'_, Arc<WarRoomService>>, id: String) -> Result<(), String> {
    blocking(&service, move |s| s.approve(SessionId(id))).await
}

#[tauri::command]
pub async fn deny(service: State<'_, Arc<WarRoomService>>, id: String, message: Option<String>) -> Result<(), String> {
    blocking(&service, move |s| s.deny(SessionId(id), message)).await
}

#[tauri::command]
pub async fn send_input(service: State<'_, Arc<WarRoomService>>, id: String, text: String) -> Result<(), String> {
    blocking(&service, move |s| s.send_input(SessionId(id), &text)).await
}

#[tauri::command]
pub async fn launch(
    service: State<'_, Arc<WarRoomService>>,
    cwd: String,
    target: LaunchTarget,
) -> Result<Launched, String> {
    blocking(&service, move |s| s.launch(cwd, target)).await.map(Launched::from)
}

#[tauri::command]
pub async fn resume(
    service: State<'_, Arc<WarRoomService>>,
    id: String,
    target: LaunchTarget,
) -> Result<Launched, String> {
    blocking(&service, move |s| s.resume(SessionId(id), target)).await.map(Launched::from)
}

#[tauri::command]
pub fn pty_list(ptys: Ptys) -> Vec<PtyInfo> {
    ptys.list()
}

/// The terminal's accumulated output in base64, to repaint it when opened.
#[tauri::command]
pub fn pty_snapshot(ptys: Ptys, id: String) -> Result<String, String> {
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(ptys.snapshot(&id)?))
}

#[tauri::command]
pub fn pty_write(ptys: Ptys, id: String, data: String) -> Result<(), String> {
    ptys.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(ptys: Ptys, id: String, cols: u16, rows: u16) -> Result<(), String> {
    ptys.resize(&id, cols, rows)
}

#[tauri::command]
pub fn pty_close(ptys: Ptys, id: String) -> Result<(), String> {
    ptys.close(&id)
}

/// Preview of a session with its latest conversation entries.
#[tauri::command]
pub async fn session_detail(
    service: State<'_, Arc<WarRoomService>>,
    id: String,
    limit: Option<usize>,
) -> Result<SessionDetail, String> {
    blocking(&service, move |s| s.session_detail(SessionId(id), limit.unwrap_or(60))).await
}

/// Opens a link (from an agent's Markdown) in the system browser. http(s) only.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(locale::ONLY_HTTP_LINKS.into());
    }
    awr_infrastructure::desktop::open_url(&url);
    Ok(())
}

/// Whether the app starts automatically on login.
#[tauri::command]
pub fn autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if enabled { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())?;
    launcher.is_enabled().map_err(|e| e.to_string())
}

/// Preview of a subagent.
#[tauri::command]
pub async fn subagent_detail(
    service: State<'_, Arc<WarRoomService>>,
    id: String,
    agent: String,
) -> Result<SubagentPreview, String> {
    blocking(&service, move |s| s.subagent_detail(SessionId(id), &agent, 80)).await
}

/// Jumps to the session that has waited longest. Returns its id, or `None` if nothing waits.
#[tauri::command]
pub async fn focus_next(service: State<'_, Arc<WarRoomService>>) -> Result<Option<String>, String> {
    blocking(&service, |s| s.focus_next()).await.map(|next| next.map(|(id, _)| id.0))
}

/// Files the session edited and commits in its worktree since it started. On demand.
#[tauri::command]
pub async fn session_changes(service: State<'_, Arc<WarRoomService>>, id: String) -> Result<SessionChanges, String> {
    blocking(&service, move |s| s.session_changes(SessionId(id))).await
}

/// `git show` of one of those commits.
#[tauri::command]
pub async fn commit_diff(service: State<'_, Arc<WarRoomService>>, id: String, hash: String) -> Result<String, String> {
    blocking(&service, move |s| s.commit_diff(SessionId(id), &hash)).await
}
