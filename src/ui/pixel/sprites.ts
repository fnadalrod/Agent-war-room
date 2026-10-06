// Character sprites as pixel maps (one letter per pixel, "." is transparent), recoloured per agent.
// 12×17 chibi agents seen from the front, back and side (arms hang along the torso, hands at its
// bottom corners), seated from behind with a headset, and a 7×9 mini for subagents.

/** Palette keys: k outline, s skin, h/H hair, a hair highlight, e eyes, r cheeks, c/C shirt, p trousers, b shoes,
 *  m headset, l its light. */
export type Palette = Record<string, string>;
export type Sprite = string[];

const HEAD_FRONT = [
  "...kkkkkk...",
  "..khaahhhk..",
  ".khaaahhhhk.",
  ".khhhhhhHHk.",
  ".khsshhsshk.",
  ".kssssssssk.",
  ".ksesSesSsk.",
  ".ksrssssrsk.",
  "..kSSssSSk..",
  "...kkkkkk...",
];
const HEAD_BACK = [
  "...kkkkkk...",
  "..khaahhhk..",
  ".khaaahhhhk.",
  ".khhhhhhHHk.",
  ".khhhhhhHHk.",
  ".khhhhhhHHk.",
  ".kHhhhhhhHk.",
  ".kHhhhhhHHk.",
  "..kHhhhhHk..",
  "...kkkkkk...",
];
const HEAD_SIDE = [
  "...kkkkk....",
  "..khaahhk...",
  ".khaaahhHk..",
  ".khaaahhHk..",
  ".khhhhhssk..",
  ".khhhhsssk..",
  ".khhhhsesk..",
  ".kHhhsssrk..",
  "..kHssssk...",
  "...kkkkk....",
];
const TORSO = ["..kccSScck..", ".kCccCcccCk.", ".kCccCclcCk.", ".ksccCcccsk.", "..kPPppPPk.."];
const TORSO_SIDE = ["...kcccck...", "...kcCcck...", "...kcClck...", "...kcScck...", "...kppppk..."];
const LEGS = {
  stand: ["..kPp..pPk..", "..kbb..bbk.."],
  a: ["..kPp..pPk..", "..kbb...kk.."],
  b: ["..kPp..pPk..", "...kk..bbk.."],
};
const LEGS_SIDE = {
  stand: ["...kppk.....", "...kbbk....."],
  a: ["..kpk.kpk...", "..kbk.kbk..."],
  b: ["...kppk.....", "...kbbk....."],
};
const SEATED = [
  "...kkkkkk...",
  "..kmmmmmmk..",
  ".khaaahhhhk.",
  ".khhhhhhHHk.",
  ".mhhhhhhHHm.",
  ".lhhhhhHHHl.",
  ".kHhhhhhhHk.",
  ".kHhhhhhHHk.",
  "..kHhhhhHk..",
  "..kkkkkkkk..",
  ".kCccccccCk.",
  ".kCccCCccCk.",
  ".kCCccccCCk.",
];
/** Typing: the shoulders shift as the hands move (out of sight, on the console). */
const SEATED_TYPING = [...SEATED.slice(0, 10), ".kCccccccCk.", ".kcCccCCcCk.", ".kCccccCCck."];

export type Facing = "down" | "up" | "left" | "right";

/** A standing or walking agent; `frame` alternates the legs while walking. */
export function body(facing: Facing, walking: boolean, frame: number): Sprite {
  const legs = !walking ? "stand" : frame % 2 === 0 ? "a" : "b";
  if (facing === "left" || facing === "right") return [...HEAD_SIDE, ...TORSO_SIDE, ...LEGS_SIDE[legs]];
  return [...(facing === "up" ? HEAD_BACK : HEAD_FRONT), ...TORSO, ...LEGS[legs]];
}

/** Seated at the console, seen from behind, with a headset; the shoulders move while typing. */
export function seated(typing: boolean, frame: number): Sprite {
  return typing && frame % 2 === 1 ? SEATED_TYPING : SEATED;
}

/** Seated with the right hand up, waving beside the head (13 wide). */
export function waving(frame: number): Sprite {
  const up = frame % 2 === 1;
  const arm: Record<number, string> = up
    ? { 2: "kk", 3: "sk", 4: "sk", 5: "ck", 6: "ck", 7: "ck", 8: "ck", 9: "ck" }
    : { 3: "kk", 4: "sk", 5: "sk", 6: "ck", 7: "ck", 8: "ck", 9: "ck" };
  return SEATED.map((row, i) => {
    const wide = `${row}.`;
    if (i === 10) return `${wide.slice(0, 10)}cck`;
    return arm[i] ? wide.slice(0, 11) + arm[i] : wide;
  });
}

/** Seated on a sofa, facing us (the sofa hides the legs). */
export const lounging: Sprite = [...HEAD_FRONT, ...TORSO];

export const MINI: Sprite = ["..kkk..", ".khhhk.", "khhhhhk", "ksesesk", ".ksssk.", "kccCcck", "kCclcCk", ".kpkpk.", ".kk.kk."];

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
  return {
    k: "#140f1c",
    K: "#140f1c",
    s,
    S,
    h,
    H,
    a: hairHighlight(h),
    e: "#140f1c",
    r: "#e79a8f",
    c,
    C,
    p: "#343a52",
    P: "#272c40",
    b: "#1d1824",
    m: "#0b0f19",
    l: "#22d3ee",
  };
}

/** A small lit patch keeps dark hair readable against the room. */
function hairHighlight(color: string): string {
  const channels = color.slice(1).match(/../g)!;
  return `#${channels.map((c) => Math.round(parseInt(c, 16) * 0.72 + 255 * 0.28).toString(16).padStart(2, "0")).join("")}`;
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
