// Fuente bitmap de 3×5 píxeles: cada glifo son 5 filas de 3 bits (bit alto = columna izquierda).
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
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** Ancho de un carácter más su separación. */
export const ADVANCE = GLYPH_W + 1;

/** Mayúsculas sin tildes; lo que no tenga glifo se vuelve "?". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split("")
    .map((c) => (c in GLYPHS ? c : "?"))
    .join("");
}

export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * ADVANCE - 1;
}

/** Recorta a `maxWidth` píxeles con "." final si no cabe. */
export function fit(text: string, maxWidth: number): string {
  const t = normalize(text);
  const max = Math.floor((maxWidth + 1) / ADVANCE);
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}.`;
}

/** Pinta texto ya normalizado en coordenadas lógicas. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  for (const ch of normalize(text)) {
    const rows = GLYPHS[ch];
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (rows[r] & (1 << (GLYPH_W - 1 - c))) ctx.fillRect(cx + c, Math.round(y) + r, 1, 1);
      }
    }
    cx += ADVANCE;
  }
}
