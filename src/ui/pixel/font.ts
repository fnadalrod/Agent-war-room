// 3×5 pixel bitmap font: each glyph is 5 rows of 3 bits (high bit = left column).
const GLYPHS: Record<string, number[]> = {
  A: [0b010, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b011, 0b100, 0b100, 0b100, 0b011],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b011, 0b100, 0b101, 0b101, 0b011],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b010],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b010, 0b101, 0b101, 0b101, 0b010],
  P: [0b110, 0b101, 0b110, 0b100, 0b100],
  Q: [0b010, 0b101, 0b101, 0b110, 0b011],
  R: [0b110, 0b101, 0b110, 0b101, 0b101],
  S: [0b011, 0b100, 0b010, 0b001, 0b110],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
  "0": [0b111, 0b101, 0b101, 0b101, 0b111],
  "1": [0b010, 0b110, 0b010, 0b010, 0b111],
  "2": [0b110, 0b001, 0b010, 0b100, 0b111],
  "3": [0b110, 0b001, 0b010, 0b001, 0b110],
  "4": [0b101, 0b101, 0b111, 0b001, 0b001],
  "5": [0b111, 0b100, 0b110, 0b001, 0b110],
  "6": [0b011, 0b100, 0b111, 0b101, 0b111],
  "7": [0b111, 0b001, 0b010, 0b010, 0b010],
  "8": [0b111, 0b101, 0b111, 0b101, 0b111],
  "9": [0b111, 0b101, 0b111, 0b001, 0b110],
  " ": [0, 0, 0, 0, 0],
  "-": [0, 0, 0b111, 0, 0],
  ".": [0, 0, 0, 0, 0b010],
  ",": [0, 0, 0, 0b010, 0b100],
  "!": [0b010, 0b010, 0b010, 0, 0b010],
  "?": [0b110, 0b001, 0b010, 0, 0b010],
  ":": [0, 0b010, 0, 0b010, 0],
  "/": [0b001, 0b001, 0b010, 0b100, 0b100],
  _: [0, 0, 0, 0, 0b111],
  "(": [0b001, 0b010, 0b010, 0b010, 0b001],
  ")": [0b100, 0b010, 0b010, 0b010, 0b100],
  "+": [0, 0b010, 0b111, 0b010, 0],
  ">": [0b100, 0b010, 0b001, 0b010, 0b100],
  "<": [0b001, 0b010, 0b100, 0b010, 0b001],
  "#": [0b101, 0b111, 0b101, 0b111, 0b101],
  "'": [0b010, 0b010, 0, 0, 0],
  "·": [0, 0, 0b010, 0, 0],
  $: [0b011, 0b110, 0b010, 0b011, 0b110],
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** Width of a character plus its spacing. */
export const ADVANCE = GLYPH_W + 1;

/** Uppercase without accents; anything without a glyph becomes "?". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split("")
    .map((c) => (c in GLYPHS ? c : "?"))
    .join("");
}

/** Width in logical pixels; `px` is the size of a font pixel (1, or smaller for fine text). */
export function textWidth(text: string, px = 1): number {
  return text.length === 0 ? 0 : (text.length * ADVANCE - 1) * px;
}

/** Truncates to `maxWidth` pixels with a trailing "." if it does not fit. */
export function fit(text: string, maxWidth: number, px = 1): string {
  const t = normalize(text);
  const max = Math.floor((maxWidth / px + 1) / ADVANCE);
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}.`;
}

/**
 * Draws text (normalized here) at logical coordinates. With `px` < 1 the glyphs are finer than the
 * art: the canvas must be scaled so that `px` is a whole number of screen pixels.
 */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, px = 1) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const top = Math.round(y);
  for (const ch of normalize(text)) {
    const rows = GLYPHS[ch];
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (rows[r] & (1 << (GLYPH_W - 1 - c))) ctx.fillRect(cx + c * px, top + r * px, px, px);
      }
    }
    cx += ADVANCE * px;
  }
}
