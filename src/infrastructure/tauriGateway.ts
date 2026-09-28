import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  IntegrationGateway,
  Launched,
  TerminalGateway,
  TerminalInfo,
  WarRoomGateway,
} from "../application/ports";
import type { IntegrationStatus, SessionDetail, WarRoomView } from "../domain/attention";

/** Deben coincidir con `adapters.rs` en src-tauri. */
const VIEW_EVENT = "warroom://view";
const PTY_OUTPUT_EVENT = "pty://output";
const PTY_EXIT_EVENT = "pty://exit";
const OPEN_DETAIL_EVENT = "warroom://open-detail";

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
  approve: (id) => invoke("approve", { id }),
  deny: (id, message) => invoke("deny", { id, message: message ?? null }),
  sendInput: (id, text) => invoke("send_input", { id, text }),
  launch: (cwd, target) => invoke<Launched>("launch", { cwd, target }),
  resume: (id, target) => invoke<Launched>("resume", { id, target }),
  detail: (id) => invoke<SessionDetail>("session_detail", { id, limit: 80 }),
  openExternal: (url) => invoke("open_external", { url }),
  onOpenRequest: (listener) => listen<string>(OPEN_DETAIL_EVENT, (e) => listener(e.payload)),
};

function fromBase64(data: string): Uint8Array {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export const tauriTerminalGateway: TerminalGateway = {
  list: () => invoke<TerminalInfo[]>("pty_list"),
  snapshot: async (id) => fromBase64(await invoke<string>("pty_snapshot", { id })),
  write: (id, data) => invoke("pty_write", { id, data }),
  resize: (id, cols, rows) => invoke("pty_resize", { id, cols, rows }),
  close: (id) => invoke("pty_close", { id }),
  onOutput: (listener) =>
    listen<{ id: string; data: string }>(PTY_OUTPUT_EVENT, (e) => listener(e.payload.id, fromBase64(e.payload.data))),
  onExit: (listener) => listen<string>(PTY_EXIT_EVENT, (e) => listener(e.payload)),
};

export const tauriIntegrationGateway: IntegrationGateway = {
  status: () => invoke<IntegrationStatus>("integration_status"),
  install: () => invoke<IntegrationStatus>("install_integration"),
  uninstall: () => invoke<IntegrationStatus>("uninstall_integration"),
  autostart: () => invoke<boolean>("autostart_enabled"),
  setAutostart: (enabled) => invoke<boolean>("set_autostart", { enabled }),
};
