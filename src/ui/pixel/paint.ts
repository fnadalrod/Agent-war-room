// Pixel-art painting of the office. Logical coordinates; the canvas is scaled with `pixelated`.
import type { AttentionView, SessionView, SubagentView } from "../../domain/attention";
import { contextLevel, contextRatio, deskName, tokenCount } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { drawText, fit, textWidth } from "./font";
import { type Desk, type Office, type Prop, type Rect, type Zone, TILE, WALL_ROWS, feetOf } from "./office";
import { type Actor, hash, subagentKey } from "./sim";
import { MINI, body, drawSprite, lounging, palette, seated, waving } from "./sprites";

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
  for (const zone of office.zones) rug(ctx, zone, TIERS[hash(zone.room.repo_id) % TIERS.length]);
  loungeRug(ctx, office);

  // Everything that stands on the floor, back to front.
  const drawables: Array<{ y: number; draw: () => void }> = [];
  const seatedAt = new Set<string>();
  for (const actor of st.actors.values()) if (actor.pose === "desk") seatedAt.add(actor.id);
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
    drawables.push({ y: top + 5, draw: () => propBack(ctx, prop, st.frame) });
    drawables.push({ y: top + TILE - 2.5, draw: () => propFront(ctx, prop, st.frame) });
  }
  const sessions = new Map(office.zones.flatMap((z) => z.desks.map((d) => [d.session.id, d.session] as const)));
  for (const actor of st.actors.values()) {
    if (actor.owner != null) {
      const session = sessions.get(actor.owner);
      if (session) drawables.push({ y: actor.y, draw: () => mini(ctx, actor, session, subagentOf(session, actor), st) });
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
      if (session) bubble(ctx, actor, session, st.frame);
      continue;
    }
    const session = sessions.get(actor.owner);
    const agent = session && subagentOf(session, actor);
    const seat = seats.get(actor.owner);
    // In the aisle the bubble goes to the outer side, clear of the names.
    const side = seat && actor.y > seat.y ? (actor.x < seat.x ? "left" : "right") : null;
    if (agent?.running && actor.pose !== "walk") toolBubble(ctx, agent, actor.x, actor.y, st.frame, side);
  }
  for (const zone of office.zones) for (const d of zone.desks) marks(ctx, d, st);
}

// ---------- Room ----------

function floor(ctx: CanvasRenderingContext2D, office: Office) {
  rect(ctx, 0, 0, office.width, office.height, UI.floor);
  // Floor panels with seams, and a faint light grid every fourth panel.
  for (let r = WALL_ROWS; r < office.rows; r++) {
    for (let c = 0; c < office.cols; c++) {
      const x = c * TILE;
      const y = r * TILE;
      if ((r + c) % 2 === 0) rect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, UI.panel);
      rect(ctx, x, y, TILE, 1, UI.seam);
      rect(ctx, x, y, 1, TILE, UI.seam);
    }
  }
  withAlpha(ctx, 0.08, () => {
    for (let c = 0; c < office.cols; c += 4) rect(ctx, c * TILE, WALL_ROWS * TILE, 1, office.height, UI.cyan);
    for (let r = WALL_ROWS; r < office.rows; r += 4) rect(ctx, 0, r * TILE, office.width, 1, UI.cyan);
  });
  // The light of the screen wall falls on the front rows.
  for (let i = 0; i < 6; i++) withAlpha(ctx, 0.05 - i * 0.008, () => rect(ctx, 0, WALL_ROWS * TILE + i * 6, office.width, 6, UI.cyan));
  // Vignette at the sides.
  withAlpha(ctx, 0.35, () => {
    rect(ctx, 0, WALL_ROWS * TILE, 4, office.height, "#000");
    rect(ctx, office.width - 4, WALL_ROWS * TILE, 4, office.height, "#000");
  });
}

function wall(ctx: CanvasRenderingContext2D, office: Office, st: PaintState) {
  const h = WALL_ROWS * TILE;
  rect(ctx, 0, 0, office.width, h, UI.wall);
  for (let x = 0; x < office.width; x += 24) rect(ctx, x, 0, 1, h, UI.wallPanel);
  // Ceiling lights.
  for (let x = 12; x < office.width; x += 48) withAlpha(ctx, 0.6, () => rect(ctx, x, 1, 18, 1, "#7dd3fc"));

  // The screen wall: telemetry on the left, the main screen, mission clock on the right.
  const main = Math.min(190, Math.floor(office.width * 0.5));
  const mainX = Math.floor((office.width - main) / 2);
  const side = Math.min(90, mainX - 30);
  mainScreen(ctx, office, mainX, 5, main, h - 12, st);
  if (side >= 44) {
    telemetry(ctx, mainX - side - 6, 9, side, h - 20, st);
    missionClock(ctx, mainX + main + 6, 9, side, h - 20, st.now);
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
  // A trajectory over a dotted grid, drawn a little more every frame.
  withAlpha(ctx, 0.35, () => {
    for (let gx = x + 4; gx < x + w - 2; gx += 8) for (let gy = y + 3; gy < y + h - 2; gy += 6) rect(ctx, gx, gy, 1, 1, UI.cyanDim);
  });
  const lead = (st.frame * 2) % (w - 8);
  for (let i = 0; i < w - 8; i++) {
    const py = y + Math.floor(h / 2) + Math.round(Math.sin((i / (w - 8)) * Math.PI * 2) * (h / 4));
    if (i <= lead) withAlpha(ctx, 0.25 + 0.75 * (i / Math.max(1, lead)), () => rect(ctx, x + 4 + i, py, 1, 1, UI.cyan));
    if (i === lead) rect(ctx, x + 3 + i, py - 1, 3, 3, "#e0f7ff");
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

/** Each repo is a raised tier with a lit front edge and an illuminated sign. */
function rug(ctx: CanvasRenderingContext2D, zone: Zone, accent: string) {
  const r: Rect = zone.rect;
  const name = zone.room.repo_name;
  const count = zone.desks.length + zone.folded.length;
  const tokens = zone.room.sessions.reduce((n, s) => n + s.usage.total_tokens, 0);
  const x = r.x * TILE + 2;
  const y = r.y * TILE + 4;
  const w = r.w * TILE - 4;
  const h = r.h * TILE - 6;
  rect(ctx, x, y, w, h, "#142038");
  rect(ctx, x, y, w, 1, "#2a3a5e");
  // Step down at the front, with the tier's light.
  rect(ctx, x, y + h, w, 3, "#070b14");
  withAlpha(ctx, 0.7, () => rect(ctx, x, y + h, w, 1, accent));
  withAlpha(ctx, 0.15, () => rect(ctx, x, y + h + 3, w, 3, accent));
  // Sign.
  const label = fit(`${name.toUpperCase()} ${count}${tokens > 0 ? ` · ${tokenCount(tokens).toUpperCase()}` : ""}`, w - 10);
  const lw = textWidth(label) + 8;
  rect(ctx, x + 3, y - 8, lw, 9, "#050a14");
  frameRect(ctx, x + 3, y - 8, lw, 9, accent);
  drawText(ctx, label, x + 7, y - 6, accent);
}

function loungeRug(ctx: CanvasRenderingContext2D, office: Office) {
  // The crew lounge: a softer, darker area behind the consoles.
  const r = office.lounge;
  const y = r.y * TILE - 10;
  const h = r.h * TILE + 8;
  rect(ctx, r.x * TILE + 6, y, r.w * TILE - 12, h, "#0f1a2a");
  withAlpha(ctx, 0.5, () => frameRect(ctx, r.x * TILE + 6, y, r.w * TILE - 12, h, "#1f3b4d"));
  withAlpha(ctx, 0.35, () => rect(ctx, r.x * TILE + 6, y, r.w * TILE - 12, 1, UI.cyan));
}

// ---------- Furniture ----------

/** A console: one per seat, cell-wide, so a row of them reads as one continuous bank. */
function desk(ctx: CanvasRenderingContext2D, d: Desk, st: PaintState) {
  const { x, w } = d.cell;
  const s = d.session;
  const top = d.desk.y;
  withAlpha(ctx, s.archived ? 0.45 : 1, () => {
    // Back housing, sloped work surface, front face with a light strip.
    rect(ctx, x + 1, top, w - 2, 4, UI.metalDark);
    rect(ctx, x + 1, top + 4, w - 2, 6, UI.metalTop);
    rect(ctx, x + 1, top + 4, w - 2, 1, UI.metalEdge);
    rect(ctx, x + 1, top + 10, w - 2, 4, UI.metal);
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
      const len = 3 + Math.floor(rand(seed + i + Math.floor(frame / 3)) * 9);
      rect(ctx, sx + 1 + (i % 2) * 2, sy + 1 + i * 2, len, 1, i === 3 ? "#a7f3c9" : "#34d27a");
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
  if (s.attention === "needs_you" && !s.muted) withAlpha(ctx, frame % 8 < 5 ? 0.35 : 0.15, () => rect(ctx, x - 2, y - 2, 20, 15, COLOR.needs_you));
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
  withAlpha(ctx, 0.6, () => rect(ctx, fx - 5, fy - 4, 10, 1, UI.cyanDim));
  rect(ctx, fx - 1, fy - 1, 2, 2, "#0b0f19");
  rect(ctx, fx - 4, fy + 1, 2, 1, "#0b0f19");
  rect(ctx, fx + 2, fy + 1, 2, 1, "#0b0f19");
}

function propBack(ctx: CanvasRenderingContext2D, prop: Prop, frame = 0) {
  const x = prop.x * TILE;
  const y = prop.y * TILE;
  switch (prop.kind) {
    case "sofa":
      rect(ctx, x + 1, y - 2, 30, 9, "#134e5e");
      rect(ctx, x + 1, y - 2, 30, 1, "#1f7a8f");
      break;
    case "shelf":
      // A server rack, lights blinking.
      rect(ctx, x + 1, y - 14, 14, 28, "#0b0f19");
      frameRect(ctx, x + 1, y - 14, 14, 28, "#26324a");
      for (let row = 0; row < 8; row++) {
        rect(ctx, x + 3, y - 12 + row * 3, 10, 2, "#161d2c");
        rect(ctx, x + 10, y - 12 + row * 3, 1, 1, rand(prop.x * 31 + row + Math.floor(frame / 2)) > 0.4 ? "#34d399" : "#0f3b2c");
        rect(ctx, x + 12, y - 12 + row * 3, 1, 1, rand(prop.x * 17 + row * 3 + Math.floor(frame / 3)) > 0.7 ? "#fbbf24" : "#3b2f0f");
      }
      break;
    case "coffee":
      rect(ctx, x + 2, y - 8, 12, 20, "#1c2436");
      rect(ctx, x + 2, y - 8, 12, 1, "#3a4868");
      rect(ctx, x + 4, y - 5, 8, 4, "#05080f");
      rect(ctx, x + 5, y - 4, 3, 1, UI.cyan);
      rect(ctx, x + 6, y + 2, 4, 4, "#e8e1d0");
      break;
    case "cooler":
      rect(ctx, x + 4, y - 12, 8, 9, "#67c7ea");
      rect(ctx, x + 5, y - 11, 2, 7, "#bfe9fb");
      rect(ctx, x + 3, y - 3, 10, 15, "#cfd6e2");
      break;
    default:
      break;
  }
}

function propFront(ctx: CanvasRenderingContext2D, prop: Prop, frame = 0) {
  const x = prop.x * TILE;
  const y = prop.y * TILE;
  switch (prop.kind) {
    case "sofa":
      // Seat cushions low enough to show whoever sits there from the chest up.
      rect(ctx, x, y + 10, 32, 4, "#176173");
      rect(ctx, x + 2, y + 10, 13, 1, "#1d7d93");
      rect(ctx, x + 17, y + 10, 13, 1, "#1d7d93");
      rect(ctx, x, y + 4, 3, 10, "#0f3f4c");
      rect(ctx, x + 29, y + 4, 3, 10, "#0f3f4c");
      rect(ctx, x, y + 4, 3, 1, "#1d7d93");
      rect(ctx, x + 29, y + 4, 3, 1, "#1d7d93");
      break;
    case "plant": {
      const leaf = ["#2f8f5a", "#46a870", "#1f6f45"];
      for (let i = 0; i < 9; i++) rect(ctx, x + 3 + ((i * 5) % 10), y - 8 + ((i * 3) % 9), 3, 3, leaf[i % 3]);
      rect(ctx, x + 4, y + 3, 8, 8, "#1c2436");
      rect(ctx, x + 4, y + 3, 8, 1, "#3a4868");
      break;
    }
    case "table":
      // A holo table: a slowly turning planet.
      rect(ctx, x + 1, y + 5, 14, 5, "#1c2436");
      rect(ctx, x + 1, y + 5, 14, 1, "#3a4868");
      withAlpha(ctx, 0.35 + 0.15 * Math.sin(frame / 3), () => {
        rect(ctx, x + 4, y - 4, 8, 8, UI.cyan);
        rect(ctx, x + 3, y - 2, 10, 4, UI.cyan);
      });
      rect(ctx, x + 4 + (frame % 8), y - 1, 1, 2, "#e0f7ff");
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

/** A subagent: bobs while it works, steps as it walks the ring, fades as it walks out. */
function mini(ctx: CanvasRenderingContext2D, actor: Actor, session: SessionView, agent: SubagentView | null, st: PaintState) {
  const seed = hash(actor.id);
  const pal = palette(session.provider, seed);
  const fx = Math.round(actor.x);
  const fy = Math.round(actor.y);
  const walking = actor.pose === "walk";
  const bob = walking ? (Math.floor(actor.walked / 3) % 2 === 1 ? -1 : 0) : agent?.running && (st.frame + seed) % 6 < 3 ? -1 : 0;
  withAlpha(ctx, actor.leaving ? 0.6 : 1, () => {
    withAlpha(ctx, 0.3, () => rect(ctx, fx - 3, fy - 1, 7, 1, "#000"));
    drawSprite(ctx, MINI, fx - 3, fy - 9 + bob, pal, actor.dir === "left");
  });
  const id = agent?.id;
  if (id && (st.selectedAgent === id || st.hoveredAgent === id)) frameRect(ctx, fx - 5, fy - 10, 10, 11, st.selectedAgent === id ? "#facc15" : "#ffffffaa");
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
  const y = Math.round((side ? fy - 11 : fy - 17) + bob);
  rect(ctx, x, y, 7, 7, "#1b1523");
  rect(ctx, x + 1, y + 1, 5, 5, "#fdfcf7");
  if (side === "right") rect(ctx, x - 1, y + 4, 1, 1, "#1b1523");
  else if (side === "left") rect(ctx, x + 7, y + 4, 1, 1, "#1b1523");
  else rect(ctx, x + 3, y + 7, 1, 1, "#1b1523");
  drawText(ctx, glyph, x + 2, y + 1, glyph === "$" ? "#15803d" : "#1b1523");
}

/** What the agent is saying, above its head. */
function bubble(ctx: CanvasRenderingContext2D, actor: Actor, s: SessionView, frame: number) {
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
  else if (actor.pose === "stand" && (actor.dir === "left" || actor.dir === "right") && (frame + hash(s.id)) % 40 < 12) {
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
