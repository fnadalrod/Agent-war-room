# The pixel-art office

> Leaf of `frontend.mdc`. Read it before touching `src/ui/pixel/`.

A top-down office in the spirit of pixel-agents: one zone (rug + plaque) per repo, a desk per
session, agents that walk between their desk and the lounge. Classic and pixel views show the same
state; the pixel one only adds movement.

- **Logical pixels.** The canvas is drawn at low resolution (office width = CSS width / scale, scale
  2–4 from `pixelScale`) and scaled with `image-rendering: pixelated`. Integer rects only; no smoothing.
- **`office.ts` is pure and tested**: 16 px tiles, `WALL_ROWS` of wall, zones packed in shelves and
  centered, each desk cell 3×3 tiles (desk row, seat row, aisle), lounge along the bottom (furniture
  on its top row, spots in front of it or on the sofas), door at the top left, `walkable` grid and
  4-way BFS `findPath`. Subagents stand in fixed `slots` beside the chair and in the aisle corners
  (`miniFeet`), so they can be clicked.
- **`sim.ts` is pure and tested**: `goals()` says where each agent wants to be (working / needs you /
  finished / stuck → its seat; idle → a lounge spot that changes every ~15–23 s; closed → no agent),
  `step()` walks actors there at 3 tiles/s. New agents come in through the door, gone ones walk out.
  On the first frame and on a new width the scene re-seats everyone instead (no parade).
- **`sprites.ts`**: 10×14 chibi agents as pixel maps (front, back, side; walk frames; seated from
  behind with typing hands; lounging), recoloured per agent. **The shirt is the agent**: Claude
  orange, Codex white, Cursor charcoal, Antigravity blue; hair and skin come from `hash(id)`.
- **`paint.ts`**: floor planks, wall (windows whose sky follows the local hour, board with counters and
  a ticker of what needs you, clock, door), rugs, then everything standing sorted by its feet `y`
  (desk → agent → chair back, sofa back → agent → sofa front), then bubbles ("!", "?", OK, ZZ) and
  selection corners. Monitors carry the state (code, "!", ✓, "?", screensaver, off). Names sit on
  the floor under each chair. Decoration is seeded (`hash`, `rand`) so nothing flickers.
- **`font.ts`** is a 3×5 bitmap font: uppercase, no accents, unknown glyphs → "?". Add glyphs when
  copy needs them.
- 20 fps; the loop reads live state from a ref and is never restarted. Hit test: subagent, then the
  agent wherever it is, then the desk cell.
- Always check with screenshots (`npm run shot` takes `pixel` and, 2.5 s later, `pixel-later`):
  overlap, depth and colour bugs only show up there.
