// The office in tiles: walls, one zone per repo with its desks, a lounge, a door, and which tiles can
// be walked. Pure: no canvas, no React. Coordinates are logical (art) pixels; TILE px per tile.
import type { AttentionView, RoomView, SessionView, SubagentView, WarRoomView } from "../../domain/attention";

export const TILE = 16;
/** Wall rows at the top (windows, board, door). */
export const WALL_ROWS = 3;
/** A desk cell: desk row, seat row, aisle row; three tiles wide. */
const CELL_W = 3;
const CELL_H = 3;
/** Label row on top of each zone. */
const ZONE_LABEL_ROWS = 1;
const LOUNGE_ROWS = 4;

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Desk = {
  session: SessionView;
  /** Desk furniture, in pixels. */
  desk: Rect;
  /** Where its agent sits (tile). */
  seat: Point;
  /** Around the chair, for subagents (tiles). */
  slots: Point[];
  /** Clickable area of the whole cell (pixels). */
  cell: Rect;
};

export type Zone = { room: RoomView; rect: Rect; desks: Desk[] };

export type Prop = { kind: "plant" | "sofa" | "coffee" | "cooler" | "shelf" | "table"; x: number; y: number };
/** A lounge spot and what the agent does there. */
export type Spot = { tile: Point; pose: "stand" | "sit" };

export type Office = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  aggregate: AttentionView;
  zones: Zone[];
  lounge: Rect;
  props: Prop[];
  spots: Spot[];
  door: Point;
  /** `walkable[row][col]`. */
  walkable: boolean[][];
};

/**
 * Lays out the office for `width` logical pixels: repo zones packed in shelves under the wall
 * (keeping the core's order, most urgent first), then a lounge along the bottom.
 */
export function layoutOffice(view: WarRoomView, width: number, showArchived: boolean, minHeight = 0): Office {
  const cols = Math.max(CELL_W + 2, Math.floor(width / TILE));
  const maxCells = Math.max(1, Math.floor((cols - 2 - 1) / CELL_W));
  const zones: Zone[] = [];
  const shelves: Zone[][] = [[]];
  let x = 1;
  let y = WALL_ROWS + 1;
  let shelfH = 0;

  for (const room of view.rooms) {
    const sessions = room.sessions.filter((s) => showArchived || !s.archived);
    if (sessions.length === 0) continue;
    const perRow = Math.min(sessions.length, maxCells);
    const rowsOfCells = Math.ceil(sessions.length / perRow);
    const w = perRow * CELL_W + 1;
    const h = ZONE_LABEL_ROWS + rowsOfCells * CELL_H;
    if (x > 1 && x + w > cols - 1) {
      x = 1;
      y += shelfH + 1;
      shelfH = 0;
      shelves.push([]);
    }
    const desks = sessions.map((session, i) => {
      const cx = x + 1 + (i % perRow) * CELL_W;
      const cy = y + ZONE_LABEL_ROWS + Math.floor(i / perRow) * CELL_H;
      return deskAt(session, cx, cy);
    });
    const zone = { room, rect: { x, y, w, h }, desks };
    zones.push(zone);
    shelves[shelves.length - 1].push(zone);
    x += w + 1;
    shelfH = Math.max(shelfH, h);
  }

  // Center each shelf (whole tiles) so the floor looks composed.
  for (const shelf of shelves) {
    if (shelf.length === 0) continue;
    const last = shelf[shelf.length - 1];
    const shift = Math.floor((cols - 1 - (last.rect.x + last.rect.w)) / 2);
    for (const zone of shelf) moveZone(zone, shift, 0);
  }

  const contentRows = (zones.length ? y + shelfH : WALL_ROWS + 1 + CELL_H) + 1;
  const rows = Math.max(contentRows + LOUNGE_ROWS, Math.floor(minHeight / TILE));
  const lounge = { x: 1, y: rows - LOUNGE_ROWS, w: cols - 2, h: LOUNGE_ROWS - 1 };

  const walkable = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => r >= WALL_ROWS && r < rows - 1 && c > 0 && c < cols - 1),
  );
  const block = (c: number, r: number) => {
    if (walkable[r]?.[c] !== undefined) walkable[r][c] = false;
  };
  for (const zone of zones) {
    for (const d of zone.desks) {
      const deskRow = d.seat.y - 1;
      for (let c = d.seat.x - 1; c <= d.seat.x + 1; c++) block(c, deskRow);
    }
  }
  const { props, spots } = furnishLounge(lounge, block);
  const door = { x: 1, y: WALL_ROWS };

  return {
    width: cols * TILE,
    height: rows * TILE,
    cols,
    rows,
    aggregate: view.aggregate,
    zones,
    lounge,
    props,
    spots,
    door,
    walkable,
  };
}

function deskAt(session: SessionView, cx: number, cy: number): Desk {
  const seat = { x: cx + 1, y: cy + 1 };
  return {
    session,
    desk: { x: cx * TILE + 6, y: cy * TILE + 2, w: 3 * TILE - 12, h: TILE - 2 },
    seat,
    // Left and right of the chair, then the aisle corners (the name sits in the middle).
    slots: [
      { x: cx, y: cy + 1 },
      { x: cx + 2, y: cy + 1 },
      { x: cx, y: cy + 2 },
      { x: cx + 2, y: cy + 2 },
    ],
    cell: { x: cx * TILE, y: cy * TILE - 6, w: CELL_W * TILE, h: CELL_H * TILE + 6 },
  };
}

function moveZone(zone: Zone, dc: number, dr: number) {
  const px = (p: Point) => ({ x: p.x + dc, y: p.y + dr });
  const rx = (r: Rect, unit: number) => ({ ...r, x: r.x + dc * unit, y: r.y + dr * unit });
  zone.rect = rx(zone.rect, 1);
  for (const d of zone.desks) {
    d.seat = px(d.seat);
    d.slots = d.slots.map(px);
    d.desk = rx(d.desk, TILE);
    d.cell = rx(d.cell, TILE);
  }
}

/** Sofas, plants, coffee and water along the lounge's top row; the tiles in front are the spots. */
function furnishLounge(lounge: Rect, block: (c: number, r: number) => void): { props: Prop[]; spots: Spot[] } {
  const props: Prop[] = [];
  const spots: Spot[] = [];
  const back = lounge.y;
  const pattern: Array<Prop["kind"]> = ["plant", "sofa", "table", "sofa", "coffee", "cooler", "shelf", "plant"];
  let c = lounge.x + 1;
  let i = 0;
  while (c < lounge.x + lounge.w - 1) {
    const kind = pattern[i % pattern.length];
    const w = kind === "sofa" ? 2 : 1;
    if (c + w > lounge.x + lounge.w - 1) break;
    props.push({ kind, x: c, y: back });
    for (let k = 0; k < w; k++) {
      if (kind === "sofa") spots.push({ tile: { x: c + k, y: back }, pose: "sit" });
      else block(c + k, back);
    }
    if (kind === "coffee" || kind === "cooler" || kind === "shelf") spots.push({ tile: { x: c, y: back + 1 }, pose: "stand" });
    c += w + (kind === "plant" ? 2 : 1);
    i++;
  }
  return { props, spots };
}

/** Tile under a pixel. */
export const tileOf = (p: Point): Point => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
/** Center of a tile, feet position (a bit low in the tile). */
export const feetOf = (t: Point): Point => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE - 3 });

/** Shortest 4-way path between tiles over walkable ones (the goal itself may be a seat). */
export function findPath(office: Office, from: Point, to: Point): Point[] {
  const key = (p: Point) => p.y * office.cols + p.x;
  const open = (p: Point) => (p.x === to.x && p.y === to.y) || office.walkable[p.y]?.[p.x] === true;
  const prev = new Map<number, number>([[key(from), -1]]);
  const queue: Point[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.x === to.x && cur.y === to.y) break;
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]) {
      const next = { x: cur.x + dx, y: cur.y + dy };
      if (prev.has(key(next)) || !open(next)) continue;
      prev.set(key(next), key(cur));
      queue.push(next);
    }
  }
  if (!prev.has(key(to))) return [];
  const path: Point[] = [];
  for (let k = key(to); k !== key(from) && k !== -1; k = prev.get(k)!) {
    path.push({ x: k % office.cols, y: Math.floor(k / office.cols) });
  }
  return path.reverse();
}

export type Hit = { session: SessionView; agent: SubagentView | null };

const inside = (p: Point, r: Rect) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/** Desk cell under a pixel (characters are hit-tested by the scene, where they are). */
export function deskAtPoint(office: Office, p: Point): Desk | null {
  for (const zone of office.zones) for (const d of zone.desks) if (inside(p, d.cell)) return d;
  return null;
}

/** Integer scale giving a reasonable logical width (about 360–520 art pixels). */
export function pixelScale(cssWidth: number): number {
  if (cssWidth >= 1700) return 4;
  if (cssWidth >= 820) return 3;
  return 2;
}
