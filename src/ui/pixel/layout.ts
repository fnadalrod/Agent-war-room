// Distribución de la sala en coordenadas lógicas (píxeles de arte). Puro: sin canvas ni React.
import type { AttentionView, RoomView, SessionView, SubagentView, WarRoomView } from "../../domain/attention";

export const WALL_H = 52;
export const DESK_W = 48;
export const DESK_H = 58;
export const BAY_PAD = 6;
export const BAY_LABEL_H = 11;
export const MARGIN = 8;
export const GAP = 8;

export const DRONE_W = 7;
export const DRONE_H = 6;
/** Huecos fijos alrededor del monitor (relativos al puesto): los drones se pueden pinchar. */
const DRONE_SLOTS: Array<[number, number]> = [
  [1, 3],
  [40, 13],
  [1, 11],
  [40, 20],
  [1, 19],
];

export type Drone = { agent: SubagentView; x: number; y: number; w: number; h: number };
export type DeskSpot = {
  session: SessionView;
  x: number;
  y: number;
  w: number;
  h: number;
  drones: Drone[];
  /** Subagentes que no caben en los huecos. */
  hiddenDrones: number;
};
export type Hit = { session: SessionView; agent: SubagentView | null };
export type Bay = { room: RoomView; x: number; y: number; w: number; h: number; desks: DeskSpot[] };
export type Scene = { width: number; height: number; aggregate: AttentionView; bays: Bay[] };

/**
 * Coloca una bahía por repositorio, cada una con una rejilla de puestos, empaquetando bahías en
 * estanterías de izquierda a derecha. Respeta el orden del núcleo (lo más urgente primero).
 */
export function layoutScene(view: WarRoomView, width: number, showArchived: boolean, minHeight = 0): Scene {
  const usable = Math.max(DESK_W + 2 * BAY_PAD, width - 2 * MARGIN);
  const maxCols = Math.max(1, Math.floor((usable - 2 * BAY_PAD) / DESK_W));
  const bays: Bay[] = [];
  const shelves: Bay[][] = [[]];
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
      shelves.push([]);
    }
    const desks = sessions.map((session, i) => {
      const dx = x + BAY_PAD + (i % cols) * DESK_W;
      const dy = y + BAY_LABEL_H + Math.floor(i / cols) * DESK_H;
      // El núcleo ya los ordena: primero los que trabajan.
      const drones = session.subagents.slice(0, DRONE_SLOTS.length).map((agent, n) => ({
        agent,
        x: dx + DRONE_SLOTS[n][0],
        y: dy + DRONE_SLOTS[n][1],
        w: DRONE_W,
        h: DRONE_H,
      }));
      return { session, x: dx, y: dy, w: DESK_W, h: DESK_H, drones, hiddenDrones: session.subagents.length - drones.length };
    });
    const bay = { room, x, y, w, h, desks };
    bays.push(bay);
    shelves[shelves.length - 1].push(bay);
    x += w + GAP;
    shelfH = Math.max(shelfH, h);
  }

  // Cada estantería, centrada: la sala se ve compuesta y no pegada a la izquierda.
  for (const shelf of shelves) {
    if (shelf.length === 0) continue;
    const last = shelf[shelf.length - 1];
    const shift = Math.floor((width - MARGIN - (last.x + last.w)) / 2);
    for (const bay of shelf) move(bay, shift, 0);
  }

  const content = Math.max(y + shelfH + MARGIN, WALL_H + 2 * GAP + DESK_H);
  const height = Math.max(content, Math.floor(minHeight));
  // Si sobra sala, el contenido se centra en el suelo en vez de quedarse pegado a la pared.
  const drop = bays.length > 0 ? Math.floor((height - content) / 2) : 0;
  for (const bay of bays) move(bay, 0, drop);
  return { width, height, aggregate: view.aggregate, bays };
}

function move(bay: Bay, dx: number, dy: number) {
  bay.x += dx;
  bay.y += dy;
  for (const d of bay.desks) {
    d.x += dx;
    d.y += dy;
    for (const drone of d.drones) {
      drone.x += dx;
      drone.y += dy;
    }
  }
}

const inside = (x: number, y: number, r: { x: number; y: number; w: number; h: number }, pad = 0) =>
  x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad;

/** Qué hay bajo el cursor: un drone (subagente) gana a su puesto. */
export function hitTest(scene: Scene, x: number, y: number): Hit | null {
  for (const bay of scene.bays) {
    for (const d of bay.desks) {
      if (!inside(x, y, d)) continue;
      const drone = d.drones.find((dr) => inside(x, y, dr, 1));
      return { session: d.session, agent: drone?.agent ?? null };
    }
  }
  return null;
}

/** Escala entera que da un ancho lógico razonable (unos 320–480 píxeles de arte). */
export function pixelScale(cssWidth: number): number {
  if (cssWidth >= 1600) return 4;
  if (cssWidth >= 760) return 3;
  return 2;
}
