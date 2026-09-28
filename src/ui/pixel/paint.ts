// Pixel-art painting of the office. Logical coordinates; the canvas is scaled with `pixelated`.
import type { AttentionView, SessionView, SubagentView } from "../../domain/attention";
import { deskName } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { drawText, fit, textWidth } from "./font";
import { type Desk, type Office, type Prop, type Rect, TILE, WALL_ROWS, feetOf } from "./office";
import { type Actor, hash } from "./sim";
import { MINI, drawSprite, lounging, palette, seated, body } from "./sprites";

export const COLOR: Record<AttentionView, string> = {
  needs_you: "#f25555",
  finished: "#4cb8f5",
  working: "#34d27a",
  idle: "#93a1b8",
  offline: "#56637a",
};
/** Working but silent for too long: amber, between "working" and "needs you". */
const STALLED = "#f59e0b";

const WOOD = { base: "#8a6444", dark: "#7f5c3e", light: "#946c4a", seam: "#6e4f34" };
const WALL = { face: "#3a4063", light: "#4a5178", trim: "#262a42", base: "#2c3150" };
const RUGS = ["#4b5d8a", "#6a4c7d", "#3f6f63", "#7a5a3a", "#4e6b8f", "#7d4f55"];

export type PaintState = {
  frame: number;
  now: Date;
  selected: string | null;
  selectedAgent: string | null;
  hovered: string | null;
  hoveredAgent: string | null;
  /** Titles of what needs you, for the wall board ticker. */
  alerts: string[];
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
  for (const zone of office.zones) rug(ctx, zone.rect, RUGS[hash(zone.room.repo_id) % RUGS.length], zone.room.repo_name, zone.desks.length);
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
      drawables.push({ y: seatFeet.y + 0.6, draw: () => nameplate(ctx, d) });
      d.session.subagents.slice(0, d.slots.length).forEach((agent, i) => {
        const feet = miniFeet(d, i);
        drawables.push({ y: feet.y, draw: () => mini(ctx, d.session, agent, feet.x, feet.y, st) });
      });
    }
  }
  for (const prop of office.props) {
    const top = prop.y * TILE;
    drawables.push({ y: top + 5, draw: () => propBack(ctx, prop) });
    drawables.push({ y: top + TILE - 2.5, draw: () => propFront(ctx, prop) });
  }
  const sessions = new Map(office.zones.flatMap((z) => z.desks.map((d) => [d.session.id, d.session] as const)));
  for (const actor of st.actors.values()) {
    const session = sessions.get(actor.id);
    drawables.push({ y: actor.y, draw: () => agent(ctx, actor, session, st) });
  }
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // On top of everything: what each agent is saying, and selection marks.
  for (const actor of st.actors.values()) {
    const session = sessions.get(actor.id);
    if (session) bubble(ctx, actor, session, st.frame);
  }
  for (const zone of office.zones) for (const d of zone.desks) marks(ctx, d, st);
}

// ---------- Room ----------

function floor(ctx: CanvasRenderingContext2D, office: Office) {
  rect(ctx, 0, 0, office.width, office.height, WOOD.base);
  for (let r = WALL_ROWS; r < office.rows; r++) {
    for (let y = 0; y < TILE; y += 4) {
      const py = r * TILE + y;
      rect(ctx, 0, py + 3, office.width, 1, WOOD.dark);
      // Staggered plank joints.
      const offset = ((r * 4 + y) * 7) % 23;
      for (let x = offset; x < office.width; x += 23 + ((r + y) % 3) * 4) rect(ctx, x, py, 1, 3, WOOD.seam);
      if ((r + y) % 3 === 0) rect(ctx, 0, py, office.width, 1, WOOD.light);
    }
  }
  // Side walls' shadow on the floor.
  withAlpha(ctx, 0.25, () => {
    rect(ctx, 0, WALL_ROWS * TILE, office.width, 3, "#000");
    rect(ctx, 0, WALL_ROWS * TILE, 3, office.height, "#000");
    rect(ctx, office.width - 3, WALL_ROWS * TILE, 3, office.height, "#000");
  });
}

function sky(hour: number): { top: string; bottom: string; night: boolean } {
  if (hour >= 21 || hour < 6) return { top: "#0b1026", bottom: "#1c2350", night: true };
  if (hour < 8) return { top: "#f6a86b", bottom: "#fbd49a", night: false };
  if (hour >= 19) return { top: "#5b3f82", bottom: "#e0866b", night: false };
  return { top: "#6fb7ef", bottom: "#b8e0fb", night: false };
}

function wall(ctx: CanvasRenderingContext2D, office: Office, st: PaintState) {
  const h = WALL_ROWS * TILE;
  rect(ctx, 0, 0, office.width, h, WALL.face);
  rect(ctx, 0, 0, office.width, 3, WALL.trim);
  for (let x = 0; x < office.width; x += 8) rect(ctx, x, 3, 1, h - 7, WALL.light);
  rect(ctx, 0, h - 4, office.width, 4, WALL.base);

  const { top, bottom, night } = sky(st.now.getHours());
  const boardW = Math.min(150, office.width - 80);
  const boardX = Math.floor((office.width - boardW) / 2);
  // Windows left and right of the board.
  for (let x = 40; x + 30 < office.width - 8; x += 44) {
    if (x + 30 > boardX - 6 && x < boardX + boardW + 6) continue;
    window_(ctx, x, 9, 30, 24, top, bottom, night, x);
  }
  door(ctx, office.door.x * TILE, h);
  board(ctx, office, boardX, 6, boardW, h - 14, st);
  clock(ctx, office.width - 20, 10, st.now);
}

function window_(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, top: string, bottom: string, night: boolean, seed: number) {
  rect(ctx, x - 2, y - 2, w + 4, h + 4, "#5c4631");
  rect(ctx, x, y, w, Math.floor(h / 2), top);
  rect(ctx, x, y + Math.floor(h / 2), w, Math.ceil(h / 2), bottom);
  if (night) for (let i = 0; i < 5; i++) rect(ctx, x + Math.floor(rand(seed + i) * w), y + Math.floor(rand(seed * 3 + i) * 8), 1, 1, "#fff8d0");
  else rect(ctx, x + 4 + (seed % 9), y + 4, 6, 2, "#ffffffcc");
  // Skyline.
  for (let bx = 0; bx < w; bx += 5) {
    const bh = 4 + Math.floor(rand(seed + bx) * 9);
    rect(ctx, x + bx, y + h - bh, 4, bh, night ? "#141a38" : "#5d7aa0");
    if (night && rand(seed + bx * 7) > 0.5) rect(ctx, x + bx + 1, y + h - bh + 2, 1, 1, "#ffd76a");
  }
  rect(ctx, x + Math.floor(w / 2), y, 1, h, "#5c4631");
  rect(ctx, x, y + Math.floor(h / 2), w, 1, "#5c4631");
  rect(ctx, x - 3, y + h + 2, w + 6, 2, "#6e5639");
}

function door(ctx: CanvasRenderingContext2D, x: number, wallBottom: number) {
  rect(ctx, x + 1, wallBottom - 30, 14, 30, "#5c4631");
  rect(ctx, x + 3, wallBottom - 28, 10, 28, "#7a5a3c");
  rect(ctx, x + 4, wallBottom - 26, 8, 10, "#8a6848");
  rect(ctx, x + 11, wallBottom - 14, 1, 2, "#e8c872");
  rect(ctx, x, wallBottom, 16, 4, "#4a3a5a");
}

function board(ctx: CanvasRenderingContext2D, office: Office, x: number, y: number, w: number, h: number, st: PaintState) {
  rect(ctx, x - 2, y - 2, w + 4, h + 4, "#1b1f2e");
  rect(ctx, x, y, w, h, "#0f1422");
  drawText(ctx, copy.pixel.title, x + Math.floor((w - textWidth(copy.pixel.title)) / 2), y + 3, "#e5e7eb");
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
  const color = st.alerts.length ? (st.frame % 10 < 6 ? COLOR.needs_you : "#fca5a5") : "#64748b";
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + h - 8, w - 4, 7);
  ctx.clip();
  const tw = textWidth(ticker);
  const tx0 = st.alerts.length && tw > w - 8 ? x + w - ((st.frame * 1.5) % (tw + w)) : x + Math.floor((w - tw) / 2);
  drawText(ctx, ticker, tx0, y + h - 7, color);
  ctx.restore();
}

function clock(ctx: CanvasRenderingContext2D, x: number, y: number, now: Date) {
  rect(ctx, x - 1, y - 1, 14, 14, "#1b1f2e");
  rect(ctx, x, y, 12, 12, "#f1efe6");
  const hand = (turn: number, len: number, color: string) => {
    for (let i = 1; i <= len; i++) rect(ctx, x + 6 + Math.round(Math.sin(turn) * i), y + 6 - Math.round(Math.cos(turn) * i), 1, 1, color);
  };
  hand(((now.getHours() % 12) / 12) * 2 * Math.PI, 3, "#1b1f2e");
  hand((now.getMinutes() / 60) * 2 * Math.PI, 5, "#1b1f2e");
  hand((now.getSeconds() / 60) * 2 * Math.PI, 5, "#e11d48");
}

function rug(ctx: CanvasRenderingContext2D, r: Rect, color: string, name: string, count: number) {
  const x = r.x * TILE + 2;
  const y = r.y * TILE + 4;
  const w = r.w * TILE - 4;
  const h = r.h * TILE - 6;
  withAlpha(ctx, 0.55, () => rect(ctx, x, y, w, h, color));
  withAlpha(ctx, 0.35, () => {
    frameRect(ctx, x + 2, y + 2, w - 4, h - 4, "#ffffff");
    for (let yy = y + 6; yy < y + h - 4; yy += 6) rect(ctx, x + 4, yy, w - 8, 1, "#00000055");
  });
  // Name plaque, hanging over the rug's top edge (the monitors stand just below).
  const label = fit(`${name.toUpperCase()} ${count}`, w - 10);
  const lw = textWidth(label) + 8;
  rect(ctx, x + 3, y - 8, lw, 9, "#1b1f2e");
  rect(ctx, x + 3, y - 8, 2, 9, color);
  drawText(ctx, label, x + 8, y - 6, "#e5e7eb");
}

function loungeRug(ctx: CanvasRenderingContext2D, office: Office) {
  // Under the furniture row too, which stands on the rug's back edge.
  const r = office.lounge;
  const y = r.y * TILE - 10;
  const h = r.h * TILE + 8;
  withAlpha(ctx, 0.4, () => rect(ctx, r.x * TILE + 6, y, r.w * TILE - 12, h, "#3f6f63"));
  withAlpha(ctx, 0.3, () => frameRect(ctx, r.x * TILE + 8, y + 2, r.w * TILE - 16, h - 4, "#d9f2e6"));
}

// ---------- Furniture ----------

function desk(ctx: CanvasRenderingContext2D, d: Desk, st: PaintState) {
  const { x, y, w, h } = d.desk;
  const s = d.session;
  const dim = s.archived ? 0.45 : 1;
  withAlpha(ctx, dim, () => {
    // Shadow, top, front panel, legs.
    withAlpha(ctx, 0.3, () => rect(ctx, x + 1, y + h, w, 2, "#000"));
    rect(ctx, x, y, w, 6, "#b07b4f");
    rect(ctx, x, y, w, 1, "#c99468");
    rect(ctx, x, y + 6, w, h - 6, "#8a5c38");
    rect(ctx, x + 1, y + h - 1, 2, 1, "#5a3a22");
    rect(ctx, x + w - 3, y + h - 1, 2, 1, "#5a3a22");
    // A drawer handle on the front panel.
    rect(ctx, x + Math.floor(w / 2) - 3, y + 9, 6, 1, "#6b4428");
    monitor(ctx, x + Math.floor(w / 2) - 8, y - 9, s, st.frame);
    // Keyboard and something personal on the desk.
    rect(ctx, x + Math.floor(w / 2) - 5, y + 3, 10, 2, "#2b2f3a");
    const deco = hash(s.id) % 3;
    if (deco === 0) mug(ctx, x + w - 6, y + 1);
    else if (deco === 1) {
      rect(ctx, x + 2, y + 1, 3, 3, "#6b4e2e");
      rect(ctx, x + 1, y - 2, 5, 3, "#4f9d69");
    } else rect(ctx, x + w - 7, y + 2, 5, 2, "#e8e1d0");
  });
}

function mug(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x, y, 3, 3, "#e8e1d0");
  rect(ctx, x + 3, y + 1, 1, 1, "#e8e1d0");
}

function monitor(ctx: CanvasRenderingContext2D, x: number, y: number, s: SessionView, frame: number) {
  rect(ctx, x + 6, y + 10, 4, 2, "#2b2f3a");
  rect(ctx, x, y, 16, 11, "#1f2330");
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
  if (s.attention === "needs_you" && !s.muted) withAlpha(ctx, frame % 8 < 5 ? 0.35 : 0.15, () => rect(ctx, x - 2, y - 2, 20, 15, COLOR.needs_you));
}

/** Where a subagent stands: aisle ones a little lower, clear of the name. */
export function miniFeet(d: Desk, i: number) {
  const feet = feetOf(d.slots[i]);
  return d.slots[i].y > d.seat.y ? { x: feet.x, y: feet.y + 2 } : feet;
}

/** The session's name on the floor, under its chair. */
function nameplate(ctx: CanvasRenderingContext2D, d: Desk) {
  const s = d.session;
  const name = fit((s.title ?? deskName(s)).toUpperCase(), d.cell.w - 6);
  const feet = feetOf(d.seat);
  const x = feet.x - Math.floor(textWidth(name) / 2);
  withAlpha(ctx, 0.55, () => rect(ctx, x - 2, feet.y + 3, textWidth(name) + 3, 7, "#1b1523"));
  drawText(ctx, name, x, feet.y + 4, s.attention === "offline" ? "#8b93a7" : "#e9dfcf");
}

function chair(ctx: CanvasRenderingContext2D, fx: number, fy: number) {
  // Seen from behind: the backrest hides the seated agent's waist.
  rect(ctx, fx - 5, fy - 6, 10, 5, "#2f3442");
  rect(ctx, fx - 5, fy - 6, 10, 1, "#454b5e");
  rect(ctx, fx - 1, fy - 1, 2, 2, "#1f232d");
  rect(ctx, fx - 4, fy + 1, 2, 1, "#1f232d");
  rect(ctx, fx + 2, fy + 1, 2, 1, "#1f232d");
}

function propBack(ctx: CanvasRenderingContext2D, prop: Prop) {
  const x = prop.x * TILE;
  const y = prop.y * TILE;
  switch (prop.kind) {
    case "sofa":
      rect(ctx, x + 1, y - 2, 30, 9, "#7d3c4f");
      rect(ctx, x + 1, y - 2, 30, 1, "#9b5066");
      break;
    case "shelf":
      rect(ctx, x + 1, y - 14, 14, 28, "#5c4631");
      for (let row = 0; row < 3; row++) {
        for (let b = 0; b < 4; b++) rect(ctx, x + 3 + b * 3, y - 12 + row * 9, 2, 7, RUGS[(prop.x + row * 4 + b) % RUGS.length]);
        rect(ctx, x + 2, y - 5 + row * 9, 12, 1, "#3e2f20");
      }
      break;
    case "coffee":
      rect(ctx, x + 2, y - 8, 12, 20, "#2f3442");
      rect(ctx, x + 4, y - 5, 8, 4, "#111827");
      rect(ctx, x + 5, y - 4, 2, 1, "#f87171");
      rect(ctx, x + 6, y + 2, 4, 4, "#e8e1d0");
      break;
    case "cooler":
      rect(ctx, x + 4, y - 12, 8, 9, "#8ecbf0");
      rect(ctx, x + 5, y - 11, 2, 7, "#c8e9fb");
      rect(ctx, x + 3, y - 3, 10, 15, "#e5e7eb");
      break;
    default:
      break;
  }
}

function propFront(ctx: CanvasRenderingContext2D, prop: Prop) {
  const x = prop.x * TILE;
  const y = prop.y * TILE;
  switch (prop.kind) {
    case "sofa":
      rect(ctx, x, y + 6, 32, 7, "#8e4a5e");
      rect(ctx, x + 2, y + 6, 13, 3, "#a65a70");
      rect(ctx, x + 17, y + 6, 13, 3, "#a65a70");
      rect(ctx, x, y + 2, 3, 11, "#6c3343");
      rect(ctx, x + 29, y + 2, 3, 11, "#6c3343");
      break;
    case "plant": {
      const leaf = ["#3f8f5a", "#56a870", "#2f6f45"];
      for (let i = 0; i < 9; i++) rect(ctx, x + 3 + ((i * 5) % 10), y - 8 + ((i * 3) % 9), 3, 3, leaf[i % 3]);
      rect(ctx, x + 4, y + 3, 8, 8, "#b0603a");
      rect(ctx, x + 4, y + 3, 8, 1, "#c97a4f");
      break;
    }
    case "table":
      rect(ctx, x + 1, y + 2, 14, 6, "#9c7350");
      rect(ctx, x + 1, y + 2, 14, 1, "#b58a63");
      mug(ctx, x + 5, y + 3);
      break;
    default:
      break;
  }
}

// ---------- People ----------

function agent(ctx: CanvasRenderingContext2D, actor: Actor, session: SessionView | undefined, st: PaintState) {
  const seed = hash(actor.id);
  const pal = palette(session?.provider ?? "claude", seed);
  const x = Math.round(actor.x) - 5;
  const typing = session?.attention === "working" && !stalled(session);
  withAlpha(ctx, actor.leaving || session?.archived ? 0.5 : 1, () => {
    // Soft shadow under the feet.
    withAlpha(ctx, 0.25, () => rect(ctx, x + 1, Math.round(actor.y) - 1, 8, 2, "#000"));
    if (actor.pose === "desk") {
      const top = Math.round(actor.y) - 16;
      drawSprite(ctx, seated(typing, Math.floor(st.frame / 2)), x, top, pal);
      if (session?.attention === "needs_you") raisedHand(ctx, x + 9, top, pal, st.frame);
    } else if (actor.pose === "sofa") {
      drawSprite(ctx, lounging, x, Math.round(actor.y) - 15, pal);
    } else {
      const walking = actor.pose === "walk";
      const bob = walking && Math.floor(actor.walked / 4) % 2 === 1 ? -1 : 0;
      const top = Math.round(actor.y) - 14 + bob;
      drawSprite(ctx, body(actor.dir, walking, Math.floor(actor.walked / 4)), x, top, pal, actor.dir === "left");
      // Idle agents in the lounge sometimes hold a coffee.
      if (!walking && seed % 2 === 0 && actor.dir === "down") mug(ctx, x + 8, top + 9);
    }
  });
}

function raisedHand(ctx: CanvasRenderingContext2D, x: number, top: number, pal: Record<string, string>, frame: number) {
  const wave = frame % 6 < 3 ? 0 : 1;
  rect(ctx, x + wave, top - 3, 2, 11, pal.k);
  rect(ctx, x + wave, top - 2, 1, 9, pal.c);
  rect(ctx, x + wave - 1, top - 5, 3, 3, pal.s);
}

function mini(ctx: CanvasRenderingContext2D, session: SessionView, agent: SubagentView, fx: number, fy: number, st: PaintState) {
  const seed = hash(agent.id);
  const pal = palette(session.provider, seed);
  const bob = agent.running && (st.frame + seed) % 6 < 3 ? -1 : 0;
  withAlpha(ctx, agent.running ? 1 : 0.55, () => {
    withAlpha(ctx, 0.25, () => rect(ctx, fx - 3, fy - 1, 6, 1, "#000"));
    drawSprite(ctx, MINI, fx - 3, fy - 8 + bob, pal);
  });
  if (st.selectedAgent === agent.id || st.hoveredAgent === agent.id) frameRect(ctx, fx - 5, fy - 10, 10, 11, st.selectedAgent === agent.id ? "#facc15" : "#ffffffaa");
}

/** What the agent is saying, above its head. */
function bubble(ctx: CanvasRenderingContext2D, actor: Actor, s: SessionView, frame: number) {
  if (actor.pose === "walk") return;
  const top = Math.round(actor.y) - (actor.pose === "desk" ? 16 : 14) - 11;
  const x = Math.round(actor.x) - 4;
  let text: string | null = null;
  let color = "#1b1523";
  if (s.muted) [text, color] = ["ZZ", "#64748b"];
  else if (s.attention === "needs_you") [text, color] = ["!", COLOR.needs_you];
  else if (stalled(s)) [text, color] = ["?", STALLED];
  else if (s.attention === "finished" && !s.archived) [text, color] = [copy.pixel.finishedBubble, "#0284c7"];
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
  const more = d.session.subagents.length - d.slots.length;
  if (more > 0) drawText(ctx, `+${more}`, x + w - 12, y + h - 7, "#e5e7eb");
}
