// Character sprites as pixel maps (one letter per pixel, "." is transparent), recoloured per agent.
// 10×14 chibi agents seen from the front, back and side, plus a 6×8 mini for subagents.

/** Palette keys: k outline, s/S skin, h/H hair, e eyes, r cheeks, c/C shirt, p/P trousers, b shoes. */
export type Palette = Record<string, string>;
export type Sprite = string[];

const HEAD_FRONT = ["..kkkkkk..", ".khhhhhhk.", "khhhhhhhhk", "khssssssHk", "kssessessk", "ksrssssrsk", ".kssssssk."];
const HEAD_BACK = ["..kkkkkk..", ".khhhhhhk.", "khhhhhhhhk", "khhhhhhhHk", "khhhhhhhHk", "kHhhhhhhHk", ".khhhhhHk."];
const HEAD_SIDE = ["..kkkkk...", ".khhhhhk..", "khhhhhhhk.", "khhhssssk.", "khhhssesk.", "khhsssrsk.", ".kkssssk.."];

const BODY = ["..kcccck..", ".kcccccck.", "kscccccCsk", ".kcccccCk.", ".kpppppPk."];
const BODY_SIDE = ["..kcccck..", "..kcccck..", "..kccsck..", "..kcccCk..", "..kppppk.."];
const BODY_TYPING = ["..kcccck..", ".kcccccck.", "kcsccccsCk", ".kcccccCk.", ".kpppppPk."];

const LEGS = { stand: [".kpk..kPk.", ".kbk..kbk."], a: [".kpk..kPk.", ".kbk...kk."], b: [".kpk..kPk.", "..kk..kbk."] };
const LEGS_SIDE = { stand: ["..kpkpk...", "..kbkbk..."], a: [".kpk.kpk..", "kbk...kbk."], b: ["...kpk....", "...kbk...."] };

export type Facing = "down" | "up" | "left" | "right";

/** A standing or walking agent; `frame` alternates the legs while walking. */
export function body(facing: Facing, walking: boolean, frame: number): Sprite {
  const legs = !walking ? "stand" : frame % 2 === 0 ? "a" : "b";
  if (facing === "left" || facing === "right") return [...HEAD_SIDE, ...BODY_SIDE, ...LEGS_SIDE[legs]];
  return [...(facing === "up" ? HEAD_BACK : HEAD_FRONT), ...BODY, ...LEGS[legs]];
}

/** Seated at the desk, seen from behind; hands move while typing. */
export function seated(typing: boolean, frame: number): Sprite {
  return [...HEAD_BACK, ...(typing && frame % 2 === 1 ? BODY_TYPING : BODY)];
}

/** Seated on a sofa, facing us (the sofa hides the legs). */
export const lounging: Sprite = [...HEAD_FRONT, ...BODY];

export const MINI: Sprite = [".kkkk.", "khhhhk", "ksesek", ".kssk.", "kcccck", "scccCs", ".kppk.", ".k..k."];

export const SKIN = [
  ["#f6d2b3", "#e2b18f"],
  ["#e8b48c", "#cf9670"],
  ["#c98d62", "#ae7449"],
  ["#91603f", "#784c2f"],
  ["#5e3b27", "#4a2d1d"],
];
export const HAIR = [
  ["#2d1e14", "#1c120c"],
  ["#6e3f1d", "#552f14"],
  ["#d8a13e", "#b7832a"],
  ["#262a33", "#171a21"],
  ["#9b3d2e", "#7c2e22"],
  ["#e9e2d2", "#c9c0ad"],
  ["#5b3a8c", "#452b6c"],
  ["#2f6b5e", "#224f45"],
];
/** The shirt says which agent it is. */
export const SHIRTS: Record<string, [string, string]> = {
  claude: ["#d97757", "#b25b3e"],
  codex: ["#e8eaef", "#b9bec9"],
  cursor: ["#343946", "#22262f"],
  antigravity: ["#4a86f0", "#2f63c4"],
};
const OTHER_SHIRTS: Array<[string, string]> = [
  ["#a855f7", "#7e3bc2"],
  ["#14b8a6", "#0e8b7d"],
  ["#eab308", "#b58a06"],
];

export function palette(provider: string, seed: number): Palette {
  const [s, S] = SKIN[seed % SKIN.length];
  const [h, H] = HAIR[(seed >>> 3) % HAIR.length];
  const [c, C] = SHIRTS[provider] ?? OTHER_SHIRTS[(seed >>> 6) % OTHER_SHIRTS.length];
  return { k: "#1b1523", s, S, h, H, e: "#1b1523", r: "#e79a8f", c, C, p: "#3b4058", P: "#2c3044", b: "#241c2c" };
}

/** Draws a sprite with its top-left at (x, y); `flip` mirrors it (left-facing). */
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number, pal: Palette, flip = false) {
  const w = sprite[0].length;
  for (let row = 0; row < sprite.length; row++) {
    const line = sprite[row];
    for (let col = 0; col < w; col++) {
      const key = line[flip ? w - 1 - col : col];
      if (key === "." || key === undefined) continue;
      ctx.fillStyle = pal[key] ?? pal.k;
      ctx.fillRect(Math.round(x) + col, Math.round(y) + row, 1, 1);
    }
  }
}
