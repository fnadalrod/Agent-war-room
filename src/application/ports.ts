import type { Filter, IntegrationStatus, SessionDetail, SubagentPreview, WarRoomView } from "../domain/attention";

export type Unsubscribe = () => void;

export type LaunchTarget = "app" | "warp";

/** `ptyId` presente si el agente se abrió en un terminal de la app. */
export type Launched = { pty_id: string | null; via: string };

/** Todo lo que el front necesita del núcleo. La implementación real habla con Tauri. */
export interface WarRoomGateway {
  load(): Promise<WarRoomView>;
  onChange(listener: (view: WarRoomView) => void): Promise<Unsubscribe>;
  markSeen(id: string): Promise<void>;
  markAllSeen(): Promise<void>;
  /** Salta a la ventana de la sesión. Resuelve con la vía usada; rechaza con el motivo. */
  focus(id: string): Promise<string>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
  mute(id: string): Promise<void>;
  unmute(id: string): Promise<void>;
  approve(id: string): Promise<void>;
  deny(id: string, message?: string): Promise<void>;
  sendInput(id: string, text: string): Promise<void>;
  launch(cwd: string, target: LaunchTarget): Promise<Launched>;
  resume(id: string, target: LaunchTarget): Promise<Launched>;
  /** Vista previa: tarjeta + conversación reciente. */
  detail(id: string): Promise<SessionDetail>;
  /** Vista previa de un subagente de la sesión. */
  subagentDetail(id: string, agent: string): Promise<SubagentPreview>;
  /** Abre un enlace en el navegador del sistema. */
  openExternal(url: string): Promise<void>;
  /** El núcleo pide abrir la vista previa de una sesión (p. ej. clic en un aviso). */
  onOpenRequest(listener: (id: string) => void): Promise<Unsubscribe>;
}

export type TerminalInfo = { id: string; label: string; cwd: string; alive: boolean };

/** Terminales propios de la app (PTY). */
export interface TerminalGateway {
  list(): Promise<TerminalInfo[]>;
  snapshot(id: string): Promise<Uint8Array>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  onOutput(listener: (id: string, data: Uint8Array) => void): Promise<Unsubscribe>;
  onExit(listener: (id: string) => void): Promise<Unsubscribe>;
}

export interface IntegrationGateway {
  status(): Promise<IntegrationStatus>;
  install(): Promise<IntegrationStatus>;
  uninstall(): Promise<IntegrationStatus>;
  /** Arrancar la app (oculta, en la bandeja) al iniciar sesión. */
  autostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<boolean>;
}

/** Dónde se recuerda el filtro entre arranques (en este equipo). */
export interface FilterStorage {
  load(): Filter | null;
  save(filter: Filter): void;
}
