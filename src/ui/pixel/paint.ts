// Pixel-art painting of the office. Logical coordinates; the canvas is scaled with `pixelated`.
import type { AttentionView, SessionView, SubagentView } from "../../domain/attention";
import { contextLevel, contextRatio, deskName } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { drawText, fit, HOURGLASS, textWidth, wrap } from "./font";
import { type Desk, type Office, type Prop, type Rect, type Zone, TILE, WALL_ROWS, WAR_WALL_ROWS, feetOf, ringY } from "./office";
import { type Actor, hash, subagentKey } from "./sim";
import { body, drawSprite, lounging, palette, seated, waving } from "./sprites";

export const COLOR: Record<AttentionView, string> = {
  needs_you: "#f25555",
  finished: "#4cb8f5",
  working: "#34d27a",
  idle: "#93a1b8",
  offline: "#56637a",
};
/** Working but silent for too long: amber, between "working" and "needs you". */
const STALLED = "#f59e0b";

/** Mission control: dark metal, cyan light. */
const UI = {
  floor: "#0c1322",
  seam: "#121b2e",
  panel: "#0f1829",
  wall: "#080d18",
  wallPanel: "#0d1424",
  cyan: "#22d3ee",
  cyanDim: "#0e7490",
  metal: "#1c2436",
  metalTop: "#283249",
  metalEdge: "#3a4868",
  metalDark: "#121826",
  text: "#cfe8f3",
};
/** Each repo's tier gets its own accent. */
const TIERS = ["#22d3ee", "#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fbbf24"];

export type PaintState = {
  frame: number;
  /** Screen pixels per art pixel (the canvas transform), for text finer than the art. */
  scale: number;
  now: Date;
  selected: string | null;
  selectedAgent: string | null;
  hovered: string | null;
  hoveredAgent: string | null;
  /** The cabinet under the cursor, to highlight it. */
  hoveredCabinet: string | null;
  /** The doorway between the rooms is under the cursor. */
  hoveredDoor: boolean;
  actors: Map<string, Actor>;
  /**
   * The frame each session's console lit up at, kept by the scene across frames: a console
   * boots for a moment when its session arrives. Filled here; without it nothing boots.
   */
  litAt?: Map<string, number>;
};

/** Frames (of `PaintState.frame`) a console takes to boot when its session arrives. */
const BOOT_FRAMES = 14;

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function frameRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  rect(ctx, x, y, w, 1, color);
  rect(ctx, x, y + h - 1, w, 1, color);
  rect(ctx, x, y, 1, h, color);
  rect(ctx, x + w - 1, y, 1, h, color);
}

/** Machined corners, kept on the pixel grid rather than antialiased vector diagonals. */
function armor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: number, color: string) {
  const bevel = Math.min(cut, Math.floor(w / 2), Math.floor(h / 2));
  rect(ctx, x, y + bevel, w, h - bevel * 2, color);
  for (let row = 0; row < bevel; row++) {
    const inset = bevel - row;
    rect(ctx, x + inset, y + row, w - inset * 2, 1, color);
    rect(ctx, x + inset, y + h - 1 - row, w - inset * 2, 1, color);
  }
}

function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, draw: () => void) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  draw();
  ctx.restore();
}

/** Seeded stable pseudo-random, so decoration does not jitter between frames. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const stalled = (s: SessionView) => s.attention === "working" && s.stalled_since != null;

export function paintOffice(ctx: CanvasRenderingContext2D, office: Office, st: PaintState) {
  ctx.imageSmoothingEnabled = false;
  floor(ctx, office);
  wall(ctx, office, st);
  warRoomBottom(ctx, office, st);
  loungeRug(ctx, office);
  lobbyWall(ctx, office, st);
  arenaFloor(ctx, office, st);
  for (const cell of office.dark) pad(ctx, cell, null, false, false, false);
  for (const zone of office.zones) {
    const accent = TIERS[hash(zone.room.repo_id) % TIERS.length];
    // One continuous platform per run: the pads of a repo's neighbouring consoles join.
    for (const cells of zone.segments) {
      cells.forEach((cell, i) => {
        const joins = (other?: Rect) => !!other && Math.abs(other.y - cell.y) <= TILE;
        const lit = zone.desks.some((d) => d.cell.x === cell.x && d.cell.y === cell.y);
        pad(ctx, cell, accent, lit, joins(cells[i - 1]), joins(cells[i + 1]));
      });
    }
  }

  // Everything that stands on the floor, back to front.
  const drawables: Array<{ y: number; draw: () => void }> = [];
  for (const zone of office.zones) {
    for (const d of zone.desks) {
      drawables.push({ y: d.desk.y + d.desk.h, draw: () => desk(ctx, d, st) });
      const seatFeet = feetOf(d.seat);
      drawables.push({ y: seatFeet.y + 0.5, draw: () => chair(ctx, seatFeet.x, seatFeet.y) });
    }
  }
  for (const zone of office.zones) {
    const accent = TIERS[hash(zone.room.repo_id) % TIERS.length];
    for (const spare of zone.spares) drawables.push({ y: spare.y + 8 + TILE - 2, draw: () => spareConsole(ctx, spare, accent, st.frame) });
    if (zone.cabinet) drawables.push({ y: zone.cabinet.y * TILE + TILE - 1, draw: () => cabinet(ctx, zone, st) });
  }
  for (const cell of office.dark) drawables.push({ y: cell.y + 8 + TILE - 2, draw: () => spareConsole(ctx, cell, null, st.frame) });
  for (const prop of office.props) {
    const top = prop.y * TILE;
    withAlpha(ctx, 0.24, () => rect(ctx, prop.x * TILE + 2, top + 10, prop.kind === "sofa" ? 32 : 15, 5, "#100f1d"));
    drawables.push({ y: top + 5, draw: () => propBack(ctx, prop) });
    drawables.push({ y: top + TILE - 2.5, draw: () => propFront(ctx, prop) });
  }
  const sessions = new Map(office.zones.flatMap((z) => z.desks.map((d) => [d.session.id, d.session] as const)));
  for (const actor of st.actors.values()) {
    if (actor.owner != null) {
      const session = sessions.get(actor.owner);
      if (session) drawables.push({ y: actor.y, draw: () => teammate(ctx, actor, session, subagentOf(session, actor), st) });
      continue;
    }
    const session = sessions.get(actor.id);
    drawables.push({ y: actor.y, draw: () => agent(ctx, actor, session, st) });
  }
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // Names over whoever stands in the aisle, so a subagent never hides whose console it is, and
  // each repo's sign over its consoles.
  for (const zone of office.zones) for (const d of zone.desks) nameplate(ctx, d, st.scale);
  for (const zone of office.zones) sign(ctx, office, zone, st.scale);

  // On top of everything: what each agent is saying, and selection marks.
  const seats = new Map(office.zones.flatMap((z) => z.desks.map((d) => [d.session.id, feetOf(d.seat)] as const)));
  for (const actor of st.actors.values()) {
    if (actor.owner == null) {
      const session = sessions.get(actor.id);
      if (session) bubble(ctx, actor, session, st.frame, chatting(actor, st));
      continue;
    }
    const session = sessions.get(actor.owner);
    const agent = session && subagentOf(session, actor);
    const seat = seats.get(actor.owner);
    // In the aisle the bubble goes to the outer side, clear of the names.
    const side = seat && actor.y > seat.y ? (actor.x < seat.x ? "left" : "right") : null;
    if (agent && !agent.running) bubble(ctx, actor, { ...session!, id: actor.id, attention: "idle", stalled_since: null }, st.frame, chatting(actor, st));
    if (agent?.running && actor.pose !== "walk") toolBubble(ctx, agent, actor.x, actor.y, st.frame, side);
  }
  for (const zone of office.zones) for (const d of zone.desks) marks(ctx, d, st);
}

// ---------- Room ----------

function floor(ctx: CanvasRenderingContext2D, office: Office) {
  rect(ctx, 0, 0, office.width, office.height, UI.floor);
  // Floor panels with seams, and a faint light grid every fourth panel.
  for (let r = WAR_WALL_ROWS; r < office.rows; r++) {
    for (let c = 0; c < office.cols; c++) {
      const x = c * TILE;
      const y = r * TILE;
      if ((r + c) % 2 === 0) rect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, UI.panel);
      rect(ctx, x, y, TILE, 1, UI.seam);
      rect(ctx, x, y, 1, TILE, UI.seam);
    }
  }
  withAlpha(ctx, 0.08, () => {
    for (let c = 0; c < office.cols; c += 4) rect(ctx, c * TILE, WAR_WALL_ROWS * TILE, 1, office.height, UI.cyan);
    for (let r = WAR_WALL_ROWS; r < office.rows; r += 4) rect(ctx, 0, r * TILE, office.width, 1, UI.cyan);
  });
  // The light of the screen wall falls on the front rows.
  for (let i = 0; i < 6; i++) withAlpha(ctx, 0.05 - i * 0.008, () => rect(ctx, 0, WAR_WALL_ROWS * TILE + i * 6, office.width, 6, UI.cyan));
  // Vignette at the sides.
  withAlpha(ctx, 0.35, () => {
    rect(ctx, 0, WAR_WALL_ROWS * TILE, 4, office.height, "#000");
    rect(ctx, office.width - 4, WAR_WALL_ROWS * TILE, 4, office.height, "#000");
  });
  // Structural ribs at the edges, clear of the usable floor tiles.
  for (let y = WAR_WALL_ROWS * TILE + 10; y < (office.bands.war.h - 1) * TILE - 10; y += 40) {
    for (const x of [2, office.width - 10]) {
      rect(ctx, x, y, 8, 24, UI.metalDark);
      rect(ctx, x + 2, y + 2, 4, 18, UI.metalTop);
      rect(ctx, x + 3, y + 4, 2, 8, UI.cyanDim);
      for (let i = 0; i < 3; i++) rect(ctx, x + 2 + i, y + 21 - i, 2, 1, "#9b8153");
    }
  }
}

function wall(ctx: CanvasRenderingContext2D, office: Office, st: PaintState) {
  const h = WAR_WALL_ROWS * TILE;
  rect(ctx, 0, 0, office.width, h, UI.wall);
  for (let x = 0; x < office.width; x += 24) rect(ctx, x, 0, 1, h, UI.wallPanel);
  // Ceiling lights.
  for (let x = 12; x < office.width; x += 48) withAlpha(ctx, 0.6, () => rect(ctx, x, 1, 18, 1, "#7dd3fc"));
  rect(ctx, 4, 3, office.width - 8, 2, UI.metalTop);
  for (let x = 8; x < office.width - 8; x += 16) rect(ctx, x, 3, 6, 1, UI.metalEdge);

  // The screen wall: one wide board with what waits for you (the header already has the counters),
  // flanked, where the wall is wide enough, by a radar of the room and a status rack.
  const wing = office.width >= 380 ? Math.min(110, Math.floor(office.width * 0.17)) : 0;
  const main = Math.min(400, Math.floor(office.width * (wing ? 0.5 : 0.62)));
  const mainX = Math.max((office.door.x + 1) * TILE + 10, Math.floor((office.width - main) / 2));
  const boardW = Math.min(main, office.width - mainX - 10);
  armor(ctx, mainX - 5, 7, boardW + 10, h - 15, 5, UI.metalEdge);
  mainScreen(ctx, office, mainX, 11, boardW, h - 25, st);
  if (wing) {
    // The entrance takes the left of the wall: the radar keeps clear of it.
    const leftWing = Math.min(wing, mainX - 14 - ((office.door.x + 1) * TILE + 6));
    const sideH = h - 33;
    if (leftWing >= 40) {
      armor(ctx, mainX - 11 - leftWing, 13, leftWing + 6, sideH + 6, 3, UI.metalEdge);
      radar(ctx, office, mainX - 8 - leftWing, 16, leftWing, sideH, st.frame);
    }
    const rightX = mainX + boardW + 11;
    const rightWing = Math.min(wing, office.width - 12 - rightX);
    if (rightWing >= 40) {
      armor(ctx, rightX - 3, 13, rightWing + 6, sideH + 6, 3, UI.metalEdge);
      statusRack(ctx, office, rightX, 16, rightWing, sideH, st.frame);
    }
  }
  // A continuous equipment plinth anchors the display wall.
  for (let x = 40; x < office.width - 16; x += 24) {
    rect(ctx, x, h - 12, 21, 7, UI.metalTop);
    rect(ctx, x + 2, h - 10, 17, 1, UI.metalEdge);
    for (let i = 0; i < 4; i++) rect(ctx, x + 3 + i * 4, h - 8, 2, 2, UI.metalDark);
  }
  // Console-grade edge where the wall meets the floor.
  rect(ctx, 0, h - 3, office.width, 3, UI.metalDark);
  withAlpha(ctx, 0.6, () => rect(ctx, 0, h - 3, office.width, 1, UI.cyanDim));
  door(ctx, office.door.x * TILE, h, st.frame);
}

function screenFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  rect(ctx, x - 2, y - 2, w + 4, h + 4, "#1a2234");
  rect(ctx, x - 1, y - 1, w + 2, h + 2, "#05080f");
  rect(ctx, x, y, w, h, "#061020");
  // Scanlines.
  withAlpha(ctx, 0.18, () => {
    for (let yy = y; yy < y + h; yy += 2) rect(ctx, x, yy, w, 1, "#000");
  });
}

/** What the board lists: who needs you, then who looks stuck, then who finished. */
export function boardEntries(office: Office): Array<{ mark: string; color: string; text: string }> {
  const sessions = office.zones.flatMap((z) => z.desks.map((d) => ({ s: d.session, repo: z.room.repo_name })))
    .filter(({ s }) => !s.archived && !s.muted);
  const line = (mark: string, color: string) => ({ s, repo }: { s: SessionView; repo: string }) =>
    ({ mark, color, text: `${repo} · ${s.title ?? deskName(s)}`.toUpperCase() });
  return [
    ...sessions.filter(({ s }) => s.attention === "needs_you").map(line("!", COLOR.needs_you)),
    ...sessions.filter(({ s }) => stalled(s)).map(line(HOURGLASS, STALLED)),
    ...sessions.filter(({ s }) => s.attention === "finished").map(line(copy.pixel.finishedBubble, COLOR.finished)),
  ];
}

function mainScreen(ctx: CanvasRenderingContext2D, office: Office, x: number, y: number, w: number, h: number, st: PaintState) {
  screenFrame(ctx, x, y, w, h);
  drawText(ctx, copy.pixel.title, x + Math.floor((w - textWidth(copy.pixel.title)) / 2), y + 3, UI.cyanDim);
  rect(ctx, x + 4, y + 10, w - 8, 1, "#12324a");
  const entries = boardEntries(office);
  if (entries.length === 0) {
    const quiet = copy.pixel.allQuiet;
    drawText(ctx, quiet, x + Math.floor((w - textWidth(quiet)) / 2), y + Math.floor(h / 2) + 1, "#3b8aa0");
    return;
  }
  const rows = Math.max(1, Math.floor((h - 14) / 7));
  const shown = entries.length > rows ? entries.slice(0, rows - 1) : entries;
  shown.forEach((e, i) => {
    const ly = y + 13 + i * 7;
    const urgent = e.mark === "!";
    // What needs you pulses; the rest is steady.
    if (urgent) withAlpha(ctx, st.frame % 10 < 6 ? 0.22 : 0.08, () => rect(ctx, x + 2, ly - 1, w - 4, 7, COLOR.needs_you));
    drawText(ctx, e.mark, x + 5, ly, e.color);
    drawText(ctx, fit(e.text, w - 22), x + 17, ly, urgent ? "#fde2e2" : UI.text);
  });
  if (shown.length < entries.length) {
    const more = `+${entries.length - shown.length}`;
    drawText(ctx, more, x + 5, y + 13 + shown.length * 7, UI.cyanDim);
  }
  withAlpha(ctx, 0.12, () => rect(ctx, x - 6, y + h + 2, w + 12, 3, UI.cyan));
}

/** Every desk on the floor, with its repo's colour (for the side screens). */
function floorDesks(office: Office) {
  return office.zones.flatMap((z) => z.desks.map((d) => ({ d, accent: TIERS[hash(z.room.repo_id) % TIERS.length] })));
}

const signal = (s: SessionView) => (stalled(s) ? STALLED : COLOR[s.attention]);

/**
 * Left wing: a radar of the room. Its sweep turns; every console is a blip (left to right round the
 * dish, the tiers from the middle out), lit as the sweep passes and in its agent's colour: what
 * needs you blinks.
 */
function radar(ctx: CanvasRenderingContext2D, office: Office, x: number, y: number, w: number, h: number, frame: number) {
  screenFrame(ctx, x, y, w, h);
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2);
  const ry = Math.floor(h / 2) - 3;
  const rx = Math.min(Math.floor(w / 2) - 4, Math.round(ry * 1.6));
  const plot = (angle: number, k: number, color: string) => rect(ctx, cx + Math.round(Math.sin(angle) * rx * k), cy - Math.round(Math.cos(angle) * ry * k), 1, 1, color);
  withAlpha(ctx, 0.5, () => {
    for (const k of [1, 0.66, 0.33]) for (let a = 0; a < Math.PI * 2; a += 0.12) plot(a, k, UI.cyanDim);
    rect(ctx, cx - rx, cy, rx * 2 + 1, 1, "#0b3a4a");
    rect(ctx, cx, cy - ry, 1, ry * 2 + 1, "#0b3a4a");
  });
  // The sweep, with a fading wake behind it.
  const sweep = ((frame % 60) / 60) * Math.PI * 2;
  for (let trail = 0; trail < 8; trail++) {
    const a = sweep - trail * 0.07;
    withAlpha(ctx, 0.75 - trail * 0.09, () => {
      for (let k = 0.08; k <= 1; k += 0.05) plot(a, k, trail ? UI.cyanDim : "#67e8f9");
    });
  }
  const { center, half, rings } = office.arena;
  for (const { d } of floorDesks(office)) {
    // Left to right round the dish, the tiers from the middle out.
    const angle = ((d.seat.x - center.x) / Math.max(1, half)) * Math.PI * 0.9;
    const tier = rings.findIndex((y) => y >= d.seat.y);
    const k = 0.3 + 0.7 * ((tier < 0 ? rings.length - 1 : tier) + 1) / Math.max(1, rings.length);
    // How long since the sweep passed it: lit just after, fading over a turn.
    const since = (((sweep - angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const s = d.session;
    const urgent = s.attention === "needs_you" && !s.muted;
    const glow = urgent ? (frame % 10 < 5 ? 1 : 0.35) : Math.max(0.3, 1 - since / 3);
    const bx = cx + Math.round(Math.sin(angle) * rx * k);
    const by = cy - Math.round(Math.cos(angle) * ry * k);
    withAlpha(ctx, glow, () => {
      rect(ctx, bx - 1, by, 3, 1, signal(s));
      rect(ctx, bx, by - 1, 1, 3, signal(s));
    });
    if (since < 0.5) rect(ctx, bx, by, 1, 1, "#ecfeff");
  }
}

/**
 * Right wing: a status rack. A trace that runs faster the more agents work, a bar per repo
 * (its colour, as tall as its sessions, flickering while they work) and a light per session.
 */
function statusRack(ctx: CanvasRenderingContext2D, office: Office, x: number, y: number, w: number, h: number, frame: number) {
  screenFrame(ctx, x, y, w, h);
  const desks = floorDesks(office);
  const working = desks.filter(({ d }) => d.session.attention === "working").length;
  // The trace: a heartbeat across the top.
  const mid = y + 6;
  for (let i = 0; i < w - 6; i++) {
    const t = i + frame * (1 + Math.min(4, working));
    const beat = t % 34;
    const dy = working ? (beat === 10 ? -4 : beat === 11 ? 3 : beat === 12 ? -2 : 0) : 0;
    withAlpha(ctx, 0.35 + 0.65 * (i / (w - 6)), () => rect(ctx, x + 3 + i, mid + dy, 1, 1, working ? COLOR.working : UI.cyanDim));
  }
  rect(ctx, x + 3, y + 12, w - 6, 1, "#12324a");
  // A bar per repo.
  const zones = office.zones.filter((z) => z.desks.length);
  const most = Math.max(1, ...zones.map((z) => z.desks.length));
  const lightsTop = y + h - 6;
  const barsTop = y + 15;
  const barsH = lightsTop - barsTop - 3;
  const barW = Math.max(2, Math.min(8, Math.floor((w - 8) / Math.max(1, zones.length)) - 2));
  zones.slice(0, Math.floor((w - 6) / (barW + 2))).forEach((z, i) => {
    const accent = TIERS[hash(z.room.repo_id) % TIERS.length];
    const busy = z.desks.filter((d) => d.session.attention === "working").length;
    const flicker = busy ? Math.floor(rand(i * 13 + Math.floor(frame / 3)) * 3) : 0;
    const bh = Math.max(2, Math.min(barsH, Math.round((z.desks.length / most) * (barsH - 2)) + flicker));
    const bx = x + 4 + i * (barW + 2);
    withAlpha(ctx, 0.25, () => rect(ctx, bx, barsTop, barW, barsH, accent));
    rect(ctx, bx, barsTop + barsH - bh, barW, bh, accent);
    rect(ctx, bx, barsTop + barsH - bh, barW, 1, "#ecfeff");
  });
  // A light per session, in its agent's colour; what needs you blinks.
  const perRow = Math.max(1, Math.floor((w - 6) / 4));
  desks.slice(0, perRow).forEach(({ d }, i) => {
    const s = d.session;
    const off = s.attention === "needs_you" && !s.muted && frame % 10 >= 5;
    rect(ctx, x + 4 + i * 4, lightsTop, 2, 2, off ? "#3f1414" : signal(s));
  });
}

function door(ctx: CanvasRenderingContext2D, x: number, wallBottom: number, frame: number) {
  // A sliding door with a light strip.
  rect(ctx, x, wallBottom - 30, 16, 30, UI.metalDark);
  rect(ctx, x + 2, wallBottom - 28, 12, 27, "#1a2335");
  rect(ctx, x + 7, wallBottom - 28, 1, 27, "#0a0f1a");
  rect(ctx, x + 2, wallBottom - 30, 12, 1, frame % 20 < 10 ? UI.cyan : UI.cyanDim);
}

/** Agents resting in the lobby (idle, visible sessions). */
export function lobbyCount(office: Office): number {
  return office.zones.flatMap((z) => z.desks)
    .filter((d) => !d.session.archived && d.session.attention !== "offline")
    .reduce((total, d) => total + Number(d.session.attention === "idle") + d.session.subagents.filter((a) => !a.running).length, 0);
}

/** The war room's bottom wall, with the doorway to the lobby and how many are resting there. */
function warRoomBottom(ctx: CanvasRenderingContext2D, office: Office, st: PaintState) {
  const y = (office.bands.war.h - 1) * TILE;
  rect(ctx, 0, y, office.width, TILE, UI.wall);
  rect(ctx, 0, y, office.width, 3, UI.metalDark);
  withAlpha(ctx, 0.6, () => rect(ctx, 0, y, office.width, 1, UI.cyanDim));
  const dx = office.lobbyDoor.x * TILE;
  // The open doorway, with the lobby's warmer light spilling in.
  rect(ctx, dx - 2, y, TILE + 4, TILE, UI.metalEdge);
  rect(ctx, dx, y, TILE, TILE, "#1a2335");
  withAlpha(ctx, 0.25, () => rect(ctx, dx, y - 6, TILE, 6, "#fbbf24"));
  rect(ctx, dx, y, TILE, 1, st.frame % 20 < 10 ? "#fbbf24" : "#b7832a");
  const label = `${copy.pixel.lobbySign} ${lobbyCount(office)}`;
  const lx = dx + TILE + 6;
  rect(ctx, lx - 2, y + 5, textWidth(label) + 4, 8, "#050a14");
  drawText(ctx, label, lx, y + 7, "#fcd34d");
  if (st.hoveredDoor) frameRect(ctx, dx - 4, y - TILE, TILE + 8, 2 * TILE, "#ffffffaa");
}

/** The lobby's wall: windows on the night, its sign and the doorway back to the war room. */
function lobbyWall(ctx: CanvasRenderingContext2D, office: Office, st: PaintState) {
  const top = office.bands.lobby.y * TILE;
  const h = WALL_ROWS * TILE;
  rect(ctx, 0, top, office.width, h, "#242332");
  for (let x = 0; x < office.width; x += 16) {
    rect(ctx, x, top + 32, 1, 13, "#39303b");
    rect(ctx, x + 2, top + 34, 12, 9, "#2e2834");
  }
  rect(ctx, 0, top + 31, office.width, 1, "#80604f");
  // The sign, then windows with a few stars.
  const sign = copy.pixel.lobbySign;
  const sw = textWidth(sign) + 8;
  const dx = office.lobbyDoor.x * TILE;
  const back = copy.pixel.warSign;
  // Keep clear of the doorway and its sign over it.
  const clearFrom = Math.min(dx - 4, dx + TILE / 2 - Math.floor(textWidth(back) / 2) - 4);
  const clearTo = Math.max(dx + TILE + 4, dx + TILE / 2 + Math.ceil(textWidth(back) / 2) + 4);
  for (let x = sw + 24; x + 40 < office.width; x += 72) {
    if (x + 42 > clearFrom && x - 2 < clearTo) continue;
    rect(ctx, x - 2, top + 8, 44, 26, "#1a2234");
    rect(ctx, x, top + 10, 40, 22, "#0a1330");
    rect(ctx, x, top + 23, 40, 9, "#232b48");
    for (let i = 0; i < 5; i++) {
      const seed = x * 7 + i;
      rect(ctx, x + 2 + Math.floor(rand(seed) * 36), top + 12 + Math.floor(rand(seed + 1) * 8), 1, 1, "#9daec7");
      const bh = 4 + Math.floor(rand(seed + 2) * 8);
      rect(ctx, x + i * 8, top + 32 - bh, 7, bh, "#10192c");
      for (let wy = top + 34 - bh; wy < top + 30; wy += 3) {
        rect(ctx, x + i * 8 + 2, wy, 1, 1, "#c4a174");
        if (i % 2) rect(ctx, x + i * 8 + 5, wy, 1, 1, "#688b9c");
      }
    }
    rect(ctx, x + 19, top + 10, 2, 22, "#364057");
    rect(ctx, x - 2, top + 32, 44, 2, "#a27a60");
    rect(ctx, x - 1, top + 34, 42, 2, "#151c2b");
  }
  rect(ctx, 8, top + 4, sw, 9, "#050a14");
  frameRect(ctx, 8, top + 4, sw, 9, "#fbbf24");
  drawText(ctx, sign, 12, top + 6, "#fbbf24");
  // The doorway up to the war room.
  rect(ctx, dx - 2, top + h - 30, TILE + 4, 30, UI.metalDark);
  rect(ctx, dx, top + h - 28, TILE, 28, UI.floor);
  rect(ctx, dx, top + h - 28, TILE, 1, st.frame % 20 < 10 ? UI.cyan : UI.cyanDim);
  rect(ctx, dx + TILE / 2 - Math.floor(textWidth(back) / 2) - 2, top + 3, textWidth(back) + 4, 8, "#050a14");
  drawText(ctx, back, dx + TILE / 2 - Math.floor(textWidth(back) / 2), top + 4, UI.cyan);
  rect(ctx, 0, top + h - 3, office.width, 3, UI.metalDark);
  withAlpha(ctx, 0.6, () => rect(ctx, 0, top + h - 3, office.width, 1, "#b7832a"));
  if (st.hoveredDoor) frameRect(ctx, dx - 4, top + h - 32, TILE + 8, 34, "#ffffffaa");
}

/**
 * The war room's floor: the screen's light falling on the middle, a glow under each repo's
 * consoles and a light track along each tier.
 */
function arenaFloor(ctx: CanvasRenderingContext2D, office: Office, st: PaintState) {
  const cx = office.arena.center.x * TILE + TILE / 2;
  const top = WAR_WALL_ROWS * TILE + 2;
  const bottom = (office.bands.war.h - 1) * TILE - 2;
  const dot = (x: number, y: number, color: string) => {
    if (y >= top && y < bottom && x >= 4 && x < office.width - 4) rect(ctx, x, y, 1, 1, color);
  };
  // A pool of light under the screen, widening as it falls.
  for (let i = 0; i < 8; i++) {
    const y = top + i * 6;
    const half = 40 + i * 10;
    withAlpha(ctx, 0.05 - i * 0.005, () => rect(ctx, cx - half, y, half * 2, 6, UI.cyan));
  }
  // Under each repo's run of consoles, a glow in its colour: the group reads before the names do.
  for (const zone of office.zones) {
    const accent = TIERS[hash(zone.room.repo_id) % TIERS.length];
    for (const cells of zone.segments) {
      cells.forEach((c, i) => {
        const x0 = i ? c.x : c.x - 3;
        const x1 = i < cells.length - 1 ? c.x + c.w : c.x + c.w + 3;
        withAlpha(ctx, 0.1, () => rect(ctx, x0, c.y + 1, x1 - x0, c.h + 2, accent));
      });
    }
  }
  // Each tier's track runs along the aisle behind its chairs; a light runs along it.
  const arena = office.arena;
  const left = 2 * TILE;
  const right = office.width - 2 * TILE;
  arena.rings.forEach((_, ring) => {
    const span = right - left;
    const runner = (st.frame * 3 + ring * 60) % (span + 40);
    for (let x = left; x < right; x++) {
      const y = Math.round((ringY(arena, ring, x / TILE - 0.5) + 1.45) * TILE + TILE - 3);
      const near = Math.abs(x - left - runner);
      if (near < 14) withAlpha(ctx, 0.7 - near * 0.045, () => dot(x, y, UI.cyan));
      else if (x % 3 === 0) withAlpha(ctx, 0.3, () => dot(x, y, UI.cyanDim));
    }
  });
}

/**
 * The armored pad a console stands on, edged in its repo's colour (grey when nobody has it). It
 * reaches its neighbour on a side that `joins`, so a repo's run reads as one platform and a gap
 * parts it from the next repo.
 */
function pad(ctx: CanvasRenderingContext2D, cell: Rect, accent: string | null, lit: boolean, joinLeft: boolean, joinRight: boolean) {
  const left = joinLeft ? 0 : 3;
  const right = joinRight ? 0 : 3;
  const x = cell.x + left;
  const y = cell.y + 3;
  const w = cell.w - left - right;
  const h = cell.h - 4;
  const cut = joinLeft || joinRight ? 2 : 5;
  armor(ctx, x + 1, y + 3, w, h, cut, "#050914");
  armor(ctx, x, y, w, h, cut, accent ? "#3a4d66" : "#232f42");
  armor(ctx, x + (joinLeft ? 0 : 2), y + 2, w - (joinLeft ? 0 : 2) - (joinRight ? 0 : 2), h - 4, cut, "#16243a");
  armor(ctx, x + (joinLeft ? 0 : 4), y + 4, w - (joinLeft ? 0 : 4) - (joinRight ? 0 : 4), h - 9, cut, "#111d30");
  // The repo's colour along the front edge, unbroken along the run; dimmer under a spare.
  if (accent) withAlpha(ctx, lit ? 0.8 : 0.4, () => rect(ctx, x + (joinLeft ? 0 : 6), y + h - 3, w - (joinLeft ? 0 : 6) - (joinRight ? 0 : 6), 1, accent));
  // Floor socket under the chair.
  rect(ctx, cell.x + Math.floor(cell.w / 2) - 7, y + TILE + 18, 14, 2, "#0b1526");
}

/**
 * A repo's sign over its consoles: centred over its run on the innermost tier it takes, above the
 * highest console under it (the tier ahead's names stay clear: tiers are `RING_GAP` rows apart). The
 * full name where it fits (finer letters on big scales) and how many sessions it has; red while
 * one needs you.
 */
function sign(ctx: CanvasRenderingContext2D, office: Office, zone: Zone, scale: number) {
  const run = zone.segments[0];
  if (!run?.length) return;
  const left = run[0].x;
  const right = run[run.length - 1].x + run[run.length - 1].w;
  const accent = TIERS[hash(zone.room.repo_id) % TIERS.length];
  const px = nameDot(scale);
  const urgent = zone.desks.some((d) => d.session.attention === "needs_you" && !d.session.muted && !d.session.archived);
  const color = urgent ? COLOR.needs_you : accent;
  const count = ` ${zone.desks.length + zone.folded.length}`;
  const room = Math.max(right - left, 2 * run[0].w) - 16;
  const name = fit(zone.room.repo_name.toUpperCase(), room - textWidth(count, px), px);
  const width = Math.round(textWidth(name + count, px)) + 14;
  const middle = Math.round((left + right) / 2);
  const x = Math.max(4, Math.min(office.width - 4 - width, middle - Math.floor(width / 2)));
  // Over the consoles right under it: on a curve the run's far end may sit a row higher.
  const under = run.filter((c) => c.x < x + width && x < c.x + c.w);
  const y = Math.min(...(under.length ? under : run).map((c) => c.y)) - 11;
  armor(ctx, x, y, width, 10, 3, urgent ? COLOR.needs_you : "#3a4b61");
  armor(ctx, x + 1, y + 1, width - 2, 8, 2, "#080f1d");
  rect(ctx, x + 3, y + 3, 2, 4, color);
  const ty = y + 2 + (5 - 5 * px) / 2;
  drawText(ctx, name, x + 8, ty, color, px);
  drawText(ctx, count, x + 8 + textWidth(name, px), ty, UI.cyanDim, px);
}

function loungeRug(ctx: CanvasRenderingContext2D, office: Office) {
  const top = (office.bands.lobby.y + WALL_ROWS) * TILE;
  const bottom = (office.bands.lobby.y + office.bands.lobby.h) * TILE;
  // Warm, staggered oak boards. All grain is seeded, never animated.
  rect(ctx, 0, top, office.width, bottom - top, "#302a32");
  for (let y = top; y < bottom; y += 8) {
    const row = (y - top) / 8;
    for (let x = -((row % 2) * 24); x < office.width; x += 48) {
      const seed = x * 17 + row * 31;
      rect(ctx, x + 1, y + 1, 47, 7, ["#393039", "#3d333a", "#352e36"][Math.floor(rand(seed) * 3)]);
      rect(ctx, x + 4, y + 3, 14 + Math.floor(rand(seed + 1) * 22), 1, "#443740");
      rect(ctx, x + 30, y + 6, 10, 1, "#302a32");
    }
  }
  rect(ctx, 0, top, office.width, 3, "#171d2b");
  rect(ctx, 0, top + 3, office.width, 1, "#66504b");
  for (const room of Object.values(office.lounges)) {
    const { x, y, w, h } = room.rect;
    if (!room.premium) {
      rect(ctx, x * TILE, y * TILE, w * TILE, h * TILE, "#242c36");
      for (let row = y; row < y + h; row++) rect(ctx, x * TILE, row * TILE, w * TILE, 1, "#303945");
    } else {
      frameRect(ctx, x * TILE + 3, y * TILE + 3, w * TILE - 6, h * TILE - 6, "#a5814f");
    }
    const label = room.premium ? copy.pixel.principalLounge : copy.pixel.teamLounge;
    rect(ctx, x * TILE + 5, y * TILE + 7, w * TILE - 10, 13, room.premium ? "#201a24" : "#1b222b");
    drawText(ctx, fit(label, w * TILE - 20), x * TILE + 10, y * TILE + 11, room.premium ? "#e5c88d" : "#a6b7c6");
  }
  const left = office.lounges.team.rect;
  const right = office.lounges.principals.rect;
  if (left.y === right.y) {
    rect(ctx, (right.x - 1) * TILE + 3, (left.y + 2) * TILE, TILE - 6, (left.h - 2) * TILE, "#111925");
    rect(ctx, (right.x - 1) * TILE + 5, (left.y + 2) * TILE, 2, (left.h - 2) * TILE, "#796449");
  } else {
    rect(ctx, (left.x + 2) * TILE, (right.y - 1) * TILE + 3, (left.w - 2) * TILE, TILE - 6, "#111925");
  }
  // A woven rug defines each premium seating nook. The team room stays restrained.
  for (const prop of office.props) {
    if (prop.kind !== "sofa" || !prop.premium) continue;
    const x = prop.x * TILE - 6;
    const y = prop.y * TILE - 7;
    const w = 4 * TILE + 10;
    const h = 4 * TILE + 4;
    const warm = (prop.x + prop.y) % 2 === 0;
    const edge = warm ? "#956658" : "#537578";
    const fill = warm ? "#533d42" : "#2b464e";
    rect(ctx, x + 2, y + 3, w, h, "#25232c");
    rect(ctx, x, y, w, h, edge);
    rect(ctx, x + 2, y + 2, w - 4, h - 4, fill);
    frameRect(ctx, x + 5, y + 5, w - 10, h - 10, edge);
    for (let rx = x + 8; rx < x + w - 6; rx += 6) {
      rect(ctx, rx, y - 2, 1, 2, edge);
      rect(ctx, rx, y + h, 1, 2, edge);
      rect(ctx, rx, y + h - 9, 2, 1, edge);
    }
    // Small cross stitches, with low contrast behind the furniture.
    withAlpha(ctx, 0.2, () => {
      for (let rx = x + 10; rx < x + w - 8; rx += 12) {
        for (let ry = y + 12; ry < y + h - 8; ry += 12) {
          rect(ctx, rx, ry, 3, 1, edge);
          rect(ctx, rx + 1, ry - 1, 1, 3, edge);
        }
      }
    });
  }
  // Pools of lamplight stay on the floor, behind furniture and people.
  for (const prop of office.props) {
    if (prop.kind !== "lamp") continue;
    withAlpha(ctx, 0.07, () => {
      rect(ctx, prop.x * TILE - 8, prop.y * TILE - 4, 32, 28, "#ffd18a");
      rect(ctx, prop.x * TILE - 3, prop.y * TILE, 22, 19, "#ffd18a");
    });
  }
  rect(ctx, 0, bottom - 5, office.width, 5, "#171d2b");
  rect(ctx, 0, bottom - 5, office.width, 1, "#66504b");
}

// ---------- Furniture ----------

/**
 * A console nobody sits at, powered off: a repo's spare (where its next session will sit, with a
 * standby light in the repo's colour) or a dark one, waiting for a repo.
 */
function spareConsole(ctx: CanvasRenderingContext2D, r: Rect, accent: string | null, frame: number) {
  const { x, w } = r;
  const top = r.y + 8;
  withAlpha(ctx, accent ? 0.6 : 0.45, () => {
    armor(ctx, x + 1, top - 1, w - 2, 16, 3, UI.metalDark);
    armor(ctx, x + 2, top + 3, w - 4, 9, 2, "#1a2536");
    armor(ctx, x + Math.floor(w / 2) - 8, top - 9, 16, 11, 1, "#101927");
    rect(ctx, x + Math.floor(w / 2) - 7, top - 8, 14, 8, "#05080f");
    withAlpha(ctx, 0.3, () => rect(ctx, x + 1, top + 10, w - 2, 1, UI.cyanDim));
  });
  // Standby: a slow breathing light, so a reserved console reads as ready rather than broken.
  if (accent) withAlpha(ctx, 0.35 + 0.35 * Math.abs(Math.sin((frame + r.x) / 9)), () => rect(ctx, x + Math.floor(w / 2) - 1, top - 5, 2, 2, accent));
  chair(ctx, x + Math.floor(w / 2), top + TILE + 11);
}

function desk(ctx: CanvasRenderingContext2D, d: Desk, st: PaintState) {
  const { x, w } = d.cell;
  const s = d.session;
  const top = d.desk.y;
  withAlpha(ctx, s.archived ? 0.45 : 1, () => {
    // Back housing, sloped work surface, front face with a light strip.
    armor(ctx, x + 1, top - 1, w - 2, 16, 3, UI.metalDark);
    armor(ctx, x + 2, top + 3, w - 4, 9, 2, UI.metalTop);
    rect(ctx, x + 4, top + 3, w - 8, 1, "#576a80");
    rect(ctx, x + 4, top + 10, w - 8, 4, UI.metal);
    for (const vx of [x + 3, x + w - 7]) {
      rect(ctx, vx, top + 11, 3, 1, UI.metalDark);
      rect(ctx, vx, top + 13, 3, 1, UI.metalDark);
    }
    withAlpha(ctx, s.attention === "offline" ? 0.2 : 0.55, () => rect(ctx, x + 1, top + 10, w - 2, 1, UI.cyan));
    withAlpha(ctx, 0.35, () => rect(ctx, x + 1, top + 14, w - 2, 2, "#000"));
    // Blinking indicator lights along the housing.
    if (s.attention !== "offline") {
      for (let i = 0; i < 4; i++) {
        const on = rand(hash(s.id) + i * 13 + Math.floor(st.frame / 3)) > 0.45;
        rect(ctx, x + 4 + i * 3, top + 1, 2, 1, on ? ["#34d399", "#22d3ee", "#fbbf24", "#f87171"][i] : "#1f2937");
      }
    }
    const age = bootAge(s.id, st);
    if (age < BOOT_FRAMES) boot(ctx, d, age);
    else monitor(ctx, x + Math.floor(w / 2) - 8, top - 9, s, st.frame);
    // Angled auxiliary displays flank the central status monitor.
    for (const sx of [x + 3, x + w - 11]) {
      armor(ctx, sx, top - 5, 8, 6, 1, "#101927");
      rect(ctx, sx + 1, top - 4, 6, 3, s.attention === "offline" ? "#080d16" : "#18394a");
      if (s.attention !== "offline") {
        rect(ctx, sx + 2, top - 3, 3, 1, "#50899a");
        rect(ctx, sx + 2, top - 2, 4, 1, "#2c6173");
      }
    }
    // Keyboard.
    rect(ctx, x + Math.floor(w / 2) - 6, top + 6, 12, 2, "#0b0f19");
    withAlpha(ctx, 0.5, () => rect(ctx, x + Math.floor(w / 2) - 6, top + 6, 12, 1, UI.cyanDim));
    // Telemetry of what it has spent: cyan bars for tokens, amber for cost (log scale).
    const tokens = paperStack(s.usage.total_tokens);
    const cost = coinStack(s.usage.cost_usd);
    for (let i = 0; i < 5; i++) {
      rect(ctx, x + 4 + i * 2, top + 8 - i, 1, 1 + i, i < tokens ? UI.cyan : "#1a2438");
      rect(ctx, x + w - 14 + i * 2, top + 8 - i, 1, 1 + i, i < cost ? "#fbbf24" : "#1a2438");
    }
  });
}

/** Frames since this session's console lit up (it lights up the first time it is painted). */
function bootAge(id: string, st: PaintState): number {
  if (!st.litAt) return BOOT_FRAMES;
  if (!st.litAt.has(id)) st.litAt.set(id, st.frame);
  return st.frame - st.litAt.get(id)!;
}

/** A console powering on: the screen flashes, a boot bar fills, and light spreads over its pad. */
function boot(ctx: CanvasRenderingContext2D, d: Desk, age: number) {
  const { x, w } = d.cell;
  const mx = x + Math.floor(w / 2) - 8;
  const my = d.desk.y - 9;
  rect(ctx, mx, my, 16, 11, "#0b101c");
  rect(ctx, mx, my, 16, 1, UI.metalEdge);
  if (age < 3) rect(ctx, mx + 1, my + 1, 14, 9, ["#ffffff", "#bff4ff", "#3fc6e0"][age]);
  else {
    rect(ctx, mx + 1, my + 1, 14, 9, "#06202c");
    rect(ctx, mx + 2, my + 6, 12, 2, "#0b3646");
    rect(ctx, mx + 2, my + 6, Math.round((12 * (age - 3)) / (BOOT_FRAMES - 4)), 2, UI.cyan);
    drawText(ctx, ">", mx + 2, my + 1, "#7dd3fc");
  }
  // A ring of light leaving the console, fading as it grows.
  const grow = age * 2;
  withAlpha(ctx, Math.max(0, 0.7 - age * 0.05), () => frameRect(ctx, x - grow / 2 + 2, d.cell.y + 2 - grow / 2, w - 4 + grow, d.cell.h - 2 + grow, UI.cyan));
}

/** 1–5 sheets: under 1M tokens, 10M, 30M, 100M, more. */
export function paperStack(tokens: number): number {
  if (tokens <= 0) return 0;
  return [1_000_000, 10_000_000, 30_000_000, 100_000_000].filter((t) => tokens >= t).length + 1;
}

/** 1–5 coins: under $1, $5, $20, $50, more; none when there is no price. */
export function coinStack(usd: number): number {
  if (usd <= 0) return 0;
  return [1, 5, 20, 50].filter((t) => usd >= t).length + 1;
}

function monitor(ctx: CanvasRenderingContext2D, x: number, y: number, s: SessionView, frame: number) {
  rect(ctx, x + 6, y + 10, 4, 2, UI.metalDark);
  rect(ctx, x, y, 16, 11, "#0b101c");
  rect(ctx, x, y, 16, 1, UI.metalEdge);
  const sx = x + 1;
  const sy = y + 1;
  const bg = { needs_you: "#4a0f14", finished: "#0b2f4a", working: "#07301a", idle: "#141a2e", offline: "#050608" }[s.attention];
  rect(ctx, sx, sy, 14, 9, stalled(s) ? "#3f2a05" : bg);
  const seed = hash(s.id);
  if (stalled(s)) {
    drawText(ctx, HOURGLASS, sx + 5, sy + 2, frame % 10 < 7 ? STALLED : "#78500a");
  } else if (s.attention === "working") {
    for (let i = 0; i < 4; i++) {
      const indent = 1 + (i % 2) * 2;
      const len = Math.min(13 - indent, 3 + Math.floor(rand(seed + i + Math.floor(frame / 3)) * 9));
      rect(ctx, sx + indent, sy + 1 + i * 2, len, 1, i === 3 ? "#a7f3c9" : "#34d27a");
    }
  } else if (s.attention === "needs_you") {
    if (frame % 8 < 5) drawText(ctx, "!", sx + 5, sy + 2, "#ff8a8a");
  } else if (s.attention === "finished") {
    // A check mark.
    for (const [cx, cy] of [[3, 4], [4, 5], [5, 6], [6, 5], [7, 4], [8, 3], [9, 2]]) rect(ctx, sx + cx, sy + cy, 1, 1, "#7dd3fc");
  } else if (s.attention === "idle") {
    const t = (frame + seed) % 40;
    rect(ctx, sx + 1 + (t < 20 ? t / 2 : 20 - t / 2), sy + 3 + ((t >> 2) % 3), 2, 2, "#475569");
  }
  withAlpha(ctx, 0.25, () => rect(ctx, sx, sy, 14, 1, "#ffffff"));
  // Context used, on the bottom bezel: amber, then red (blinking) before it compacts.
  const ratio = contextRatio(s);
  if (ratio != null && s.attention !== "offline") {
    const level = contextLevel(ratio);
    const color = level === "full" ? (frame % 6 < 3 ? "#f25555" : "#7f1d1d") : level === "warn" ? STALLED : "#34d27a";
    rect(ctx, x + 1, y + 10, 14, 1, "#0b0e16");
    rect(ctx, x + 1, y + 10, Math.max(1, Math.round(14 * ratio)), 1, color);
  }
  if (s.attention === "needs_you" && !s.muted) withAlpha(ctx, frame % 8 < 5 ? 0.65 : 0.3, () => frameRect(ctx, x - 2, y - 2, 20, 15, COLOR.needs_you));
}

/** The subagent an actor stands for (null once the session forgot it). */
export function subagentOf(session: SessionView, actor: Actor): SubagentView | null {
  return session.subagents.find((a) => subagentKey(a.id) === actor.id) ?? null;
}

/**
 * Size of a name's font pixel in art pixels: two screen pixels, so names read at half the art's
 * size (and fit twice the letters) on big scales, and as before on small ones.
 */
export const nameDot = (scale: number) => Math.min(1, 2 / scale);

/** The session's name on the floor, under its chair, on up to two lines (the full title is in the hover tip). */
function nameplate(ctx: CanvasRenderingContext2D, d: Desk, scale: number) {
  const s = d.session;
  const px = nameDot(scale);
  // Drawn over the actors, so it can use the whole cell even with subagents in the aisle.
  const lines = wrap(s.title ?? deskName(s), d.cell.w - 6, 2, px);
  const feet = feetOf(d.seat);
  const color = s.attention === "offline" ? "#475569" : UI.text;
  lines.forEach((line, i) => {
    const w = textWidth(line, px);
    const x = feet.x - Math.floor(w / 2);
    const y = feet.y + 4 + i * 6 * px;
    withAlpha(ctx, 0.7, () => {
      ctx.fillStyle = "#050a14";
      ctx.fillRect(x - 2 * px, y - (i ? 0 : 1), w + 4 * px, 6 * px + (i ? 0 : 1));
    });
    drawText(ctx, line, x, y, color, px);
  });
}

function chair(ctx: CanvasRenderingContext2D, fx: number, fy: number) {
  // Seen from behind: the backrest hides the seated operator's waist.
  rect(ctx, fx - 6, fy - 6, 12, 5, "#1b2233");
  rect(ctx, fx - 6, fy - 6, 12, 1, "#33405e");
  rect(ctx, fx - 6, fy - 5, 1, 4, "#33405e");
  rect(ctx, fx + 5, fy - 5, 1, 4, "#101726");
  withAlpha(ctx, 0.6, () => rect(ctx, fx - 5, fy - 4, 10, 1, UI.cyanDim));
  rect(ctx, fx - 1, fy - 1, 2, 2, "#0b0f19");
  rect(ctx, fx - 4, fy + 1, 2, 1, "#0b0f19");
  rect(ctx, fx + 2, fy + 1, 2, 1, "#0b0f19");
}

function upholstery(prop: Prop) {
  if (!prop.premium) return { back: "#3c4855", light: "#6a7887", cushion: "#4c5a68", dark: "#28333f", seat: "#526170", piping: "#82909d" };
  return { back: "#23433d", light: "#b99965", cushion: "#345b50", dark: "#172f2b", seat: "#416959", piping: "#d3b47b" };
}

function propBack(ctx: CanvasRenderingContext2D, prop: Prop) {
  const x = prop.x * TILE;
  const y = prop.y * TILE;
  const fabric = upholstery(prop);
  switch (prop.kind) {
    case "sofa":
      rect(ctx, x + 3, y + 12, 3, 3, "#171d2b");
      rect(ctx, x + 26, y + 12, 3, 3, "#171d2b");
      rect(ctx, x + 1, y - 2, 30, 9, fabric.back);
      rect(ctx, x + 1, y - 2, 30, 1, fabric.light);
      rect(ctx, x + 3, y, 12, 6, fabric.cushion);
      rect(ctx, x + 17, y, 12, 6, fabric.cushion);
      rect(ctx, x + 15, y, 2, 7, fabric.dark);
      // Piping and small cushions make the sofa read as upholstery rather than a console.
      rect(ctx, x + 4, y + 1, 10, 1, fabric.piping);
      rect(ctx, x + 18, y + 1, 10, 1, fabric.piping);
      rect(ctx, x + 3, y + 3, 5, 4, "#c59774");
      rect(ctx, x + 4, y + 3, 3, 1, "#e4be90");
      rect(ctx, x + 24, y + 3, 4, 5, "#729a91");
      break;
    case "shelf":
      // Walnut bookcase: varied spines, brass shelf edges and a small trailing plant.
      rect(ctx, x + 1, y - 15, 14, 29, "#211e2b");
      rect(ctx, x + 2, y - 14, 12, 26, "#49343a");
      for (let row = 0; row < 3; row++) {
        const yy = y - 12 + row * 8;
        for (let book = 0; book < 4; book++) {
          const height = 4 + ((book + row) % 3);
          const color = ["#cc9272", "#779d94", "#baac82", "#807a9b"][(book + row) % 4];
          rect(ctx, x + 3 + book * 2, yy + 6 - height, 2, height, color);
          rect(ctx, x + 3 + book * 2, yy + 5, 1, 1, "#e2cba0");
        }
        rect(ctx, x + 2, yy + 7, 12, 1, "#ac7757");
      }
      rect(ctx, x + 1, y - 15, 14, 1, "#ac7757");
      break;
    case "arcade":
      // Compact arcade cabinet: stepped silhouette, inset screen and a tiny joystick.
      rect(ctx, x + 2, y - 15, 12, 27, "#302b4b");
      rect(ctx, x + 3, y - 17, 10, 3, "#b16c85");
      rect(ctx, x + 4, y - 16, 8, 1, "#f2b49d");
      rect(ctx, x + 3, y - 12, 10, 10, "#121d30");
      rect(ctx, x + 4, y - 11, 8, 1, "#455271");
      rect(ctx, x + 5, y - 9, 2, 2, "#82c7af");
      rect(ctx, x + 9, y - 6, 2, 1, "#dba477");
      rect(ctx, x + 1, y - 1, 14, 4, "#686084");
      rect(ctx, x + 5, y - 3, 1, 3, "#dda77c");
      rect(ctx, x + 4, y - 3, 3, 1, "#e8a4aa");
      rect(ctx, x + 10, y, 2, 1, "#82c7af");
      rect(ctx, x + 6, y + 5, 4, 2, "#171d2b");
      rect(ctx, x + 3, y + 11, 10, 2, "#171d2b");
      break;
    case "lamp":
      rect(ctx, x + 4, y + 10, 9, 3, "#242330");
      rect(ctx, x + 6, y + 9, 5, 2, "#b08a60");
      rect(ctx, x + 8, y - 9, 1, 19, "#ac8258");
      rect(ctx, x + 4, y - 17, 9, 3, "#dbab73");
      rect(ctx, x + 3, y - 14, 11, 4, "#f3cf91");
      rect(ctx, x + 2, y - 10, 13, 2, "#ffe6ae");
      rect(ctx, x + 5, y - 16, 1, 6, "#ffe6ae");
      break;
    case "coffee":
      rect(ctx, x + 2, y - 8, 12, 20, "#1c2436");
      rect(ctx, x + 2, y - 8, 12, 1, "#3a4868");
      rect(ctx, x + 4, y - 5, 8, 4, "#05080f");
      rect(ctx, x + 5, y - 4, 3, 1, UI.cyan);
      rect(ctx, x + 6, y + 2, 4, 4, "#e8e1d0");
      rect(ctx, x + 10, y + 2, 2, 3, "#b7afa0");
      rect(ctx, x + 4, y + 7, 8, 2, "#0b0f19");
      break;
    case "cooler":
      rect(ctx, x + 4, y - 12, 8, 9, "#67c7ea");
      rect(ctx, x + 5, y - 11, 2, 7, "#bfe9fb");
      rect(ctx, x + 3, y - 3, 10, 15, "#cfd6e2");
      rect(ctx, x + 11, y - 3, 2, 15, "#8e9cb4");
      rect(ctx, x + 5, y + 1, 6, 6, "#27344b");
      rect(ctx, x + 5, y + 1, 2, 1, "#60a5fa");
      rect(ctx, x + 9, y + 1, 2, 1, "#f87171");
      break;
    default:
      break;
  }
}

function propFront(ctx: CanvasRenderingContext2D, prop: Prop) {
  const x = prop.x * TILE;
  const y = prop.y * TILE;
  const fabric = upholstery(prop);
  switch (prop.kind) {
    case "sofa":
      // Seat cushions low enough to show whoever sits there from the chest up.
      rect(ctx, x, y + 10, 32, 4, fabric.seat);
      rect(ctx, x + 2, y + 10, 13, 1, fabric.light);
      rect(ctx, x + 17, y + 10, 13, 1, fabric.light);
      rect(ctx, x, y + 4, 3, 10, fabric.dark);
      rect(ctx, x + 29, y + 4, 3, 10, fabric.dark);
      rect(ctx, x, y + 4, 3, 1, fabric.light);
      rect(ctx, x + 29, y + 4, 3, 1, fabric.light);
      rect(ctx, x + 3, y + 13, 26, 1, "#10323f");
      break;
    case "plant": {
      rect(ctx, x + 7, y - 6, 2, 10, "#246647");
      for (const [lx, ly, lw, lh, color] of [
        [3, -7, 5, 3, "#31875a"], [8, -10, 4, 5, "#46a870"],
        [1, -3, 6, 3, "#246e49"], [9, -4, 5, 3, "#31875a"],
        [4, 0, 4, 2, "#46a870"], [9, 0, 4, 2, "#246e49"],
      ] as const) rect(ctx, x + lx, y + ly, lw, lh, color);
      rect(ctx, x + 4, y + 3, 8, 8, "#1c2436");
      rect(ctx, x + 4, y + 3, 8, 1, "#3a4868");
      rect(ctx, x + 5, y + 4, 2, 6, "#283249");
      break;
    }
    case "table":
      rect(ctx, x + 3, y + 10, 2, 3, "#201e29");
      rect(ctx, x + 12, y + 10, 2, 3, "#201e29");
      rect(ctx, x, y + 2, 16, 9, "#67464a");
      rect(ctx, x, y + 2, 16, 1, "#c08c68");
      rect(ctx, x + 1, y + 3, 14, 5, "#9a6c56");
      rect(ctx, x + 2, y + 4, 6, 3, "#405e6b");
      rect(ctx, x + 3, y + 4, 1, 3, "#8daeb0");
      rect(ctx, x + 2, y + 7, 6, 1, "#d3c3a5");
      rect(ctx, x + 10, y + 4, 3, 3, "#f0dac1");
      rect(ctx, x + 11, y + 4, 1, 1, "#67464a");
      rect(ctx, x + 13, y + 5, 1, 1, "#f0dac1");
      break;
    default:
      break;
  }
}

// ---------- People ----------

function agent(ctx: CanvasRenderingContext2D, actor: Actor, session: SessionView | undefined, st: PaintState) {
  const seed = hash(actor.id);
  const pal = palette(session?.provider ?? "claude", seed);
  const x = Math.round(actor.x) - 6;
  const feet = Math.round(actor.y);
  const typing = session?.attention === "working" && !stalled(session);
  withAlpha(ctx, actor.leaving || session?.archived ? 0.5 : 1, () => {
    // Soft shadow under the feet.
    withAlpha(ctx, 0.3, () => rect(ctx, x + 2, feet - 1, 8, 2, "#000"));
    if (actor.pose === "desk") {
      const sprite = session?.attention === "needs_you" ? waving(Math.floor(st.frame / 3)) : seated(typing, Math.floor(st.frame / 2));
      drawSprite(ctx, sprite, x, feet - 18, pal);
    } else if (actor.pose === "sofa") {
      drawSprite(ctx, lounging, x, feet - 16, pal);
    } else {
      const walking = actor.pose === "walk";
      const bob = walking && Math.floor(actor.walked / 4) % 2 === 1 ? -1 : 0;
      drawSprite(ctx, body(actor.dir, walking, Math.floor(actor.walked / 4)), x, feet - 17 + bob, pal, actor.dir === "left");
    }
  });
}

/** Teammates use the same body and poses as the principal. */
function teammate(ctx: CanvasRenderingContext2D, actor: Actor, session: SessionView, subagent: SubagentView | null, st: PaintState) {
  agent(ctx, actor, session, st);
  const id = subagent?.id;
  if (id && (st.selectedAgent === id || st.hoveredAgent === id)) {
    frameRect(ctx, Math.round(actor.x) - 7, Math.round(actor.y) - 19, 14, 20, st.selectedAgent === id ? "#facc15" : "#ffffffaa");
  }
}

/** Filing cabinet of a busy repo's closed sessions, with how many there are. */
function cabinet(ctx: CanvasRenderingContext2D, zone: Zone, st: PaintState) {
  const x = zone.cabinet!.x * TILE + 2;
  const y = zone.cabinet!.y * TILE - 6;
  withAlpha(ctx, 0.3, () => rect(ctx, x + 1, y + 21, 12, 2, "#000"));
  rect(ctx, x, y, 12, 21, UI.metal);
  rect(ctx, x, y, 12, 1, UI.metalEdge);
  for (let i = 0; i < 3; i++) {
    rect(ctx, x + 1, y + 2 + i * 6, 10, 5, UI.metalDark);
    rect(ctx, x + 4, y + 4 + i * 6, 4, 1, UI.cyanDim);
  }
  const label = `+${zone.folded.length}`;
  rect(ctx, x + 12 - textWidth(label) - 1, y - 8, textWidth(label) + 3, 7, "#1b1523");
  drawText(ctx, label, x + 13 - textWidth(label), y - 7, "#e5e7eb");
  if (st.hoveredCabinet === zone.room.repo_id) frameRect(ctx, x - 2, y - 10, 16, 34, "#ffffffaa");
}

/** What a running subagent is doing: $ command, R read, E edit, S search, W web, A delegate. */
export function toolGlyph(tool: string | null): string | null {
  const name = (tool ?? "").split("·")[0].trim().toLowerCase();
  if (!name || /todo/.test(name)) return null;
  if (/web|fetch|browser|url/.test(name)) return "W";
  if (/bash|shell|run_command|exec|command/.test(name)) return "$";
  if (/edit|write|replace|patch|notebook|delete/.test(name)) return "E";
  if (/grep|glob|search|find|list|ls/.test(name)) return "S";
  if (/read|view|open/.test(name)) return "R";
  if (/task|agent|spawn/.test(name)) return "A";
  return null;
}

function toolBubble(ctx: CanvasRenderingContext2D, agent: SubagentView, fx: number, fy: number, frame: number, side: "left" | "right" | null) {
  const glyph = toolGlyph(agent.last_tool);
  if (!glyph) return;
  const bob = (frame + hash(agent.id)) % 6 < 3 ? -1 : 0;
  const x = Math.round(side === "right" ? fx + 4 : side === "left" ? fx - 11 : fx - 3);
  const y = Math.round((side ? fy - 21 : fy - 26) + bob);
  // Secondary information: a dim chip, never as loud as the attention bubbles.
  withAlpha(ctx, 0.85, () => {
    rect(ctx, x, y, 7, 7, "#0b1220");
    frameRect(ctx, x, y, 7, 7, "#334155");
    drawText(ctx, glyph, x + 2, y + 1, glyph === "$" ? "#4ade80" : "#94a3b8");
  });
}

/** What the agent is saying, above its head. */
function chatting(actor: Actor, st: PaintState): boolean {
  return actor.pose === "stand" && [...st.actors.values()].some((other) => other.id !== actor.id && other.pose === "stand"
    && Math.abs(other.y - actor.y) < 3 && Math.abs(other.x - actor.x) <= TILE + 1
    && (actor.dir === "right" ? other.x > actor.x && other.dir === "left" : actor.dir === "left" && other.x < actor.x && other.dir === "right"));
}

function bubble(ctx: CanvasRenderingContext2D, actor: Actor, s: SessionView, frame: number, talking: boolean) {
  if (actor.pose === "walk") return;
  const top = Math.round(actor.y) - (actor.pose === "desk" ? 18 : actor.pose === "sofa" ? 16 : 17) - 11;
  // Beside the waving hand when it needs you, above the head otherwise.
  const x = Math.round(actor.x) - 4 - (s.attention === "needs_you" && actor.pose === "desk" ? 6 : 0);
  let text: string | null = null;
  let color = "#1b1523";
  if (s.muted) [text, color] = ["ZZ", "#64748b"];
  else if (s.attention === "needs_you") [text, color] = ["!", COLOR.needs_you];
  else if (stalled(s)) [text, color] = [HOURGLASS, STALLED];
  else if (s.attention === "finished" && !s.archived) [text, color] = [copy.pixel.finishedBubble, "#0284c7"];
  // Chatting in the lounge: now and then one of the pair says something.
  else if (talking && (frame + (actor.dir === "left" ? 20 : 0)) % 40 < 12) {
    [text, color] = ["...", "#475569"];
  }
  if (!text) return;
  const bounce = s.attention === "needs_you" && frame % 6 < 3 ? -1 : 0;
  const w = Math.max(9, textWidth(text) + 5);
  const bx = x + 4 - Math.floor(w / 2) + 1;
  const by = top + bounce;
  rect(ctx, bx, by, w, 9, "#1b1523");
  rect(ctx, bx + 1, by + 1, w - 2, 7, "#fdfcf7");
  rect(ctx, x + 4, by + 9, 2, 1, "#1b1523");
  rect(ctx, x + 4, by + 8, 2, 1, "#fdfcf7");
  drawText(ctx, text, bx + Math.floor((w - textWidth(text)) / 2) + 1, by + 2, color);
}

/**
 * One light per running subagent on the console's front, however many there are: two of them
 * stand by the chair, the rest are only lights, so a big squad never spills onto the floor. Past
 * what the console holds, the last light becomes the count.
 */
function squadRack(ctx: CanvasRenderingContext2D, d: Desk, frame: number) {
  const running = d.session.subagents.filter((a) => a.running);
  if (running.length === 0) return;
  const { x, w } = d.cell;
  const y = d.desk.y + 11;
  const room = Math.floor((w - 8) / 3);
  const shown = running.length > room ? room - 3 : running.length;
  rect(ctx, x + 3, y - 1, Math.min(shown, room) * 3 + 1, 4, "#050a14");
  for (let i = 0; i < shown; i++) {
    const on = (frame + i * 3 + hash(running[i].id)) % 12 < 9;
    rect(ctx, x + 4 + i * 3, y, 2, 2, on ? "#34d399" : "#14532d");
  }
  if (shown < running.length) {
    const label = `+${running.length - shown}`;
    const lx = x + 4 + shown * 3;
    rect(ctx, lx - 1, y - 2, textWidth(label) + 2, 7, "#050a14");
    drawText(ctx, label, lx, y - 1, "#a7f3c9");
  }
}

function marks(ctx: CanvasRenderingContext2D, d: Desk, st: PaintState) {
  const id = d.session.id;
  squadRack(ctx, d, st.frame);
  if (st.selected !== id && st.hovered !== id) return;
  const { x, y, w, h } = d.cell;
  const color = st.selected === id ? (st.frame % 8 < 5 ? "#facc15" : "#fde68a") : "#ffffff99";
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w - 1, y, -1, 1],
    [x, y + h - 1, 1, -1],
    [x + w - 1, y + h - 1, -1, -1],
  ]) {
    rect(ctx, cx + (dx < 0 ? -3 : 0), cy, 4, 1, color);
    rect(ctx, cx, cy + (dy < 0 ? -3 : 0), 1, 4, color);
  }
}
