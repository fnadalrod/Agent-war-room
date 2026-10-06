// Pixel-art painting of the office. Logical coordinates; the canvas is scaled with `pixelated`.
import type { AttentionView, SessionView, SubagentView } from "../../domain/attention";
import { contextLevel, contextRatio, deskName, tokenCount } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { drawText, fit, textWidth } from "./font";
import { type Desk, type Office, type Prop, type Rect, type Zone, TILE, WALL_ROWS, WAR_WALL_ROWS, feetOf } from "./office";
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
  /** Titles of what needs you, for the wall board ticker. */
  alerts: string[];
  /** Today's tokens and cost, already formatted ("324M $135"), for the board. */
  today: string | null;
  /** The cabinet under the cursor, to highlight it. */
  hoveredCabinet: string | null;
  /** The doorway between the rooms is under the cursor. */
  hoveredDoor: boolean;
  actors: Map<string, Actor>;
};

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
  for (const zone of office.zones) rug(ctx, zone, TIERS[hash(zone.room.repo_id) % TIERS.length]);

  // Everything that stands on the floor, back to front.
  const drawables: Array<{ y: number; draw: () => void }> = [];
  for (const zone of office.zones) {
    for (const d of zone.desks) {
      drawables.push({ y: d.desk.y + d.desk.h, draw: () => desk(ctx, d, st) });
      const seatFeet = feetOf(d.seat);
      drawables.push({ y: seatFeet.y + 0.5, draw: () => chair(ctx, seatFeet.x, seatFeet.y) });
      drawables.push({ y: seatFeet.y + 0.6, draw: () => nameplate(ctx, d, st.scale) });
    }
  }
  for (const zone of office.zones) {
    if (zone.cabinet) drawables.push({ y: zone.cabinet.y * TILE + TILE - 1, draw: () => cabinet(ctx, zone, st) });
  }
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
  // Recessed service channels link the command decks to the wall.
  for (const zone of office.zones) {
    const x = zone.rect.x * TILE + 7;
    const y = zone.rect.y * TILE;
    rect(ctx, x, WAR_WALL_ROWS * TILE, 3, y - WAR_WALL_ROWS * TILE, "#070d19");
    withAlpha(ctx, 0.3, () => rect(ctx, x + 1, WAR_WALL_ROWS * TILE, 1, y - WAR_WALL_ROWS * TILE, TIERS[hash(zone.room.repo_id) % TIERS.length]));
  }
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

  // The screen wall: telemetry on the left, the main screen, mission clock on the right.
  const main = Math.min(240, Math.floor(office.width * 0.52));
  const mainX = Math.floor((office.width - main) / 2);
  const side = Math.min(90, mainX - 30);
  armor(ctx, mainX - 5, 7, main + 10, h - 15, 5, UI.metalEdge);
  mainScreen(ctx, office, mainX, 11, main, h - 25, st);
  if (side >= 44) {
    // The entrance occupies the left wall: keep the screen frame clear at narrow widths.
    const leftSide = Math.min(side, mainX - 6 - ((office.door.x + 1) * TILE + 4));
    if (leftSide >= 32) telemetry(ctx, mainX - leftSide - 6, 16, leftSide, h - 36, st);
    missionClock(ctx, mainX + main + 6, 16, side, h - 36, st.now);
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

function mainScreen(ctx: CanvasRenderingContext2D, office: Office, x: number, y: number, w: number, h: number, st: PaintState) {
  screenFrame(ctx, x, y, w, h);
  // Tactical map: concentric pixel rings with repository nodes and a slow sweep.
  const cx = x + Math.floor(w / 2);
  const cy = y + 31;
  const radius = Math.max(4, Math.floor((h - 28) / 2));
  withAlpha(ctx, 0.45, () => {
    for (let gx = x + 4; gx < x + w - 2; gx += 8) {
      for (let gy = y + 20; gy < y + h - 11; gy += 5) rect(ctx, gx, gy, 1, 1, UI.cyanDim);
    }
    for (const r of [radius, Math.max(2, radius - 5)]) {
      for (let angle = 0; angle < 360; angle += 5) {
        const rad = angle * Math.PI / 180;
        rect(ctx, cx + Math.round(Math.cos(rad) * r * 2), cy + Math.round(Math.sin(rad) * r * 0.65), 1, 1, UI.cyanDim);
      }
    }
    rect(ctx, cx - radius * 2 - 5, cy, radius * 4 + 10, 1, UI.cyanDim);
  });
  const sweep = (st.frame % 80) / 80 * Math.PI * 2;
  for (let i = 0; i <= radius; i++) rect(ctx, cx + Math.round(Math.cos(sweep) * i * 2), cy + Math.round(Math.sin(sweep) * i * 0.65), 1, 1, "#55b5bf");
  office.zones.forEach((zone, i) => {
    const angle = (i / Math.max(1, office.zones.length)) * Math.PI * 2;
    const nx = cx + Math.round(Math.cos(angle) * radius * 1.7);
    const ny = cy + Math.round(Math.sin(angle) * radius * 0.55);
    rect(ctx, nx - 1, ny - 1, 3, 3, TIERS[hash(zone.room.repo_id) % TIERS.length]);
    rect(ctx, nx, ny, 1, 1, "#dffaff");
  });
  // Edge telemetry makes the display read as one integrated command wall.
  for (let i = 0; i < 5; i++) {
    const len = 5 + Math.floor(rand(i + 8) * Math.max(5, w / 5 - 12));
    rect(ctx, x + 7, y + 21 + i * 3, len, 1, i % 2 ? UI.cyanDim : "#41617b");
    rect(ctx, x + w - 7 - len, y + 21 + i * 3, len, 1, i % 2 ? "#41617b" : UI.cyanDim);
  }
  drawText(ctx, copy.pixel.title, x + Math.floor((w - textWidth(copy.pixel.title)) / 2), y + 3, UI.text);
  const counts = { needs_you: 0, finished: 0, working: 0 } as Record<string, number>;
  for (const zone of office.zones) for (const d of zone.desks) if (!d.session.archived && d.session.attention in counts) counts[d.session.attention]++;
  const parts: Array<[string, string]> = [
    [`! ${counts.needs_you}`, COLOR.needs_you],
    [`OK ${counts.finished}`, COLOR.finished],
    [`>> ${counts.working}`, COLOR.working],
  ];
  const total = parts.reduce((sum, [t]) => sum + textWidth(t), 0) + 12 * (parts.length - 1);
  let tx = x + Math.floor((w - total) / 2);
  for (const [text, color] of parts) {
    drawText(ctx, text, tx, y + 11, color);
    tx += textWidth(text) + 12;
  }
  // Ticker of what needs you, or all quiet.
  const ticker = st.alerts.length ? st.alerts.join("  ·  ") : copy.pixel.allQuiet;
  const color = st.alerts.length ? (st.frame % 10 < 6 ? COLOR.needs_you : "#fca5a5") : "#3b8aa0";
  if (st.alerts.length) withAlpha(ctx, st.frame % 10 < 6 ? 0.25 : 0.1, () => rect(ctx, x, y + h - 9, w, 9, COLOR.needs_you));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + h - 8, w - 4, 7);
  ctx.clip();
  const tw = textWidth(ticker);
  const tx0 = st.alerts.length && tw > w - 8 ? x + w - ((st.frame * 1.5) % (tw + w)) : x + Math.floor((w - tw) / 2);
  drawText(ctx, ticker, tx0, y + h - 7, color);
  ctx.restore();
  withAlpha(ctx, 0.12, () => rect(ctx, x - 6, y + h + 2, w + 12, 3, UI.cyan));
}

/** Left screen: today's usage and a live-looking bar graph. */
function telemetry(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, st: PaintState) {
  screenFrame(ctx, x, y, w, h);
  drawText(ctx, copy.pixel.today, x + 3, y + 3, UI.cyanDim);
  if (st.today) drawText(ctx, fit(st.today, w - 6), x + 3, y + 10, "#fcd34d");
  for (let i = 0; i < Math.floor((w - 6) / 4); i++) {
    const bh = 2 + Math.floor(rand(i * 7 + Math.floor(st.frame / 4)) * (h - 20));
    rect(ctx, x + 3 + i * 4, y + h - 2 - bh, 3, bh, i % 5 === 0 ? "#fcd34d" : UI.cyanDim);
  }
}

/** Right screen: the time, like a mission clock. */
function missionClock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, now: Date) {
  screenFrame(ctx, x, y, w, h);
  drawText(ctx, "MET", x + 3, y + 3, UI.cyanDim);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  drawText(ctx, time, x + Math.floor((w - textWidth(time)) / 2), y + Math.floor(h / 2) - 2, "#34d399");
  // Blinking status lights.
  for (let i = 0; i < 6; i++) rect(ctx, x + 4 + i * 6, y + h - 5, 3, 2, rand(i + now.getSeconds()) > 0.4 ? "#34d399" : "#064e3b");
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

/** Each repo is a bank of armored command decks, shaped by its occupied console rows. */
function rug(ctx: CanvasRenderingContext2D, zone: Zone, accent: string) {
  const r: Rect = zone.rect;
  const tokens = zone.room.sessions.reduce((n, s) => n + s.usage.total_tokens, 0);
  const rows = new Map<number, Desk[]>();
  for (const desk of zone.desks) {
    const row = rows.get(desk.cell.y) ?? [];
    row.push(desk);
    rows.set(desk.cell.y, row);
  }
  for (const desks of rows.values()) {
    const first = desks[0].cell;
    const last = desks[desks.length - 1].cell;
    const x = first.x - 12;
    const y = first.y - 4;
    const w = last.x + last.w + 2 - x;
    const h = first.h + 2;
    // Stepped armor, a recessed deck and an exposed front fascia.
    armor(ctx, x + 2, y + 5, w, h, 8, "#050914");
    armor(ctx, x, y + 2, w, h, 8, "#283950");
    armor(ctx, x, y, w, h - 3, 8, "#40546b");
    armor(ctx, x + 2, y + 2, w - 4, h - 7, 7, "#1a2a3e");
    armor(ctx, x + 5, y + 5, w - 10, h - 13, 5, "#122033");
    // Short strips follow the cut corners; the centre remains a clear entry ramp.
    const centre = Math.floor(x + w / 2);
    rect(ctx, x + 9, y + h - 4, Math.max(0, centre - x - 17), 1, accent);
    rect(ctx, centre + 8, y + h - 4, Math.max(0, x + w - centre - 17), 1, accent);
    for (let step = 0; step < 3; step++) {
      rect(ctx, centre - 7 - step, y + h - 6 + step * 2, 14 + step * 2, 1, "#58677a");
    }
    for (const desk of desks) {
      const feet = feetOf(desk.seat);
      // Floor sockets under each operator; subtle enough to preserve name readability.
      rect(ctx, feet.x - 8, feet.y - 3, 16, 2, "#0b1526");
      rect(ctx, desk.cell.x + 3, y + h - 11, 5, 1, "#354a61");
      rect(ctx, desk.cell.x + desk.cell.w - 6, y + h - 11, 3, 1, "#354a61");
    }
    // Flush side panels: bolts, vents and the sector's colour strip.
    rect(ctx, x + 3, y + 12, 4, h - 30, "#0a1423");
    rect(ctx, x + 4, y + 14, 1, 9, accent);
    for (let vy = y + 27; vy < y + h - 16; vy += 3) rect(ctx, x + 4, vy, 2, 1, "#455a70");
    for (const bx of [x + 8, x + w - 9]) {
      rect(ctx, bx, y + 4, 2, 1, "#9aafbd");
      rect(ctx, bx, y + h - 9, 2, 1, "#9aafbd");
    }
  }
  // Cabinet-only repositories still have a small equipment landing.
  if (!rows.size) armor(ctx, r.x * TILE + 3, r.y * TILE + 5, r.w * TILE - 6, r.h * TILE - 9, 7, "#1a2a3e");
  const x = r.x * TILE + 5;
  const y = r.y * TILE - 5;
  const label = fit(`${zone.room.repo_name.toUpperCase()} ${zone.desks.length + zone.folded.length}${tokens > 0 ? ` · ${tokenCount(tokens).toUpperCase()}` : ""}`, r.w * TILE - 23);
  const width = textWidth(label) + 16;
  armor(ctx, x, y, width, 11, 3, "#3a4b61");
  armor(ctx, x + 1, y + 1, width - 2, 9, 2, "#080f1d");
  rect(ctx, x + 3, y + 3, 2, 5, accent);
  drawText(ctx, label, x + 9, y + 3, accent);
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

/** A console: one per seat, cell-wide, so a row of them reads as one continuous bank. */
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
    monitor(ctx, x + Math.floor(w / 2) - 8, top - 9, s, st.frame);
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
    drawText(ctx, "?", sx + 5, sy + 2, frame % 10 < 7 ? STALLED : "#78500a");
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

/** The session's name on the floor, under its chair (the full title is in the hover tip). */
function nameplate(ctx: CanvasRenderingContext2D, d: Desk, scale: number) {
  const s = d.session;
  const px = nameDot(scale);
  // Subagents walk round the chair and through the aisle corners: leave them room.
  const crowded = s.subagents.some((a) => a.running);
  const name = fit((s.title ?? deskName(s)).toUpperCase(), d.cell.w - (crowded ? 20 : 10), px);
  const feet = feetOf(d.seat);
  const w = textWidth(name, px);
  const x = feet.x - Math.floor(w / 2);
  withAlpha(ctx, 0.7, () => {
    ctx.fillStyle = "#050a14";
    ctx.fillRect(x - 2 * px, feet.y + 3, w + 4 * px, 2 + 5 * px);
  });
  drawText(ctx, name, x, feet.y + 4, s.attention === "offline" ? "#475569" : UI.text, px);
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
  rect(ctx, x, y, 7, 7, "#1b1523");
  rect(ctx, x + 1, y + 1, 5, 5, "#fdfcf7");
  if (side === "right") rect(ctx, x - 1, y + 4, 1, 1, "#1b1523");
  else if (side === "left") rect(ctx, x + 7, y + 4, 1, 1, "#1b1523");
  else rect(ctx, x + 3, y + 7, 1, 1, "#1b1523");
  drawText(ctx, glyph, x + 2, y + 1, glyph === "$" ? "#15803d" : "#1b1523");
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
  else if (stalled(s)) [text, color] = ["?", STALLED];
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

function marks(ctx: CanvasRenderingContext2D, d: Desk, st: PaintState) {
  const id = d.session.id;
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
  const more = d.session.subagents.filter((a) => a.running).length - d.slots.length;
  if (more > 0) drawText(ctx, `+${more}`, x + w - 12, y + h - 7, "#e5e7eb");
}
