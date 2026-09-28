# The pixel-art War Room

> Leaf of `frontend.mdc`. Read it before touching `src/ui/pixel/`.

A top-down mission control in the spirit of pixel-agents: a screen wall at the front, one raised tier
per repo with a bank of consoles (one per session), operators with headsets who walk between their
console and the lobby next door. Classic and pixel views show the same state; the pixel one adds movement.

- **Two rooms, one office.** `layoutOffice` stacks the war room (`bands.war`) and, under its bottom
  wall, the lobby (`bands.lobby`, its own wall, then the crew lounge); each fills the window. The only
  way between them is `lobbyDoor`, a walkable tile of the war room's bottom wall. The scene shows one
  band at a time (tabs "War room | Lobby n", remembered in `awr.pixelRoom`; clicking the doorway,
  `doorwayAtPoint`, switches): the canvas is the band's height and the transform shifts it up, so the
  sim and hit tests keep working in office coordinates. Idle agents walk down through the doorway.

- **Width.** The layout follows the room's width with no side panel open (`roomWidth`: window minus
  the page margins), so opening the preview never reflows the room or re-seats anyone: the canvas
  just shrinks keeping its aspect ratio (smoothed while shrunk, `data-shrunk`). Only a window resize
  relays it out.
- **Logical pixels.** The art is drawn in low-resolution logical pixels (office width = that width /
  scale, scale 2–4 from `pixelScale`); the canvas has one pixel per CSS pixel and `setTransform(scale)`
  blows the art up. Integer rects only; no smoothing. Names under the chairs use a finer font pixel
  (`nameDot`: two CSS pixels, so half the art's size at scale 4) to fit twice the letters.
- **`office.ts` is pure and tested**: 16 px tiles, `WALL_ROWS` of wall on top of each room, zones packed
  in shelves and centered, each desk cell 3×3 tiles (console row, seat row, aisle). A repo with more than
  `FOLD_AFTER` sessions keeps consoles only for live ones; closed ones go into a cabinet ("+N",
  click → classic view filtered to that repo). Lounge in the lobby, a row under its wall: furniture on its top row,
  spots in front of it, on the sofas, and chatting pairs in mingle rows it adds until every idle agent
  has a spot. Door at the top left, `walkable` grid and 4-way BFS `findPath`. Chairs are not walkable
  (only a goal), so nobody walks through a seated agent. Each desk has a ring of `slots` round the
  chair (left, aisle corners, right) for its subagents.
- **`sim.ts` is pure and tested**: `goals()` says where each agent wants to be (working / needs you /
  finished / stuck → its seat; idle → a lounge spot that changes every ~15–23 s; closed → no agent),
  `step()` walks actors there at 3 tiles/s. New agents come in through the door, gone ones walk out.
  **Running subagents are actors too** (`subagentKey`, `owner` = their session): they stand up from
  their agent's chair, stand spread over the ring and take a step round it every 5–8 s; finished ones
  (or those of a closed session) have no goal, so they walk out through the door. Finished subagents
  are only in the detail panel. On the first frame and on a new width the scene re-seats everyone
  instead (no parade).
- **`sprites.ts`**: 12×17 chibi agents as pixel maps (front, back, side, walk frames), seated from
  behind with a headset, waving (hand up beside the head, part of the sprite), lounging, and a 7×9
  mini. Arms hang inside the silhouette: nothing may stick out of the torso's outline
  (`sprites.test.ts` checks it). Never draw limbs as separate overlays. **The shirt is the agent**:
  Claude orange, Codex white, Cursor charcoal, Antigravity blue; hair and skin from `hash(id)`.
- **`paint.ts`**: dark panel floor with a faint grid; screen wall (telemetry with today's usage, main
  screen with counters, a trajectory and the ticker of what needs you, MET clock), tiers with a lit
  step and a sign ("REPO n · tokens"), then everything standing sorted by its feet `y` (console →
  operator → chair back, sofa back → agent → sofa front), then bubbles ("!", "?", OK, ZZ, "..." when
  chatting) and selection corners. **Usage is drawn, not written**: context fill on each monitor's
  bottom bezel (amber, then blinking red before compaction), tokens as cyan bars and cost as amber
  bars on the console (log scale, `paperStack`/`coinStack`). Running subagents show a glyph of what
  they do (`toolGlyph`: $ command, R read, E edit, S search, W web, A delegate). Names sit on the
  floor under each chair. Decoration is seeded (`hash`, `rand`) so nothing flickers.
- **`font.ts`** is a 3×5 bitmap font: uppercase, no accents, unknown glyphs → "?". Add glyphs when
  copy needs them.
- 20 fps; the loop reads live state from a ref and is never restarted; a new width or a lobby pushed
  down re-seats everyone. Hit test: doorway, cabinet, subagent, then the agent wherever it is (both
  where their actor is), then the desk cell. Right click on a desk or agent opens `DeskMenu` (preview,
  go to / resume, read the answer, seen, mute, dismiss).
- Always check with screenshots (`npm run shot` takes `pixel` and, 2.5 s later, `pixel-later`):
  overlap, depth and colour bugs only show up there.
