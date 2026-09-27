//! Adaptador de entrada: commands que invoca el front.

use awr_application::WarRoomService;
use awr_application::ports::{IntegrationInstaller, PortResult};
use awr_application::view::{IntegrationStatus, WarRoomView};
use awr_domain::SessionId;
use std::sync::Arc;
use tauri::State;

type Service<'a> = State<'a, Arc<WarRoomService>>;
type Installer<'a> = State<'a, Arc<dyn IntegrationInstaller>>;

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
