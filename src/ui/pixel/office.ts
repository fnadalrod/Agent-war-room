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
/** Label row on top of each zone. */
const ZONE_LABEL_ROWS = 1;
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
  rect: Rect;
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
 * Lays out the office for `width` logical pixels: the war room (repo zones packed in shelves under
 * the wall, in a stable order: repos by name, desks by when their session started) and, through a door in its bottom wall, the
 * lobby with the crew lounge. Each fills at least `minHeight`. `now` (ms) keeps a repo whose last session
 * closed less than `LINGER_MS` ago on the floor.
 */
export function layoutOffice(view: WarRoomView, width: number, showArchived: boolean, minHeight = 0, now = 0): Office {
  const cols = Math.max(CELL_W + 2, Math.floor(width / TILE));
  const maxCells = Math.max(1, Math.floor((cols - 2 - 1) / CELL_W));
  const zones: Zone[] = [];

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
    // Fixed cell height (subagents stand at fixed spots, they never stretch a deck) and consoles in
    // pairs: a new session sits at the free one instead of widening the deck and pushing the others.
    const consoles = Math.max(2, Math.ceil(sessions.length / 2) * 2);
    const perRow = Math.max(1, Math.min(consoles, maxCells));
    const rowsOfCells = Math.ceil(consoles / perRow);
    const w = Math.max(perRow * CELL_W + 1, 5);
    const h = ZONE_LABEL_ROWS + Math.max(1, rowsOfCells * CELL_H);
    // Built at the origin; `arrange` moves it to its place on the floor.
    const cellAt = (i: number) => ({ cx: 1 + (i % perRow) * CELL_W, cy: ZONE_LABEL_ROWS + Math.floor(i / perRow) * CELL_H });
    const desks = sessions.map((session, i) => {
      const { cx, cy } = cellAt(i);
      return deskAt(session, cx, cy);
    });
    const spares = Array.from({ length: consoles - sessions.length }, (_, k) => {
      const { cx, cy } = cellAt(sessions.length + k);
      return { x: cx * TILE, y: cy * TILE - 6, w: CELL_W * TILE, h: CELL_H * TILE + 6 };
    });
    zones.push({ room, rect: { x: 0, y: 0, w, h }, desks, spares, folded, cabinet: folded.length ? { x: w - 2, y: 0 } : null });
  }

  const minRows = Math.floor(minHeight / TILE);
  // Floor between the screen wall (plus a row) and the bottom wall (plus a free row by the doorway).
  const top = WAR_WALL_ROWS + 1;
  const floorRows = Math.max(0, minRows - top - 2);
  const shelves = arrange(zones, cols - 2, floorRows);
  const contentRows = (zones.length ? top + shelves.reduce((n, sh) => n + sh.h, 0) + shelves.length - 1 : top + CELL_H) + 1;
  // The lounge grows a mingling row at a time until every idle agent has a place.
  const sideBySide = cols >= 18;
  const roomWidth = sideBySide ? Math.floor((cols - 3) / 2) : cols - 2;
  const perMingleRow = Math.max(2, Math.floor((roomWidth - 2) / 3) * 2);
  const mingleRows = Math.max(1, Math.ceil(idle / Math.max(1, perMingleRow)));
  const loungeRows = (LOUNGE_ROWS + mingleRows + 2) * (sideBySide ? 1 : 2) + 1;
  // The war room ends in a wall row; the lobby starts under it with its own wall.
  const war = { y: 0, h: Math.max(contentRows + 1, minRows) };
  // Spread the shelves over the floor: the spare rows go evenly above, between and below them.
  const spareRows = war.h - (contentRows + 1);
  const rowGap = Math.floor(Math.max(0, spareRows) / (shelves.length + 1));
  // One grid for every shelf: the n-th deck of each shelf is in the same column (as wide as its
  // widest deck), so the floor reads as rows and columns rather than a staircase.
  const columns: number[] = [];
  for (const shelf of shelves) shelf.zones.forEach((z, i) => (columns[i] = Math.max(columns[i] ?? 0, z.rect.w)));
  const fits = columns.reduce((n, w) => n + w, 0) + columns.length - 1 <= cols - 2;
  let shelfY = top + rowGap;
  for (const shelf of shelves) {
    const widths = fits ? columns : shelf.zones.map((z) => z.rect.w);
    const used = widths.reduce((n, w) => n + w, 0);
    const colGap = Math.floor((cols - 2 - used) / (widths.length + 1));
    let shelfX = 1 + colGap;
    shelf.zones.forEach((zone, i) => {
      // Each deck sits at the top of its shelf, centred in its column.
      moveZone(zone, shelfX + Math.floor((widths[i] - zone.rect.w) / 2), shelfY);
      shelfX += widths[i] + colGap;
    });
    shelfY += shelf.h + 1 + rowGap;
  }
  // A free row under the lobby's wall, so the doorway always opens onto floor.
  const lobby = { y: war.h, h: Math.max(WALL_ROWS + 1 + loungeRows, minRows) };
  const rows = war.h + lobby.h;
  const loungeTop = lobby.y + WALL_ROWS + 1;
  const lounge = { x: 1, y: loungeTop, w: cols - 2, h: rows - 1 - loungeTop };
  const lobbyDoor = { x: Math.floor(cols / 2), y: war.h - 1 };

  const floorOf = (band: RoomBand, r: number) => r >= band.y + (band === war ? WAR_WALL_ROWS : WALL_ROWS) && r < band.y + band.h - 1;
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

/**
 * Groups the decks (in their stable order) into evenly filled shelves, as many as make each deck's
 * share of the floor about the shape of a deck: a wide, short floor gets one long row, a squarer one
 * several rows, so the decks spread over the room instead of lining up in one strip.
 */
function arrange(zones: Zone[], width: number, rows: number): { zones: Zone[]; h: number }[] {
  const shelvesFor = (limit: number) => {
    const out: { zones: Zone[]; h: number; w: number }[] = [];
    for (const zone of zones) {
      const last = out[out.length - 1];
      if (last && last.w + 1 + zone.rect.w <= limit) {
        last.zones.push(zone);
        last.w += 1 + zone.rect.w;
        last.h = Math.max(last.h, zone.rect.h);
      } else out.push({ zones: [zone], h: zone.rect.h, w: zone.rect.w });
    }
    return out;
  };
  const widest = Math.max(0, ...zones.map((z) => z.rect.w));
  let best = shelvesFor(width);
  if (rows <= 0 || zones.length < 2) return best;
  // Each deck should get a share of the floor about one and a half times as wide as the deck's own
  // shape: aisles between decks read better than tall empty bands above and below them, and a few
  // well-spaced rows better than a stack of them pressed together.
  const deckRatio = (1.5 * zones.reduce((n, z) => n + z.rect.w + 1, 0)) / zones.reduce((n, z) => n + z.rect.h + 1, 0);
  let bestScore = Infinity;
  for (let k = 1; k <= zones.length; k++) {
    // The most even split into k shelves (in order): the narrowest limit that needs no more than k.
    let limit = widest;
    while (limit < width && shelvesFor(limit).length > k) limit++;
    const shelves = shelvesFor(limit);
    if (shelves.length !== k) continue;
    if (shelves.reduce((n, sh) => n + sh.h, 0) + (k - 1) > rows) break;
    const perShelf = Math.max(...shelves.map((sh) => sh.zones.length));
    const share = width / perShelf / (rows / k);
    const score = Math.abs(Math.log(share / deckRatio));
    if (score < bestScore - 1e-9) [best, bestScore] = [shelves, score];
  }
  return best;
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
    cell: { x: cx * TILE, y: cy * TILE - 6, w: CELL_W * TILE, h: CELL_H * TILE + 6 },
  };
}

function moveZone(zone: Zone, dc: number, dr: number) {
  if (dc === 0 && dr === 0) return;
  const px = (p: Point) => ({ x: p.x + dc, y: p.y + dr });
  const rx = (r: Rect, unit: number) => ({ ...r, x: r.x + dc * unit, y: r.y + dr * unit });
  zone.rect = rx(zone.rect, 1);
  zone.spares = zone.spares.map((r) => rx(r, TILE));
  if (zone.cabinet) zone.cabinet = px(zone.cabinet);
  for (const d of zone.desks) {
    d.seat = px(d.seat);
    d.slots = d.slots.map(px);
    d.desk = rx(d.desk, TILE);
    d.cell = rx(d.cell, TILE);
  }
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

/** The repo zone (its deck, label row included) under a pixel. */
export function zoneAtPoint(office: Office, p: Point): Zone | null {
  return office.zones.find((z) => inside(p, { x: z.rect.x * TILE, y: z.rect.y * TILE, w: z.rect.w * TILE, h: z.rect.h * TILE })) ?? null;
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
