// Pintado pixel art de la sala. Coordenadas lógicas; el canvas se escala con `pixelated`.
import type { AttentionView, SessionView } from "../../domain/attention";
import { deskName } from "../../domain/attention";
import { drawText, fit, textWidth } from "./font";
import { type Bay, type DeskSpot, type Scene, WALL_H } from "./layout";

export const COLOR: Record<AttentionView, string> = {
  needs_you: "#ef4444",
  finished: "#38bdf8",
  working: "#22c55e",
  idle: "#94a3b8",
  offline: "#475569",
};

const SCREEN_BG: Record<AttentionView, string> = {
  needs_you: "#450a0a",
  finished: "#082f49",
  working: "#052e16",
  idle: "#111827",
  offline: "#020617",
};

const HAIR = ["#2b1b0e", "#6b3e1f", "#d9a441", "#1f1f1f", "#8b2e2e", "#e8e1d0", "#4c1d95"];
const SHIRT = ["#3b82f6", "#a855f7", "#f97316", "#14b8a6", "#e11d48", "#84cc16", "#eab308"];

export type Paint = { frame: number; selected: string | null; hovered: string | null; now: Date };

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function frameRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  rect(ctx, x, y, w, 1, color);
  rect(ctx, x, y + h - 1, w, 1, color);
  rect(ctx, x, y, 1, h, color);
  rect(ctx, x + w - 1, y, 1, h, color);
}

/** Halo escalonado alrededor de algo que brilla. */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, strength: number) {
  ctx.save();
  for (let i = 3; i >= 1; i--) {
    ctx.globalAlpha = (strength * (4 - i)) / 12;
    rect(ctx, x - i, y - i, w + 2 * i, h + 2 * i, color);
  }
  ctx.restore();
}

export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene, p: Paint) {
  ctx.imageSmoothingEnabled = false;
  paintFloor(ctx, scene);
  paintWall(ctx, scene, p);
  for (const bay of scene.bays) paintBay(ctx, bay, p);
}

function paintFloor(ctx: CanvasRenderingContext2D, scene: Scene) {
  rect(ctx, 0, 0, scene.width, scene.height, "#070b14");
  for (let y = WALL_H; y < scene.height; y += 8) {
    for (let x = 0; x < scene.width; x += 8) {
      rect(ctx, x, y, 8, 8, ((x + y) / 8) % 2 === 0 ? "#0a1120" : "#0c1426");
    }
  }
}

function paintWall(ctx: CanvasRenderingContext2D, scene: Scene, p: Paint) {
  const w = scene.width;
  rect(ctx, 0, 0, w, WALL_H, "#0f172a");
  for (let x = 0; x < w; x += 24) rect(ctx, x, 0, 1, WALL_H - 4, "#131d33");
  rect(ctx, 0, WALL_H - 4, w, 4, "#1e293b");
  rect(ctx, 0, WALL_H - 1, w, 1, "#334155");

  // Pantalla principal: el estado agregado de la sala.
  const color = COLOR[scene.aggregate];
  const sw = Math.min(180, w - 60);
  const sx = Math.round((w - sw) / 2);
  const sy = 6;
  const sh = 34;
  const alarm = scene.aggregate === "needs_you";
  if (scene.aggregate !== "offline") glow(ctx, sx, sy, sw, sh, color, alarm && p.frame % 10 < 5 ? 1.4 : 0.7);
  rect(ctx, sx - 2, sy - 2, sw + 4, sh + 4, "#334155");
  rect(ctx, sx, sy, sw, sh, SCREEN_BG[scene.aggregate]);
  for (let y = sy; y < sy + sh; y += 2) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    rect(ctx, sx, y, sw, 1, "#000");
    ctx.restore();
  }
  const title = "AGENT WAR ROOM";
  drawText(ctx, title, sx + Math.round((sw - textWidth(title)) / 2), sy + 5, "#e2e8f0");

  const counts = countOnWatch(scene);
  const line = [
    counts.needs_you ? `! ${counts.needs_you}` : "",
    counts.finished ? `OK ${counts.finished}` : "",
    counts.working ? `>> ${counts.working}` : "",
  ]
    .filter(Boolean)
    .join("   ") || "TODO TRANQUILO";
  drawText(ctx, line, sx + Math.round((sw - textWidth(line)) / 2), sy + 15, color);

  const clock = p.now.toTimeString().slice(0, 5);
  drawText(ctx, clock, sx + Math.round((sw - textWidth(clock)) / 2), sy + 25, "#64748b");

  // Balizas: giran cuando alguien te necesita.
  for (const bx of [10, w - 16]) {
    const on = alarm && p.frame % 6 < 3;
    rect(ctx, bx, 14, 6, 4, "#1e293b");
    rect(ctx, bx + 1, 8, 4, 6, on ? "#ef4444" : alarm ? "#7f1d1d" : "#1e293b");
    if (on) glow(ctx, bx + 1, 8, 4, 6, "#ef4444", 1.2);
  }
}

function countOnWatch(scene: Scene): Partial<Record<AttentionView, number>> {
  const counts: Partial<Record<AttentionView, number>> = {};
  for (const bay of scene.bays) {
    for (const d of bay.desks) {
      if (d.session.archived || d.session.muted) continue;
      counts[d.session.attention] = (counts[d.session.attention] ?? 0) + 1;
    }
  }
  return counts;
}

function paintBay(ctx: CanvasRenderingContext2D, bay: Bay, p: Paint) {
  const color = COLOR[bay.room.attention];
  ctx.save();
  ctx.globalAlpha = 0.07;
  rect(ctx, bay.x, bay.y, bay.w, bay.h, color);
  ctx.restore();
  frameRect(ctx, bay.x, bay.y, bay.w, bay.h, "#1e293b");
  rect(ctx, bay.x + 3, bay.y + 3, 3, 3, color);
  drawText(ctx, fit(bay.room.repo_name, bay.w - 12), bay.x + 9, bay.y + 2, "#cbd5e1");
  for (const desk of bay.desks) paintDesk(ctx, desk, p);
}

function paintDesk(ctx: CanvasRenderingContext2D, d: DeskSpot, p: Paint) {
  const s = d.session;
  const x = d.x;
  const y = d.y;
  ctx.save();
  if (s.archived) ctx.globalAlpha = 0.35;
  else if (s.muted) ctx.globalAlpha = 0.6;

  paintMonitor(ctx, s, x + 10, y + 3, p.frame);
  // Mesa: tablero y frente.
  rect(ctx, x + 4, y + 25, 40, 4, "#475569");
  rect(ctx, x + 4, y + 29, 40, 3, "#334155");
  rect(ctx, x + 6, y + 32, 2, 6, "#1e293b");
  rect(ctx, x + 40, y + 32, 2, 6, "#1e293b");
  // Teclado.
  rect(ctx, x + 17, y + 25, 14, 2, "#1e293b");

  paintSubagents(ctx, s, x, y, p.frame);
  if (s.alive) paintOperator(ctx, s, x + 17, y + 29, p.frame);
  else rect(ctx, x + 30, y + 38, 12, 7, "#1e293b"); // silla vacía, apartada

  paintBubble(ctx, s, x + 36, y, p.frame);
  const caption = s.title ?? deskName(s);
  drawText(ctx, fit(caption, d.w - 4), x + 2, y + 50, s.alive ? "#94a3b8" : "#475569");
  ctx.restore();

  if (p.selected === s.id) {
    const dash = p.frame % 4 < 2 ? "#facc15" : "#a16207";
    frameRect(ctx, x, y, d.w, d.h - 1, dash);
  } else if (p.hovered === s.id) {
    frameRect(ctx, x, y, d.w, d.h - 1, "#334155");
  }
}

function paintMonitor(ctx: CanvasRenderingContext2D, s: SessionView, x: number, y: number, frame: number) {
  const a = s.attention;
  const color = COLOR[a];
  const w = 28;
  const h = 19;
  const lit = a === "working" || a === "finished" || a === "needs_you";
  const flashing = a === "needs_you" && frame % 8 < 4;
  if (lit && !s.muted && !s.archived) glow(ctx, x, y, w, h, color, flashing ? 1.5 : 0.8);

  rect(ctx, x, y, w, h, "#1e293b");
  rect(ctx, x + 12, y + h, 4, 3, "#1e293b");
  const sx = x + 2;
  const sy = y + 2;
  const sw = w - 4;
  const sh = h - 4;
  rect(ctx, sx, sy, sw, sh, flashing ? "#7f1d1d" : SCREEN_BG[a]);

  const seed = hash(s.id);
  if (a === "working") {
    // Líneas de "código" que suben.
    for (let i = 0; i < 5; i++) {
      const len = 4 + ((seed >> ((i + frame) % 24)) & 15);
      rect(ctx, sx + 2 + (i % 2) * 2, sy + 2 + i * 2, Math.min(len, sw - 6), 1, i === 4 && frame % 4 < 2 ? "#86efac" : color);
    }
  } else if (a === "needs_you") {
    rect(ctx, sx + sw / 2 - 1, sy + 3, 2, 5, flashing ? "#fecaca" : color);
    rect(ctx, sx + sw / 2 - 1, sy + 10, 2, 2, flashing ? "#fecaca" : color);
  } else if (a === "finished") {
    // ✓
    const cx = sx + sw / 2 - 4;
    const cy = sy + 7;
    for (let i = 0; i < 3; i++) rect(ctx, cx + i, cy + i, 2, 2, color);
    for (let i = 0; i < 5; i++) rect(ctx, cx + 3 + i, cy + 2 - i, 2, 2, color);
  } else if (a === "idle") {
    if (frame % 10 < 5) rect(ctx, sx + 2, sy + sh - 4, 3, 2, color);
  } else {
    rect(ctx, sx + sw - 5, sy + 2, 2, 1, "#1e293b"); // reflejo de pantalla apagada
  }
  // Barrido de líneas.
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let yy = sy + 1; yy < sy + sh; yy += 2) rect(ctx, sx, yy, sw, 1, "#000");
  ctx.restore();
}

/** Operador de espaldas frente a su monitor. */
function paintOperator(ctx: CanvasRenderingContext2D, s: SessionView, x: number, y: number, frame: number) {
  const seed = hash(s.id);
  const hair = HAIR[seed % HAIR.length];
  const shirt = SHIRT[(seed >>> 8) % SHIRT.length];
  const a = s.attention;
  const typing = a === "working";
  const waving = a === "needs_you";
  const bob = a === "idle" && frame % 20 < 10 ? 1 : 0;

  // Cabeza y pelo (de espaldas).
  rect(ctx, x + 3, y + bob, 8, 7, hair);
  rect(ctx, x + 4, y + 7 + bob, 6, 1, "#e0b48a");
  // Hombros y torso.
  rect(ctx, x, y + 8, 14, 7, shirt);
  // Brazos.
  if (typing) {
    const up = frame % 2 === 0;
    rect(ctx, x - 1, y + (up ? 7 : 8), 2, 4, shirt);
    rect(ctx, x + 13, y + (up ? 8 : 7), 2, 4, shirt);
  } else if (waving) {
    const high = frame % 6 < 3;
    rect(ctx, x + 13, y + (high ? -2 : 0), 2, 9, shirt);
    rect(ctx, x + 13, y + (high ? -4 : -2), 2, 2, "#e0b48a");
    rect(ctx, x - 1, y + 9, 2, 4, shirt);
  } else {
    rect(ctx, x - 1, y + 9, 2, 5, shirt);
    rect(ctx, x + 13, y + 9, 2, 5, shirt);
  }
  // Respaldo de la silla.
  rect(ctx, x + 1, y + 13, 12, 6, "#1e293b");
  rect(ctx, x + 6, y + 19, 2, 2, "#0f172a");
}

function paintSubagents(ctx: CanvasRenderingContext2D, s: SessionView, x: number, y: number, frame: number) {
  const shown = s.subagents.slice(0, 3);
  shown.forEach((a, i) => {
    const bob = (frame + i * 3) % 8 < 4 ? 0 : 1;
    const dx = x + 1 + i * 6;
    const dy = y + 34 + bob;
    const eye = a.last_tool ? "#22c55e" : "#38bdf8";
    rect(ctx, dx, dy, 5, 4, "#94a3b8");
    rect(ctx, dx + 1, dy + 1, 1, 1, eye);
    rect(ctx, dx + 3, dy + 1, 1, 1, eye);
    rect(ctx, dx + 2, dy - 2, 1, 2, "#64748b");
    rect(ctx, dx + 1, dy + 4, 3, 1, "#475569");
  });
  if (s.subagents.length > 3) drawText(ctx, `+${s.subagents.length - 3}`, x + 1, y + 42, "#94a3b8");
}

function paintBubble(ctx: CanvasRenderingContext2D, s: SessionView, x: number, y: number, frame: number) {
  let symbol: string | null = null;
  let color = COLOR[s.attention];
  if (s.attention === "needs_you") symbol = frame % 8 < 6 ? "!" : null;
  else if (s.attention === "finished") symbol = "OK";
  else if (s.muted) {
    symbol = "Z";
    color = "#64748b";
  }
  if (!symbol) return;
  const w = textWidth(symbol) + 4;
  rect(ctx, x, y, w, 9, "#f8fafc");
  rect(ctx, x + 1, y + 9, 2, 2, "#f8fafc");
  drawText(ctx, symbol, x + 2, y + 2, s.attention === "needs_you" ? "#b91c1c" : color === COLOR.finished ? "#0369a1" : color);
}
