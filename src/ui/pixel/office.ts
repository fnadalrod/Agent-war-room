// The office in tiles: walls, one zone per repo with its desks, a lounge, a door, and which tiles can
// be walked. Pure: no canvas, no React. Coordinates are logical (art) pixels; TILE px per tile.
import type { AttentionView, RoomView, SessionView, SubagentView, WarRoomView } from "../../domain/attention";

export const TILE = 16;
/** Wall rows at the top (windows, board, door). */
export const WALL_ROWS = 3;
/** The command wall is taller than the lobby wall, with room for the tactical display. */
export const WAR_WALL_ROWS = 5;
/** A desk cell: desk row, seat row, aisle row; three tiles wide. */
const CELL_W = 3;
const CELL_H = 3;
/** Rows between tiers of consoles: a cell, the names under it and the aisle with the next tier's signs. */
const RING_GAP = 5;
/** The shortest war room: its wall, one tier and the bottom wall. */
const MIN_WAR_ROWS = WAR_WALL_ROWS + 6;
/** One row of seating nooks, circulation and a margin; a taller lobby fits more rows of nooks. */
const LOUNGE_ROWS = 7;
/** How long a repo keeps its deck after its last session closed. */
export const LINGER_MS = 15 * 60_000;
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
  /** The two tiles beside the chair where its running subagents stand (more show as "+N"). */
  slots: Point[];
  /** Clickable area of the whole cell (pixels). */
  cell: Rect;
};

export type Zone = {
  room: RoomView;
  /** Bounding box of its consoles (tiles); they follow a tier's curve, so it may take in others' too. */
  rect: Rect;
  /** Its consoles' cells (pixels), one run per tier it takes (from the screen out), left to right. */
  segments: Rect[][];
  desks: Desk[];
  /** Cells of free consoles (pixels, like `Desk.cell`): a spare, so a new session does not reshape the deck. */
  spares: Rect[];
  /** Closed sessions kept in the cabinet, and where it stands (tile), if any. */
  folded: SessionView[];
  cabinet: Point | null;
};

export type Prop = { premium?: boolean; kind: "plant" | "sofa" | "coffee" | "cooler" | "shelf" | "table" | "lamp" | "arcade"; x: number; y: number };
/** A lounge spot, what the agent does there and where it looks. */
export type Spot = { tile: Point; pose: "stand" | "sit"; face: "down" | "up" | "left" | "right" };

/** Rows of the office one view shows (tiles). */
export type RoomBand = { y: number; h: number };
export type RoomName = "war" | "lobby";

export type LoungeRoom = { rect: Rect; spots: Spot[]; conversations: Spot[]; premium: boolean };

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
  /** Cells of the consoles nobody has: dark until a session lights one. */
  dark: Rect[];
  /** The tiers the consoles stand on. */
  arena: Arena;
  lounge: Rect;
  props: Prop[];
  spots: Spot[];
  door: Point;
  /** Facing pairs reserved for conversations in the lobby. */
  conversations: Spot[];
  lounges: { team: LoungeRoom; principals: LoungeRoom };
  /** `walkable[row][col]`. */
  walkable: boolean[][];
};

/**
 * Lays out the office for `width` logical pixels: the war room (tiers of consoles curving round
 * the screen wall; each repo a run of neighbouring consoles along a tier, in a stable order: repos
 * by name, desks by when their session started) and, through a door in its bottom wall, the lobby with the crew lounge.
 * Each fills at least `minHeight`. `now` (ms) keeps a repo whose last session closed less than
 * `LINGER_MS` ago on the floor.
 */
export function layoutOffice(view: WarRoomView, width: number, showArchived: boolean, minHeight = 0, now = 0): Office {
  const cols = Math.max(4 * CELL_W, Math.floor(width / TILE));
  type Plan = { room: RoomView; sessions: SessionView[]; folded: SessionView[]; consoles: number };
  const plans: Plan[] = [];

  let idle = 0;
  // The core sorts by urgency, which changes all the time; a seat must not, or agents would get up
  // and swap consoles whenever one of them needs you.
  for (const room of [...view.rooms].sort(byRepo)) {
    const visible = room.sessions.filter((s) => showArchived || !s.archived).sort(bySeat);
    // A repo leaves the floor once nothing in it is alive, but only a while after its last session
    // closed: closing a terminal does not reshuffle the room at once.
    const live = visible.some((s) => !s.archived && s.attention !== "offline");
    const justClosed = visible.some((s) => !s.archived && !s.alive && now > 0 && now - s.status_since < LINGER_MS);
    if (!live && !justClosed) continue;
    // A busy repo keeps desks for what is alive; the closed ones go into a cabinet.
    const crowded = visible.length > FOLD_AFTER;
    const folded = crowded ? visible.filter((s) => s.attention === "offline" || s.archived) : [];
    const sessions = crowded ? visible.filter((s) => !folded.includes(s)) : visible;
    idle += sessions.filter((s) => !s.archived && s.attention !== "offline")
      .reduce((n, s) => n + Number(s.attention === "idle") + s.subagents.filter((a) => !a.running).length, 0);
    // Consoles in pairs: a new session sits at the free one instead of pushing the next repo along.
    // The cabinet of closed sessions takes the place of one more.
    const consoles = Math.max(2, Math.ceil(sessions.length / 2) * 2) + (folded.length ? 1 : 0);
    plans.push({ room, sessions, folded, consoles });
  }

  // The war room's tiers: rows of consoles curving round the screen wall, laid out before anyone
  // sits, dark until a session takes one. It grows only when its tiers cannot seat every repo.
  const sizes = plans.map((p) => p.consoles);
  const needed = sizes.reduce((n, k) => n + k + 1, 0);
  const minRows = Math.floor(minHeight / TILE);
  let warRows = Math.max(minRows, MIN_WAR_ROWS);
  let arena = tiers(cols, warRows);
  let packed = packRings(arena.seats, sizes);
  // Far from enough seats, grow by more than a row at a time (a tier holds a third of the width).
  for (let tries = 0; !packed && tries < 200; tries++) {
    const short = Math.max(0, needed - arena.all.length);
    warRows += Math.max(1, Math.floor((short / Math.max(1, cols / CELL_W)) * RING_GAP));
    arena = tiers(cols, warRows);
    packed = packRings(arena.seats, sizes);
  }
  const runs = packed ?? { runs: sizes.map(() => []), dark: arena.seats.flatMap((ring, i) => ring.map((seat) => ({ seat, ring: i }))) };

  const zones: Zone[] = plans.map(({ room, sessions, folded }, z) => {
    const run = runs.runs[z];
    if (!run.length) return { room, rect: { x: 0, y: 0, w: 0, h: 0 }, desks: [], spares: [], folded, segments: [], cabinet: null };
    const desks = sessions.slice(0, run.length).map((session, i) => deskAt(session, run[i].seat.x - 1, run[i].seat.y - 1));
    const kept = folded.length ? run.slice(0, -1) : run;
    const spares = kept.slice(sessions.length).map(({ seat }) => cellOf(seat));
    const cabinetSeat = folded.length ? run[run.length - 1].seat : null;
    const segments = [...new Set(run.map((r) => r.ring))].sort((a, b) => a - b).map((ring) =>
      run.filter((r) => r.ring === ring).map((r) => r.seat).sort((a, b) => a.x - b.x).map(cellOf));
    const xs = run.map((r) => r.seat.x);
    const ys = run.map((r) => r.seat.y);
    const rect = {
      x: Math.min(...xs) - 1,
      y: Math.min(...ys) - 1,
      w: Math.max(...xs) - Math.min(...xs) + CELL_W,
      h: Math.max(...ys) - Math.min(...ys) + CELL_H,
    };
    return { room, rect, desks, spares, folded, segments, cabinet: cabinetSeat && { x: cabinetSeat.x, y: cabinetSeat.y - 1 } };
  });
  const dark = runs.dark.map(({ seat }) => cellOf(seat));
  const lit = [...runs.runs.flat(), ...runs.dark].map((r) => r.seat);

  // The lounge grows a mingling row at a time until every idle agent has a place.
  const sideBySide = cols >= 18;
  const roomWidth = sideBySide ? Math.floor((cols - 3) / 2) : cols - 2;
  const perMingleRow = Math.max(2, Math.floor((roomWidth - 2) / 3) * 2);
  const mingleRows = Math.max(1, Math.ceil(idle / Math.max(1, perMingleRow)));
  const loungeRows = (LOUNGE_ROWS + mingleRows + 2) * (sideBySide ? 1 : 2) + 1;
  // The war room ends in a wall row; the lobby starts under it with its own wall.
  const war = { y: 0, h: warRows };
  // A free row under the lobby's wall, so the doorway always opens onto floor.
  const lobby = { y: war.h, h: Math.max(WALL_ROWS + 1 + loungeRows, minRows) };
  const rows = war.h + lobby.h;
  const loungeTop = lobby.y + WALL_ROWS + 1;
  const lounge = { x: 1, y: loungeTop, w: cols - 2, h: rows - 1 - loungeTop };
  const lobbyDoor = { x: Math.floor(cols / 2), y: war.h - 1 };

  const walkable = warFloor(cols, war.h, lobby);
  const block = (c: number, r: number) => {
    if (walkable[r]?.[c] !== undefined) walkable[r][c] = false;
  };
  // Every console blocks, lit or not: its desk, and its chair (a goal, never a corridor: nobody
  // walks through a seated agent).
  for (const seat of lit) blockConsole(block, seat);
  for (const zone of zones) if (zone.cabinet) block(zone.cabinet.x, zone.cabinet.y);
  const split = sideBySide ? lounge.x + Math.floor(lounge.w / 2) : lounge.y + Math.floor(lounge.h / 2);
  const teamRect = sideBySide
    ? { ...lounge, w: split - lounge.x }
    : { ...lounge, h: split - lounge.y };
  const principalRect = sideBySide
    ? { ...lounge, x: split + 1, w: lounge.x + lounge.w - split - 1 }
    : { ...lounge, y: split + 1, h: lounge.y + lounge.h - split - 1 };
  // A shared entrance hall leads to two rooms; the partition has a doorway.
  if (sideBySide) {
    for (let row = lounge.y + 2; row < lounge.y + lounge.h; row++) block(split, row);
  } else {
    for (let col = lounge.x + 2; col < lounge.x + lounge.w; col++) block(col, split);
  }
  const props: Prop[] = [];
  const makeRoom = (rect: Rect, premium: boolean): LoungeRoom => {
    const interior = { ...rect, y: rect.y + 3, h: rect.h - 3 };
    const furnished = furnishLounge({ ...interior, h: interior.h - mingleRows - 1 }, block);
    props.push(...furnished.props.map((p): Prop => ({ ...p, premium, kind: p.kind === "arcade" ? (premium ? "coffee" : "cooler") : p.kind === "lamp" && !premium ? "plant" : p.kind })));
    const conversations = mingleSpots(interior, mingleRows);
    return { rect, premium, conversations, spots: [...furnished.spots, ...conversations] };
  };
  const lounges = { team: makeRoom(teamRect, false), principals: makeRoom(principalRect, true) };
  const spots = [...lounges.team.spots, ...lounges.principals.spots];
  const conversations = [...lounges.team.conversations, ...lounges.principals.conversations];
  const door = { x: 1, y: WAR_WALL_ROWS };

  return {
    width: cols * TILE,
    height: rows * TILE,
    cols,
    rows,
    bands: { war, lobby },
    lobbyDoor,
    aggregate: view.aggregate,
    zones,
    dark,
    arena: { center: arena.center, half: arena.half, rise: arena.rise, rings: arena.rings },
    lounge,
    props,
    spots,
    door,
    walkable,
    conversations,
    lounges,
  };
}

const byRepo = (a: RoomView, b: RoomView) => a.repo_name.localeCompare(b.repo_name) || a.repo_id.localeCompare(b.repo_id);
/** Oldest first, so a new session takes the next free console instead of pushing others along. */
const bySeat = (a: SessionView, b: SessionView) => a.started_at - b.started_at || a.id.localeCompare(b.id);

/** The floor of both rooms, before any furniture: walls never, the doorway between them always. */
function warFloor(cols: number, warRows: number, lobby: RoomBand): boolean[][] {
  const doorX = Math.floor(cols / 2);
  const floorOf = (top: number, bottom: number, r: number) => r >= top && r < bottom - 1;
  return Array.from({ length: lobby.y + lobby.h }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      // The doorway: through the war room's bottom wall and the lobby's wall.
      if (c === doorX && r >= warRows - 1 && r < lobby.y + WALL_ROWS) return true;
      const inside = r < warRows ? floorOf(WAR_WALL_ROWS, warRows, r) : floorOf(lobby.y + WALL_ROWS, lobby.y + lobby.h, r);
      return inside && c > 0 && c < cols - 1;
    }),
  );
}

/** A console's desk (the row in front of its chair) and the chair itself. */
function blockConsole(block: (c: number, r: number) => void, seat: Point) {
  for (let c = seat.x - 1; c <= seat.x + 1; c++) block(c, seat.y - 1);
  block(seat.x, seat.y);
}

export type Arena = {
  /** The middle of the screen wall (tile): every tier faces it. */
  center: Point;
  /** Half the width the tiers span (tiles), and how much higher (rows) their ends are than their middle. */
  half: number;
  rise: number;
  /** The row of each tier's middle seat, from the screen out. */
  rings: number[];
};

/** The row of a tier's seat at column `x`: a gentle arc whose ends rise towards the screen. */
export function ringY(arena: Arena, ring: number, x: number): number {
  const k = (x - arena.center.x) / Math.max(1, arena.half);
  return arena.rings[ring] - arena.rise * k * k;
}

/**
 * The seats (chair tiles) of the war room's tiers, `cols` wide and `warRows` tall: rows of
 * consoles that curve round the screen wall like a mission control's, as many as fit `RING_GAP`
 * rows apart. Along a tier the 3×3 consoles touch (mirrored about the middle, free columns at the
 * sides as aisles); any a person could not walk to is dropped.
 */
function tiers(cols: number, warRows: number): Arena & { seats: Point[][]; all: Point[] } {
  const mid = Math.floor(cols / 2);
  // Cells from column 2 to cols − 3 (the outer columns are the side aisles), mirrored about a seat
  // straight under the middle of the screen.
  const reach = Math.max(0, Math.floor(Math.min(mid - 3, cols - 4 - mid) / CELL_W));
  const xs = Array.from({ length: 2 * reach + 1 }, (_, i) => mid + (i - reach) * CELL_W);
  const half = Math.max(1, Math.max(...xs.map((x) => Math.abs(x - mid))));
  const rise = Math.min(2, Math.max(1, Math.floor(half / 6)));
  // A free row under the wall, and the bottom wall with a free row above it (the doorway's).
  const minY = WAR_WALL_ROWS + 2;
  const maxY = warRows - 3;
  const top = minY + rise;
  const count = maxY >= top ? Math.floor((maxY - top) / RING_GAP) + 1 : 0;
  const arena: Arena = { center: { x: mid, y: WAR_WALL_ROWS - 1 }, half, rise, rings: Array.from({ length: count }, (_, i) => top + i * RING_GAP) };
  const rings = arena.rings.map((_, i) => xs.map((x) => ({ x, y: Math.round(ringY(arena, i, x)) })));

  // Keep only consoles someone can walk to from the door, with every console in place.
  const walkable = warFloor(cols, warRows, { y: warRows, h: 0 });
  for (const seat of rings.flat()) blockConsole((c, r) => walkable[r] && (walkable[r][c] = false), seat);
  const reached = new Set<string>();
  const queue: Point[] = [{ x: 1, y: WAR_WALL_ROWS }];
  reached.add(`1,${WAR_WALL_ROWS}`);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const next = { x: cur.x + dx, y: cur.y + dy };
      if (walkable[next.y]?.[next.x] && !reached.has(`${next.x},${next.y}`)) {
        reached.add(`${next.x},${next.y}`);
        queue.push(next);
      }
    }
  }
  const reachable = (s: Point) => [[1, 0], [-1, 0], [0, 1]].some(([dx, dy]) => reached.has(`${s.x + dx},${s.y + dy}`));
  const seats = rings.map((ring) => ring.filter(reachable));
  return { ...arena, seats, all: seats.flat() };
}

type Placed = { seat: Point; ring: number };

/**
 * Repos (how many consoles each takes, in order) along the tiers (`rings`, each its seats left to
 * right) from the screen out: each a run of neighbouring consoles, one free place between two repos
 * so each reads as a group, and each tier's runs centred on it. A repo that does not fit the rest of
 * a tier starts the next one; one longer than a whole tier carries on into the next. The places left
 * over are dark consoles (the free place between two repos stays empty floor). Null when the tiers
 * cannot seat them all.
 */
export function packRings(rings: Point[][], sizes: number[]): { runs: Placed[][]; dark: Placed[] } | null {
  // Per tier, what each place holds: a repo's index, or -1 for the gap between two repos.
  const rows: number[][] = rings.map(() => []);
  let r = 0;
  for (let z = 0; z < sizes.length; z++) {
    let left = sizes[z];
    while (left > 0) {
      if (r >= rings.length) return null;
      const cap = rings[r].length;
      const used = rows[r].length;
      const room = cap - used - (used ? 1 : 0);
      // Not on a tier's tail if a fresh tier would hold it whole.
      if (room <= 0 || (room < left && left <= (rings[r + 1]?.length ?? 0) && used)) {
        r++;
        continue;
      }
      if (used) rows[r].push(-1);
      const take = Math.min(room, left);
      for (let k = 0; k < take; k++) rows[r].push(z);
      left -= take;
      if (left) r++;
    }
  }
  const runs: Placed[][] = sizes.map(() => []);
  const dark: Placed[] = [];
  rings.forEach((ring, i) => {
    const offset = Math.floor((ring.length - rows[i].length) / 2);
    ring.forEach((seat, k) => {
      const z = k >= offset && k < offset + rows[i].length ? rows[i][k - offset] : undefined;
      if (z === undefined) dark.push({ seat, ring: i });
      else if (z >= 0) runs[z].push({ seat, ring: i });
    });
  });
  return { runs, dark };
}

/** The clickable cell of a console whose chair is at `seat` (pixels, like `Desk.cell`). */
function cellOf(seat: Point): Rect {
  return { x: (seat.x - 1) * TILE, y: (seat.y - 1) * TILE - 6, w: CELL_W * TILE, h: CELL_H * TILE + 6 };
}

function deskAt(session: SessionView, cx: number, cy: number): Desk {
  const seat = { x: cx + 1, y: cy + 1 };
  return {
    session,
    desk: { x: cx * TILE + 6, y: cy * TILE + 2, w: 3 * TILE - 12, h: TILE - 2 },
    seat,
    // Where its running subagents stand, still: either side of the chair. The aisle below stays
    // clear for the name; more of them show as "+N" on the console.
    slots: [
      { x: cx, y: cy + 1 },
      { x: cx + 2, y: cy + 1 },
    ],
    cell: cellOf(seat),
  };
}

/** Seating nooks on either side of a central aisle, with a table and a refreshment/book corner. */
function furnishLounge(lounge: Rect, block: (c: number, r: number) => void): { props: Prop[]; spots: Spot[] } {
  const props: Prop[] = [];
  const spots: Spot[] = [];
  const mid = lounge.x + Math.floor(lounge.w / 2);
  const sections = lounge.w >= 12
    ? [[lounge.x + 1, mid - 1], [mid + 2, lounge.x + lounge.w - 1]]
    : [[lounge.x + 1, lounge.x + lounge.w - 1]];
  let nook = 0;
  const add = (kind: Prop["kind"], x: number, y: number) => {
    props.push({ kind, x, y });
    block(x, y);
    if (kind === "sofa") {
      block(x + 1, y);
      for (let k = 0; k < 2; k++) spots.push({ tile: { x: x + k, y }, pose: "sit", face: "down" });
    }
  };
  for (let y = lounge.y; y + 4 <= lounge.y + lounge.h; y += 5) {
    for (const [start, end] of sections) {
      const count = Math.floor((end - start + 2) / 6);
      const first = start + Math.floor((end - start - (count * 6 - 2)) / 2);
      for (let i = 0; i < count; i++) {
        const x = first + i * 6;
        add("sofa", x, y);
        add(nook % 2 ? "lamp" : "plant", x + 3, y);
        add("table", x, y + 2);
        add((["coffee", "shelf", "cooler", "arcade", "shelf", "arcade", "shelf", "shelf"] as const)[nook % 8], x + 3, y + 2);
        spots.push({ tile: { x: x + 3, y: y + 3 }, pose: "stand", face: "up" });
        nook++;
      }
    }
  }
  return { props, spots };
}

/** Pairs of agents chatting face to face, in the rows below the furniture. */
function mingleSpots(lounge: Rect, rows: number): Spot[] {
  const spots: Spot[] = [];
  for (let r = 0; r < rows; r++) {
    const y = lounge.y + lounge.h - rows - 1 + r;
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

/** The repo whose console (lit or a spare, cabinet included) is under a pixel. */
export function zoneAtPoint(office: Office, p: Point): Zone | null {
  return office.zones.find((z) => z.segments.some((cells) => cells.some((c) => inside(p, c)))) ?? null;
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

/**
 * The largest scale (up to `pixelScale` for the width) whose layout fills `cssWidth` × `cssHeight`
 * with the room on show fitting in that height, so a short window draws smaller art instead of
 * shrinking a wide room into a square (and a tall lobby never makes the war room's names smaller).
 * If not even the smallest fits, its layout is used and the view shrinks.
 */
export function fitOffice(view: WarRoomView, cssWidth: number, cssHeight: number, showArchived: boolean, now = 0, room: RoomName = "war") {
  for (let scale = pixelScale(cssWidth); ; scale--) {
    const office = layoutOffice(view, Math.floor(cssWidth / scale), showArchived, cssHeight / scale, now);
    if (scale === 2 || office.bands[room].h * TILE * scale <= cssHeight) return { scale, office };
  }
}

/** Fit the complete canvas in the available space, including its one-pixel border on each side. */
export function fitViewport(width: number, height: number, availableWidth: number, availableHeight: number) {
  const border = Math.max(0, Math.min(2, availableWidth, availableHeight));
  const factor = Math.max(0, Math.min(1, (availableWidth - border) / width, (availableHeight - border) / height));
  return { width: width * factor + border, height: height * factor + border, shrunk: factor < 1 };
}
