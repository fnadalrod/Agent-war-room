import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { IntegrationGateway, WarRoomGateway } from "../application/ports";
import type { IntegrationStatus, WarRoomView } from "../domain/attention";

/** Debe coincidir con `adapters::VIEW_EVENT` en src-tauri. */
const VIEW_EVENT = "warroom://view";

export const tauriWarRoomGateway: WarRoomGateway = {
  load: () => invoke<WarRoomView>("get_view"),
  onChange: (listener) => listen<WarRoomView>(VIEW_EVENT, (e) => listener(e.payload)),
  markSeen: (id) => invoke("mark_seen", { id }),
  markAllSeen: () => invoke("mark_all_seen"),
  focus: (id) => invoke<string>("focus", { id }),
  archive: (id) => invoke("archive", { id }),
  unarchive: (id) => invoke("unarchive", { id }),
  mute: (id) => invoke("mute", { id }),
  unmute: (id) => invoke("unmute", { id }),
};

export const tauriIntegrationGateway: IntegrationGateway = {
  status: () => invoke<IntegrationStatus>("integration_status"),
  install: () => invoke<IntegrationStatus>("install_integration"),
  uninstall: () => invoke<IntegrationStatus>("uninstall_integration"),
};
