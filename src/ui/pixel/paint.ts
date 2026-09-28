// Pintado pixel art de la sala. Coordenadas lógicas; el canvas se escala con `pixelated`.
import type { AttentionView, SessionView } from "../../domain/attention";
import { deskName } from "../../domain/attention";
import { drawText, fit, textWidth } from "./font";
import { type Bay, type DeskSpot, type Scene, WALL_H } from "./layout";

export const COLOR: Record<AttentionView, string> = {
  needs_you: "#f25555",
  finished: "#4cb8f5",
  working: "#34d27a",
  idle: "#93a1b8",
  offline: "#56637a",
};

const SCREEN_BG: Record<AttentionView, string> = {
  needs_you: "#450a0a",
  finished: "#082f49",
  working: "#052e16",
  idle: "#111827",
  offline: "#020617",
};

const SKIN = ["#f1c7a0", "#e0a97d", "#c68a5e", "#8d5a3b", "#5c3a26"];
const HAIR = ["#2b1b0e", "#6b3e1f", "#d9a441", "#1f1f1f", "#8b2e2e", "#e8e1d0", "#4c1d95"];
const SHIRT = ["#3b82f6", "#a855f7", "#f97316", "#14b8a6", "#e11d48", "#84cc16", "#eab308"];

export type Paint = {
  frame: number;
  selected: string | null;
  hovered: string | null;
  now: Date;
  /** Títulos de lo que te necesita, para el rótulo de la pantalla principal. */
  alerts: string[];
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Pseudoaleatorio estable por semilla (para decorado que no baila entre fotogramas). */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

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

/** Halo escalonado alrededor de algo que brilla. */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, strength: number) {
  for (let i = 3; i >= 1; i--) {
    withAlpha(ctx, (strength * (4 - i)) / 12, () => rect(ctx, x - i, y - i, w + 2 * i, h + 2 * i, color));
  }
}

/** Charco de luz en el suelo (elipse aproximada con franjas). */
function floorLight(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, alpha: number) {
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)));
    withAlpha(ctx, alpha * (1 - Math.abs(dy) / (ry + 1)), () => rect(ctx, cx - half, cy + dy, half * 2, 1, color));
  }
}

export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene, p: Paint) {
  ctx.imageSmoothingEnabled = false;
  paintFloor(ctx, scene);
  paintWall(ctx, scene, p);
  paintPlants(ctx, scene);
  for (const bay of scene.bays) paintBay(ctx, bay, p);
}

function paintFloor(ctx: CanvasRenderingContext2D, scene: Scene) {
  rect(ctx, 0, 0, scene.width, scene.height, "#070b14");
  for (let y = WALL_H; y < scene.height; y += 8) {
    for (let x = 0; x < scene.width; x += 8) {
      rect(ctx, x, y, 8, 8, ((x + y) / 8) % 2 === 0 ? "#0a1120" : "#0c1426");
    }
  }
  // Sombra de la pared sobre el suelo.
  withAlpha(ctx, 0.35, () => rect(ctx, 0, WALL_H, scene.width, 3, "#000"));
}

function paintWall(ctx: CanvasRenderingContext2D, scene: Scene, p: Paint) {
  const w = scene.width;
  rect(ctx, 0, 0, w, WALL_H, "#0f172a");
  for (let x = 0; x < w; x += 24) rect(ctx, x, 0, 1, WALL_H - 4, "#131d33");
  rect(ctx, 0, WALL_H - 4, w, 4, "#1e293b");
  rect(ctx, 0, WALL_H - 1, w, 1, "#334155");

  const sw = Math.min(200, w - 80);
  const sx = Math.round((w - sw) / 2);

  // Ventanas con la ciudad de noche, a ambos lados de la pantalla principal.
  const winW = 34;
  const space = Math.floor((sx - 40) / (winW + 8));
  for (let i = 0; i < Math.min(space, 3); i++) {
    paintWindow(ctx, sx - 10 - (i + 1) * (winW + 8) + 8, 8, winW, 30, i * 7 + 1, p.frame);
    paintWindow(ctx, sx + sw + 10 + i * (winW + 8), 8, winW, 30, i * 7 + 4, p.frame);
  }

  paintRack(ctx, 22, WALL_H - 38, p.frame, 1);
  paintRack(ctx, w - 34, WALL_H - 38, p.frame, 2);
  paintMainScreen(ctx, scene, sx, sw, p);

  // Balizas: giran cuando alguien te necesita.
  const alarm = scene.aggregate === "needs_you";
  for (const bx of [6, w - 12]) {
    const on = alarm && p.frame % 6 < 3;
    rect(ctx, bx, 14, 6, 4, "#1e293b");
    rect(ctx, bx + 1, 8, 4, 6, on ? "#f25555" : alarm ? "#7f1d1d" : "#1e293b");
    if (on) glow(ctx, bx + 1, 8, 4, 6, "#f25555", 1.2);
  }
}

function paintWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, frame: number) {
  rect(ctx, x - 2, y - 2, w + 4, h + 4, "#1e293b");
  rect(ctx, x, y, w, h, "#0b1a33");
  rect(ctx, x, y, w, 8, "#0e2244");
  // Luna o estrellas.
  if (seed % 3 === 1) rect(ctx, x + w - 8, y + 3, 3, 3, "#e2e8f0");
  for (let i = 0; i < 4; i++) rect(ctx, x + Math.floor(rand(seed + i) * w), y + 1 + Math.floor(rand(seed + i + 9) * 8), 1, 1, "#94a3b8");
  // Edificios.
  let bx = x;
  let n = 0;
  while (bx < x + w) {
    const bw = 4 + Math.floor(rand(seed * 31 + n) * 6);
    const bh = 8 + Math.floor(rand(seed * 17 + n) * (h - 12));
    const width = Math.min(bw, x + w - bx);
    rect(ctx, bx, y + h - bh, width, bh, n % 2 ? "#111b30" : "#16223b");
    // Ventanitas encendidas que parpadean de vez en cuando.
    for (let wy = y + h - bh + 2; wy < y + h - 1; wy += 3) {
      for (let wx = bx + 1; wx < bx + width - 1; wx += 2) {
        const r = rand(seed * 101 + wx * 7 + wy * 13);
        const flicker = r > 0.93 && (frame + Math.floor(r * 50)) % 40 < 3;
        if (r > 0.55 && !flicker) rect(ctx, wx, wy, 1, 1, r > 0.85 ? "#fde68a" : "#facc15");
      }
    }
    bx += bw;
    n++;
  }
  // Marco en cruz.
  rect(ctx, x + Math.floor(w / 2), y, 1, h, "#1e293b");
}

function paintRack(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, seed: number) {
  rect(ctx, x, y, 12, 34, "#111827");
  frameRect(ctx, x, y, 12, 34, "#334155");
  for (let i = 0; i < 7; i++) {
    const ly = y + 3 + i * 4;
    rect(ctx, x + 2, ly, 8, 2, "#1f2937");
    const blink = rand(seed * 13 + i + Math.floor((frame + i * 3) / 4)) > 0.5;
    rect(ctx, x + 8, ly, 1, 1, blink ? "#34d27a" : "#064e3b");
    if (i % 3 === 0) rect(ctx, x + 6, ly, 1, 1, rand(seed + i + frame / 7) > 0.8 ? "#f59e0b" : "#78350f");
  }
}

function paintMainScreen(ctx: CanvasRenderingContext2D, scene: Scene, sx: number, sw: number, p: Paint) {
  const color = COLOR[scene.aggregate];
  const sy = 6;
  const sh = 36;
  const alarm = scene.aggregate === "needs_you";
  if (scene.aggregate !== "offline") glow(ctx, sx, sy, sw, sh, color, alarm && p.frame % 10 < 5 ? 1.4 : 0.7);
  rect(ctx, sx - 3, sy - 3, sw + 6, sh + 6, "#334155");
  rect(ctx, sx - 2, sy - 2, sw + 4, sh + 4, "#1e293b");
  rect(ctx, sx, sy, sw, sh, SCREEN_BG[scene.aggregate]);

  const title = "AGENT WAR ROOM";
  drawText(ctx, title, sx + Math.round((sw - textWidth(title)) / 2), sy + 4, "#e7ecf5");

  const counts = countOnWatch(scene);
  const line =
    [
      counts.needs_you ? `! ${counts.needs_you}` : "",
      counts.finished ? `OK ${counts.finished}` : "",
      counts.working ? `>> ${counts.working}` : "",
    ]
      .filter(Boolean)
      .join("   ") || "TODO TRANQUILO";
  drawText(ctx, line, sx + Math.round((sw - textWidth(line)) / 2), sy + 13, color);

  // Rótulo: lo que te necesita desfila; si nada, la hora.
  if (p.alerts.length > 0) {
    const text = p.alerts.map((a) => `! ${a}`).join("     ");
    const tw = textWidth(text);
    const offset = (p.frame * 2) % (tw + sw);
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx + 2, sy + 22, sw - 4, 7);
    ctx.clip();
    drawText(ctx, text, sx + sw - offset, sy + 23, "#fecaca");
    ctx.restore();
  } else {
    const clock = p.now.toTimeString().slice(0, 5);
    drawText(ctx, clock, sx + Math.round((sw - textWidth(clock)) / 2), sy + 23, "#64748b");
  }

  withAlpha(ctx, 0.15, () => {
    for (let y = sy; y < sy + sh; y += 2) rect(ctx, sx, y, sw, 1, "#000");
  });
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

function paintPlants(ctx: CanvasRenderingContext2D, scene: Scene) {
  const y = scene.height - 16;
  for (const x of [6, scene.width - 14]) {
    rect(ctx, x + 1, y + 8, 7, 6, "#7c2d12");
    rect(ctx, x, y + 8, 9, 2, "#9a3412");
    rect(ctx, x + 3, y, 3, 8, "#15803d");
    rect(ctx, x, y + 2, 3, 4, "#16a34a");
    rect(ctx, x + 6, y + 1, 3, 5, "#16a34a");
    rect(ctx, x + 2, y - 2, 2, 3, "#22c55e");
    rect(ctx, x + 5, y - 3, 2, 3, "#22c55e");
  }
}

function paintBay(ctx: CanvasRenderingContext2D, bay: Bay, p: Paint) {
  const color = COLOR[bay.room.attention];
  // Alfombra con borde.
  rect(ctx, bay.x, bay.y, bay.w, bay.h, "#0f1629");
  withAlpha(ctx, 0.08, () => rect(ctx, bay.x, bay.y, bay.w, bay.h, color));
  frameRect(ctx, bay.x, bay.y, bay.w, bay.h, "#1e293b");
  frameRect(ctx, bay.x + 2, bay.y + 2, bay.w - 4, bay.h - 4, "#141d33");
  // Placa con el nombre.
  const name = fit(bay.room.repo_name, bay.w - 16);
  rect(ctx, bay.x + 4, bay.y + 2, textWidth(name) + 10, 8, "#1e293b");
  rect(ctx, bay.x + 6, bay.y + 4, 3, 3, color);
  drawText(ctx, name, bay.x + 11, bay.y + 3, "#cbd5e1");
  for (const desk of bay.desks) paintDesk(ctx, desk, p);
}

function paintDesk(ctx: CanvasRenderingContext2D, d: DeskSpot, p: Paint) {
  const s = d.session;
  const x = d.x;
  const y = d.y;
  const lit = !s.archived && (s.attention === "working" || s.attention === "finished" || s.attention === "needs_you");
  ctx.save();
  if (s.archived) ctx.globalAlpha = 0.35;
  else if (s.muted) ctx.globalAlpha = 0.6;

  if (p.selected === s.id) floorLight(ctx, x + 24, y + 40, 22, 9, "#facc15", 0.18);
  if (lit) floorLight(ctx, x + 24, y + 38, 20, 6, COLOR[s.attention], s.attention === "needs_you" && p.frame % 8 < 4 ? 0.22 : 0.12);

  paintMonitor(ctx, s, x + 10, y + 3, p.frame);
  // Mesa: tablero con canto, frente y patas.
  rect(ctx, x + 4, y + 25, 40, 1, "#64748b");
  rect(ctx, x + 4, y + 26, 40, 3, "#475569");
  rect(ctx, x + 4, y + 29, 40, 3, "#334155");
  rect(ctx, x + 6, y + 32, 2, 6, "#1e293b");
  rect(ctx, x + 40, y + 32, 2, 6, "#1e293b");
  // Teclado y ratón.
  rect(ctx, x + 17, y + 26, 14, 2, "#1e293b");
  rect(ctx, x + 18, y + 26, 12, 1, "#273449");
  rect(ctx, x + 34, y + 26, 2, 2, "#1e293b");
  if (s.attention === "idle" && s.alive) paintMug(ctx, x + 7, y + 22, p.frame);

  if (s.alive) paintOperator(ctx, s, x + 17, y + 29, p.frame);
  else paintEmptyChair(ctx, x + 29, y + 36);
  paintSubagents(ctx, s, x, y, p.frame);

  paintBubble(ctx, s, x + 36, y, p.frame);
  const caption = s.title ?? deskName(s);
  drawText(ctx, fit(caption, d.w - 4), x + 2, y + 50, s.alive ? "#94a3b8" : "#475569");
  ctx.restore();

  if (p.selected === s.id) {
    frameRect(ctx, x, y, d.w, d.h - 1, p.frame % 4 < 2 ? "#facc15" : "#a16207");
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
  rect(ctx, x, y, w, 1, "#334155");
  rect(ctx, x + 12, y + h, 4, 3, "#1e293b");
  rect(ctx, x + 9, y + h + 2, 10, 1, "#334155");
  const sx = x + 2;
  const sy = y + 2;
  const sw = w - 4;
  const sh = h - 4;
  rect(ctx, sx, sy, sw, sh, flashing ? "#7f1d1d" : SCREEN_BG[a]);

  const seed = hash(s.id);
  if (a === "working") {
    // Código que va bajando: cada línea tiene su largo y se desplaza con el tiempo.
    for (let i = 0; i < 6; i++) {
      const lineNo = i + Math.floor(frame / 2);
      const len = 3 + Math.floor(rand(seed + lineNo) * (sw - 7));
      const indent = Math.floor(rand(seed * 3 + lineNo) * 3) * 2;
      const c = rand(seed + lineNo * 7) > 0.7 ? "#86efac" : color;
      rect(ctx, sx + 2 + indent, sy + 1 + i * 2, Math.min(len, sw - 4 - indent), 1, c);
    }
    if (frame % 4 < 2) rect(ctx, sx + 2, sy + sh - 2, 2, 1, "#bbf7d0");
  } else if (a === "needs_you") {
    const fg = flashing ? "#fecaca" : color;
    rect(ctx, sx + sw / 2 - 1, sy + 3, 2, 5, fg);
    rect(ctx, sx + sw / 2 - 1, sy + 10, 2, 2, fg);
  } else if (a === "finished") {
    const cx = sx + sw / 2 - 4;
    const cy = sy + 7;
    for (let i = 0; i < 3; i++) rect(ctx, cx + i, cy + i, 2, 2, color);
    for (let i = 0; i < 5; i++) rect(ctx, cx + 3 + i, cy + 2 - i, 2, 2, color);
  } else if (a === "idle") {
    // Salvapantallas: un punto que rebota.
    const t = frame % 40;
    const px = t < 20 ? t : 40 - t;
    rect(ctx, sx + 2 + Math.floor((px / 20) * (sw - 6)), sy + 2 + Math.floor(Math.abs(Math.sin(frame / 5)) * (sh - 5)), 2, 2, "#475569");
  } else {
    rect(ctx, sx + sw - 5, sy + 2, 2, 1, "#1e293b");
  }
  withAlpha(ctx, 0.18, () => {
    for (let yy = sy + 1; yy < sy + sh; yy += 2) rect(ctx, sx, yy, sw, 1, "#000");
  });
}

function paintMug(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  rect(ctx, x, y, 4, 4, "#e2e8f0");
  rect(ctx, x + 4, y + 1, 1, 2, "#e2e8f0");
  rect(ctx, x + 1, y, 2, 1, "#78350f");
  // Vapor.
  const t = frame % 12;
  withAlpha(ctx, 0.6, () => {
    rect(ctx, x + 1 + (t < 6 ? 0 : 1), y - 2 - (t % 3), 1, 1, "#cbd5e1");
    rect(ctx, x + 2 + (t < 6 ? 1 : 0), y - 4 - (t % 2), 1, 1, "#94a3b8");
  });
}

/** Operador de espaldas frente a su monitor. */
function paintOperator(ctx: CanvasRenderingContext2D, s: SessionView, x: number, y: number, frame: number) {
  const seed = hash(s.id);
  const hair = HAIR[seed % HAIR.length];
  const skin = SKIN[(seed >>> 4) % SKIN.length];
  const shirt = SHIRT[(seed >>> 8) % SHIRT.length];
  const headphones = (seed >>> 12) % 3 === 0;
  const a = s.attention;
  const typing = a === "working";
  const waving = a === "needs_you";
  const relaxed = a === "finished";
  const bob = a === "idle" && frame % 20 < 10 ? 1 : 0;

  // Silla: respaldo, asiento y ruedas (se pintan antes para quedar detrás del torso).
  rect(ctx, x + 6, y + 19, 2, 3, "#0f172a");
  rect(ctx, x + 2, y + 22, 10, 1, "#0f172a");

  // Cabeza (de espaldas): pelo, orejas y nuca.
  const hy = y + bob - (relaxed ? 1 : 0);
  rect(ctx, x + 3, hy, 8, 7, hair);
  rect(ctx, x + 2, hy + 3, 1, 2, skin);
  rect(ctx, x + 11, hy + 3, 1, 2, skin);
  rect(ctx, x + 5, hy + 7, 4, 1, skin);
  if (headphones) {
    rect(ctx, x + 3, hy - 1, 8, 1, "#0f172a");
    rect(ctx, x + 1, hy + 2, 2, 3, "#0f172a");
    rect(ctx, x + 11, hy + 2, 2, 3, "#0f172a");
  }
  // Torso.
  rect(ctx, x, y + 8, 14, 7, shirt);
  withAlpha(ctx, 0.25, () => rect(ctx, x, y + 13, 14, 2, "#000"));
  // Brazos y manos.
  if (typing) {
    const up = frame % 2 === 0;
    rect(ctx, x - 1, y + 7, 2, 4, shirt);
    rect(ctx, x + 13, y + 7, 2, 4, shirt);
    rect(ctx, x + 1, y - 2 + (up ? 0 : 1), 2, 1, skin);
    rect(ctx, x + 11, y - 2 + (up ? 1 : 0), 2, 1, skin);
  } else if (waving) {
    const high = frame % 6 < 3;
    rect(ctx, x + 13, y + (high ? -2 : 0), 2, 9, shirt);
    rect(ctx, x + 13, y + (high ? -4 : -2), 2, 2, skin);
    rect(ctx, x - 1, y + 9, 2, 4, shirt);
  } else if (relaxed) {
    // Manos detrás de la cabeza.
    rect(ctx, x + 1, y + 1, 2, 7, shirt);
    rect(ctx, x + 11, y + 1, 2, 7, shirt);
    rect(ctx, x + 2, y, 2, 2, skin);
    rect(ctx, x + 10, y, 2, 2, skin);
  } else {
    rect(ctx, x - 1, y + 9, 2, 5, shirt);
    rect(ctx, x + 13, y + 9, 2, 5, shirt);
  }
  // Respaldo de la silla.
  rect(ctx, x + 1, y + 13, 12, 6, "#1e293b");
  rect(ctx, x + 1, y + 13, 12, 1, "#334155");
}

function paintEmptyChair(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x, y, 12, 6, "#1e293b");
  rect(ctx, x, y, 12, 1, "#334155");
  rect(ctx, x + 5, y + 6, 2, 3, "#0f172a");
  rect(ctx, x + 1, y + 9, 10, 1, "#0f172a");
}

/** Drones de subagente orbitando el monitor. */
function paintSubagents(ctx: CanvasRenderingContext2D, s: SessionView, x: number, y: number, frame: number) {
  const shown = s.subagents.slice(0, 4);
  shown.forEach((a, i) => {
    const t = frame / 6 + (i * Math.PI * 2) / shown.length;
    const dx = Math.round(x + 22 + Math.cos(t) * 20);
    const dy = Math.round(y + 12 + Math.sin(t) * 7);
    const eye = a.last_tool ? "#34d27a" : "#4cb8f5";
    withAlpha(ctx, 0.3, () => rect(ctx, dx + 1, dy + 7, 3, 1, "#000"));
    rect(ctx, dx, dy, 5, 4, "#cbd5e1");
    rect(ctx, dx, dy + 3, 5, 1, "#94a3b8");
    rect(ctx, dx + 1, dy + 1, 1, 1, eye);
    rect(ctx, dx + 3, dy + 1, 1, 1, eye);
    rect(ctx, dx + 2, dy - 2, 1, 2, "#64748b");
    if (frame % 4 < 2) rect(ctx, dx + 2, dy - 3, 1, 1, eye);
  });
  if (s.subagents.length > 4) drawText(ctx, `+${s.subagents.length - 4}`, x + 1, y + 42, "#94a3b8");
}

function paintBubble(ctx: CanvasRenderingContext2D, s: SessionView, x: number, y: number, frame: number) {
  let symbol: string | null = null;
  let ink = COLOR[s.attention];
  if (s.attention === "needs_you") {
    symbol = frame % 8 < 6 ? "!" : null;
    ink = "#b91c1c";
  } else if (s.attention === "finished") {
    symbol = "OK";
    ink = "#0369a1";
  } else if (s.muted) {
    symbol = "ZZ";
    ink = "#64748b";
  }
  if (!symbol) return;
  const w = textWidth(symbol) + 4;
  const bobY = s.attention === "needs_you" ? (frame % 4 < 2 ? 0 : -1) : 0;
  rect(ctx, x, y + bobY, w, 9, "#f8fafc");
  rect(ctx, x + 1, y + 9 + bobY, 2, 2, "#f8fafc");
  drawText(ctx, symbol, x + 2, y + 2 + bobY, ink);
}
