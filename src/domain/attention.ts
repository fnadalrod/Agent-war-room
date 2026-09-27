// Reglas de presentación puras sobre el read model. Sin React ni Tauri.
import type { AttentionView } from "./generated/AttentionView";
import type { SessionView } from "./generated/SessionView";
import type { WarRoomView } from "./generated/WarRoomView";

export type { AttentionView, SessionView, WarRoomView };
export type { RoomView } from "./generated/RoomView";
export type { SubagentView } from "./generated/SubagentView";
export type { IntegrationStatus } from "./generated/IntegrationStatus";
export type { SessionDetail } from "./generated/SessionDetail";
export type { TimelineEntryView } from "./generated/TimelineEntryView";

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

/** La actividad, solo si dice algo más que el chip de estado ("Terminado" ya se ve en el chip). */
export function extraActivity(s: SessionView): string | null {
  const text = activity(s);
  return text === ATTENTION_LABEL[s.attention] ? null : text;
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

/** Texto plano de un Markdown, para extractos de una línea o tres. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "$1 —")
    .replace(/^\s{0,3}(>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, "$2")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Herramientas seguidas de la conversación, agrupadas: "Read ×3 · Bash · Edit". */
export function toolDigest(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const name = label.split(" · ")[0];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(" · ");
}
