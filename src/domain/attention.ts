// Reglas de presentación puras sobre el read model. Sin React ni Tauri.
import type { AttentionView } from "./generated/AttentionView";
import type { SessionView } from "./generated/SessionView";
import type { WarRoomView } from "./generated/WarRoomView";

export type { AttentionView, SessionView, WarRoomView };
export type { RoomView } from "./generated/RoomView";
export type { IntegrationStatus } from "./generated/IntegrationStatus";

export const ATTENTION_LABEL: Record<AttentionView, string> = {
  needs_you: "Te necesita",
  finished: "Terminado",
  working: "Trabajando",
  idle: "En espera",
  offline: "Sin conexión",
};

/** Las que cuentan para la bandeja y los avisos. */
export function isOnWatch(s: SessionView): boolean {
  return !s.archived && !s.muted;
}

export function countBy(view: WarRoomView, attention: AttentionView): number {
  return view.rooms
    .flatMap((r) => r.sessions)
    .filter((s) => isOnWatch(s) && s.attention === attention).length;
}

export function archivedCount(view: WarRoomView): number {
  return view.rooms.flatMap((r) => r.sessions).filter((s) => s.archived).length;
}

/** Nombre corto del puesto: la carpeta del worktree. */
export function deskName(s: SessionView): string {
  return s.worktree_path.split("/").filter(Boolean).pop() ?? s.worktree_path;
}

export function shortId(s: SessionView): string {
  return s.id.slice(0, 8);
}
