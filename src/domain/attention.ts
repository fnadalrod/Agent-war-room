// Reglas de presentación puras sobre el read model. Sin React ni Tauri.
import type { AttentionView } from "./generated/AttentionView";
import type { SessionView } from "./generated/SessionView";
import type { WarRoomView } from "./generated/WarRoomView";

export type { AttentionView, SessionView, WarRoomView };
export type { RoomView } from "./generated/RoomView";
export type { SubagentView } from "./generated/SubagentView";
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

/** "claude-opus-5-5" → "opus-5-5". */
export function modelName(s: SessionView): string | null {
  return s.model?.replace(/^claude-/, "") ?? null;
}

/** 152340 → "152k". */
export function contextLabel(s: SessionView): string | null {
  if (s.context_tokens == null) return null;
  const k = s.context_tokens / 1000;
  return k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${Math.round(k)}k`;
}

/** Qué hace ahora: la acción detallada del transcript si hay, si no la etiqueta del hook. */
export function activity(s: SessionView): string {
  if (s.attention === "working" && s.last_action) return s.last_action;
  return s.status_label;
}

/** Cómo se llega a la sesión, para el tooltip del botón "Ir a". */
export function whereItLives(s: SessionView): string {
  if (s.in_warp) return "Warp (pane exacto)";
  if (s.tmux_pane) return `tmux ${s.tmux_pane}`;
  return s.terminal ?? "terminal desconocida";
}

/** Se puede escribir en ella desde la app (terminal propio o tmux). */
export function isWritable(s: SessionView): boolean {
  return s.alive && (s.pty_id != null || s.tmux_pane != null);
}

/** Carpeta donde abrir un agente nuevo en esta sala: el checkout principal si lo conocemos. */
export function roomHome(room: import("./generated/RoomView").RoomView): string | null {
  const main = room.sessions.find((s) => !s.is_linked_worktree) ?? room.sessions[0];
  return main?.worktree_path ?? null;
}
