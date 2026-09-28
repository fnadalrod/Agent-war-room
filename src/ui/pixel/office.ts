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
/** Furniture, the spots in front of it, one row to mingle, and a margin. */
const LOUNGE_ROWS = 4;
/** From this many sessions in a repo, the closed ones go into a cabinet instead of keeping a desk. */
export const FOLD_AFTER = 4;

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Desk = {
  session: SessionView;
  /** Desk furniture, in pixels. */
  desk: Rect;
  /** Where its agent sits (tile). */
  seat: Point;
  /** A ring of tiles around the chair where running subagents stand, in walking order. */
  slots: Point[];
  /** Clickable area of the whole cell (pixels). */
  cell: Rect;
};

export type Zone = {
  room: RoomView;
  rect: Rect;
  desks: Desk[];
  /** Closed sessions kept in the cabinet, and where it stands (tile), if any. */
  folded: SessionView[];
  cabinet: Point | null;
};

export type Prop = { kind: "plant" | "sofa" | "coffee" | "cooler" | "shelf" | "table"; x: number; y: number };
/** A lounge spot, what the agent does there and where it looks. */
export type Spot = { tile: Point; pose: "stand" | "sit"; face: "down" | "up" | "left" | "right" };

/** Rows of the office one view shows (tiles). */
export type RoomBand = { y: number; h: number };
export type RoomName = "war" | "lobby";

export type Office = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** The war room on top, the lobby below its bottom wall; the scene shows one at a time. */
  bands: Record<RoomName, RoomBand>;
  /** The doorway between them: a tile of the war room's bottom wall (walkable down into the lobby). */
  lobbyDoor: Point;
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
 * Lays out the office for `width` logical pixels: the war room (repo zones packed in shelves under
 * the wall, keeping the core's order, most urgent first) and, through a door in its bottom wall, the
 * lobby with the crew lounge. Each fills at least `minHeight`.
 */
export function layoutOffice(view: WarRoomView, width: number, showArchived: boolean, minHeight = 0): Office {
  const cols = Math.max(CELL_W + 2, Math.floor(width / TILE));
  const maxCells = Math.max(1, Math.floor((cols - 2 - 1) / CELL_W));
  const zones: Zone[] = [];
  const shelves: Zone[][] = [[]];
  let x = 1;
  let y = WALL_ROWS + 1;
  let shelfH = 0;

  let idle = 0;
  for (const room of view.rooms) {
    const visible = room.sessions.filter((s) => showArchived || !s.archived);
    if (visible.length === 0) continue;
    // A busy repo keeps desks for what is alive; the closed ones go into a cabinet.
    const crowded = visible.length > FOLD_AFTER;
    const folded = crowded ? visible.filter((s) => s.attention === "offline" || s.archived) : [];
    const sessions = crowded ? visible.filter((s) => !folded.includes(s)) : visible;
    idle += sessions.filter((s) => s.attention === "idle" && !s.archived).length;
    const perRow = Math.max(1, Math.min(sessions.length, maxCells));
    const rowsOfCells = Math.ceil(sessions.length / perRow);
    const w = Math.max(perRow * CELL_W + 1, 5);
    const h = ZONE_LABEL_ROWS + Math.max(1, rowsOfCells * CELL_H);
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
    const zone = { room, rect: { x, y, w, h }, desks, folded, cabinet: folded.length ? { x: x + w - 2, y } : null };
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
  // The lounge grows a mingling row at a time until every idle agent has a place.
  const furnitureSpots = loungeCapacity(cols);
  const perMingleRow = Math.floor((cols - 4) / 3) * 2;
  const mingleRows = Math.max(1, Math.ceil(Math.max(0, idle - furnitureSpots) / Math.max(1, perMingleRow)));
  const loungeRows = LOUNGE_ROWS + mingleRows - 1;
  const minRows = Math.floor(minHeight / TILE);
  // The war room ends in a wall row; the lobby starts under it with its own wall.
  const war = { y: 0, h: Math.max(contentRows + 1, minRows) };
  // A free row under the lobby's wall, so the doorway always opens onto floor.
  const lobby = { y: war.h, h: Math.max(WALL_ROWS + 1 + loungeRows, minRows) };
  const rows = war.h + lobby.h;
  const loungeTop = lobby.y + WALL_ROWS + 1;
  const lounge = { x: 1, y: loungeTop, w: cols - 2, h: rows - 1 - loungeTop };
  const lobbyDoor = { x: Math.floor(cols / 2), y: war.h - 1 };

  const floorOf = (band: RoomBand, r: number) => r >= band.y + WALL_ROWS && r < band.y + band.h - 1;
  const walkable = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      // The doorway: through the war room's bottom wall and the lobby's wall.
      if (c === lobbyDoor.x && r >= lobbyDoor.y && r < lobby.y + WALL_ROWS) return true;
      return (r < war.h ? floorOf(war, r) : floorOf(lobby, r)) && c > 0 && c < cols - 1;
    }),
  );
  const block = (c: number, r: number) => {
    if (walkable[r]?.[c] !== undefined) walkable[r][c] = false;
  };
  for (const zone of zones) {
    for (const d of zone.desks) {
      const deskRow = d.seat.y - 1;
      for (let c = d.seat.x - 1; c <= d.seat.x + 1; c++) block(c, deskRow);
      // A chair is a goal, never a corridor: nobody walks through a seated agent.
      block(d.seat.x, d.seat.y);
    }
    if (zone.cabinet) block(zone.cabinet.x, zone.cabinet.y);
  }
  const { props, spots } = furnishLounge(lounge, block);
  spots.push(...mingleSpots(lounge, mingleRows));
  const door = { x: 1, y: WALL_ROWS };

  return {
    width: cols * TILE,
    height: rows * TILE,
    cols,
    rows,
    bands: { war, lobby },
    lobbyDoor,
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
    // A ring around the chair: left of it, the aisle corners (the name sits in between), right.
    slots: [
      { x: cx, y: cy + 1 },
      { x: cx, y: cy + 2 },
      { x: cx + 2, y: cy + 2 },
      { x: cx + 2, y: cy + 1 },
    ],
    cell: { x: cx * TILE, y: cy * TILE - 6, w: CELL_W * TILE, h: CELL_H * TILE + 6 },
  };
}

function moveZone(zone: Zone, dc: number, dr: number) {
  const px = (p: Point) => ({ x: p.x + dc, y: p.y + dr });
  const rx = (r: Rect, unit: number) => ({ ...r, x: r.x + dc * unit, y: r.y + dr * unit });
  zone.rect = rx(zone.rect, 1);
  if (zone.cabinet) zone.cabinet = px(zone.cabinet);
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
      if (kind === "sofa") spots.push({ tile: { x: c + k, y: back }, pose: "sit", face: "down" });
      else block(c + k, back);
    }
    if (kind === "coffee" || kind === "cooler" || kind === "shelf") {
      spots.push({ tile: { x: c, y: back + 1 }, pose: "stand", face: "up" });
    }
    c += w + (kind === "plant" ? 2 : 1);
    i++;
  }
  return { props, spots };
}

/** Spots the furniture row offers for `cols` columns (same walk as `furnishLounge`). */
function loungeCapacity(cols: number): number {
  const probe = { x: 1, y: 0, w: cols - 2, h: 1 };
  return furnishLounge(probe, () => {}).spots.length;
}

/** Pairs of agents chatting face to face, in the rows below the furniture. */
function mingleSpots(lounge: Rect, rows: number): Spot[] {
  const spots: Spot[] = [];
  for (let r = 0; r < rows; r++) {
    const y = lounge.y + 2 + r;
    for (let c = lounge.x + 1; c + 1 < lounge.x + lounge.w - 1; c += 3) {
      spots.push({ tile: { x: c, y }, pose: "stand", face: "right" }, { tile: { x: c + 1, y }, pose: "stand", face: "left" });
    }
  }
  return spots;
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

/** The zone whose cabinet of closed sessions is under a pixel. */
export function cabinetAtPoint(office: Office, p: Point): Zone | null {
  for (const zone of office.zones) {
    if (zone.cabinet && inside(p, { x: zone.cabinet.x * TILE, y: zone.cabinet.y * TILE - 8, w: TILE, h: TILE + 8 })) return zone;
  }
  return null;
}

/** The doorway between the rooms, as the view of `room` shows it (a click there switches rooms). */
export function doorwayAtPoint(office: Office, room: RoomName, p: Point): boolean {
  const x = office.lobbyDoor.x * TILE;
  const y = room === "war" ? office.lobbyDoor.y * TILE - TILE : office.bands.lobby.y * TILE;
  return inside(p, { x: x - 4, y, w: TILE + 8, h: room === "war" ? 2 * TILE : WALL_ROWS * TILE });
}

/** Integer scale giving a reasonable logical width (about 360–520 art pixels). */
export function pixelScale(cssWidth: number): number {
  if (cssWidth >= 1700) return 4;
  if (cssWidth >= 820) return 3;
  return 2;
}
