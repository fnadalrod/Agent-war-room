//! Adaptador de entrada: commands que invoca el front.

use awr_application::WarRoomService;
use awr_application::ports::{FocusOutcome, IntegrationInstaller, LaunchOutcome, LaunchTarget, PortResult};
use awr_infrastructure::pty::{PtyInfo, PtyManager};
use awr_application::view::{IntegrationStatus, SessionDetail, WarRoomView};
use awr_domain::SessionId;
use std::sync::Arc;
use tauri::State;

type Service<'a> = State<'a, Arc<WarRoomService>>;
type Installer<'a> = State<'a, Arc<dyn IntegrationInstaller>>;
type Ptys<'a> = State<'a, Arc<PtyManager>>;

/// Resultado de lanzar un agente, para que la UI abra su terminal si es de la app.
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

/// Ejecuta un caso de uso con IO bloqueante (procesos, sockets) fuera del hilo de la UI.
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

/// Devuelve cómo se llegó ("kwin", "tmux + kwin", "warp") o falla con el motivo.
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

/// Salida acumulada del terminal en base64, para repintarlo al abrirlo.
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

/// Vista previa de una sesión con sus últimas entradas de conversación.
#[tauri::command]
pub async fn session_detail(
    service: State<'_, Arc<WarRoomService>>,
    id: String,
    limit: Option<usize>,
) -> Result<SessionDetail, String> {
    blocking(&service, move |s| s.session_detail(SessionId(id), limit.unwrap_or(60))).await
}

/// Abre un enlace (del Markdown de un agente) en el navegador del sistema. Solo http(s).
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("solo se abren enlaces http(s)".into());
    }
    awr_infrastructure::desktop::open_url(&url);
    Ok(())
}

/// Si la app arranca sola al iniciar sesión.
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
