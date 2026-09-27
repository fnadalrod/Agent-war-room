// Distribución de la sala en coordenadas lógicas (píxeles de arte). Puro: sin canvas ni React.
import type { AttentionView, RoomView, SessionView, WarRoomView } from "../../domain/attention";

export const WALL_H = 52;
export const DESK_W = 48;
export const DESK_H = 58;
export const BAY_PAD = 6;
export const BAY_LABEL_H = 11;
export const MARGIN = 8;
export const GAP = 8;

export type DeskSpot = { session: SessionView; x: number; y: number; w: number; h: number };
export type Bay = { room: RoomView; x: number; y: number; w: number; h: number; desks: DeskSpot[] };
export type Scene = { width: number; height: number; aggregate: AttentionView; bays: Bay[] };

/**
 * Coloca una bahía por repositorio, cada una con una rejilla de puestos, empaquetando bahías en
 * estanterías de izquierda a derecha. Respeta el orden del núcleo (lo más urgente primero).
 */
export function layoutScene(view: WarRoomView, width: number, showArchived: boolean): Scene {
  const usable = Math.max(DESK_W + 2 * BAY_PAD, width - 2 * MARGIN);
  const maxCols = Math.max(1, Math.floor((usable - 2 * BAY_PAD) / DESK_W));
  const bays: Bay[] = [];
  let x = MARGIN;
  let y = WALL_H + GAP;
  let shelfH = 0;

  for (const room of view.rooms) {
    const sessions = room.sessions.filter((s) => showArchived || !s.archived);
    if (sessions.length === 0) continue;
    const cols = Math.min(sessions.length, maxCols);
    const rows = Math.ceil(sessions.length / cols);
    const w = cols * DESK_W + 2 * BAY_PAD;
    const h = BAY_LABEL_H + rows * DESK_H + BAY_PAD;

    if (x > MARGIN && x + w > width - MARGIN) {
      x = MARGIN;
      y += shelfH + GAP;
      shelfH = 0;
    }
    const desks = sessions.map((session, i) => ({
      session,
      x: x + BAY_PAD + (i % cols) * DESK_W,
      y: y + BAY_LABEL_H + Math.floor(i / cols) * DESK_H,
      w: DESK_W,
      h: DESK_H,
    }));
    bays.push({ room, x, y, w, h, desks });
    x += w + GAP;
    shelfH = Math.max(shelfH, h);
  }

  return { width, height: Math.max(y + shelfH + MARGIN, WALL_H + 2 * GAP + DESK_H), aggregate: view.aggregate, bays };
}

export function hitTest(scene: Scene, x: number, y: number): SessionView | null {
  for (const bay of scene.bays) {
    for (const d of bay.desks) {
      if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d.session;
    }
  }
  return null;
}

/** Escala entera que da un ancho lógico razonable (unos 320–480 píxeles de arte). */
export function pixelScale(cssWidth: number): number {
  if (cssWidth >= 1600) return 4;
  if (cssWidth >= 900) return 3;
  return 2;
}
