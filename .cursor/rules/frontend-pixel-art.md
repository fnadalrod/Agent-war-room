# The pixel-art War Room

> Leaf of `frontend.mdc`. Read it before touching `src/ui/pixel/`.

A top-down mission control in the spirit of pixel-agents: a screen wall at the front, armored command decks
per repo with a bank of consoles (one per session), operators with headsets who walk between their
console and the lobby next door. Classic and pixel views show the same state; the pixel one adds movement.

- **War room and divided lobby.** `layoutOffice` stacks the war room (`bands.war`) and, under its bottom
  wall, the lobby (`bands.lobby`, its own wall, then the crew lounge); each fills the window. The only
  way between them is `lobbyDoor`, a walkable tile of the war room's bottom wall. The scene shows one
  band at a time (tabs "War room | Lobby n", remembered in `awr.pixelRoom`; clicking the doorway,
  `doorwayAtPoint`, switches): the canvas is the band's height and the transform shifts it up, so the
  sim and hit tests keep working in office coordinates. Idle agents walk down through the doorway. Inside the lobby, a partition separates a restrained
  slate team room from a premium wood/brass principals club. Their goals and conversation pairs
  stay in their own room. On narrow layouts the rooms stack; both have reachable doorways.

- **Width.** The layout follows the room's width with no side panel open (`roomWidth`: window minus
  the page margins), so opening the preview never reflows the room or re-seats anyone: the canvas
  just shrinks keeping its aspect ratio (smoothed while shrunk, `data-shrunk`). Only a window resize
  relays it out. The pixel view occupies the viewport height; a `ResizeObserver` measures the
  remaining canvas area below the header, banners, filters and room tabs. `fitViewport` contains
  the whole room in both axes (including the border), centring it without document scrolling.
  Opening the terminal also reserves its height. Hit tests use the fitted canvas content bounds.
- **Logical pixels.** The art is drawn in low-resolution logical pixels (office width = that width /
  scale, scale 2–4 from `pixelScale`); the canvas has one pixel per CSS pixel and `setTransform(scale)`
  blows the art up. Integer rects only; no smoothing. Names under the chairs use a finer font pixel
  (`nameDot`: two CSS pixels, so half the art's size at scale 4) to fit twice the letters.
- **`office.ts` is pure and tested**: 16 px tiles, a taller `WAR_WALL_ROWS` command wall and `WALL_ROWS` lobby wall, zones packed
  in shelves and centered, each desk cell is three tiles wide, with extra aisle rows for larger teams. Repositories
  without any live, unarchived session have no module (history remains in the classic view). A repo with more than
  `FOLD_AFTER` sessions keeps consoles only for live ones; closed ones go into a cabinet ("+N",
  click → classic view filtered to that repo). The lobby has repeated seating nooks on either side of a central aisle: sofas,
  coffee tables, plants/lamps and refreshment, reading or arcade corners. Furniture (including sofas) blocks
  transit; sofa tiles remain reachable as goals. Chatting pairs occupy separate rows at the bottom,
  and capacity grows until every idle principal and finished teammate has a spot. Door at the top left, `walkable` grid and 4-way BFS `findPath`. Chairs are not walkable
  (only a goal), so nobody walks through a seated agent. Each desk has a ring of `slots` round the
  chair (left, aisle corners, right) for its subagents.
- **`sim.ts` is pure and tested**: `goals()` says where each agent wants to be (working / needs you /
  finished / stuck → its seat; idle → a lounge spot that changes every ~15–23 s; closed → no agent),
  `step()` walks actors there at 3 tiles/s. New agents come in through the door, gone ones walk out.
  **Running subagents are actors too** (`subagentKey`, `owner` = their session): they stand up from
  their agent's chair, stand spread over the ring and take a step round it every 5–8 s; finished ones
  walk to the lobby and remain clickable for their results while their principal is alive. Closed
  sessions and their teammates leave. Lobby occupants alternate rest and facing conversation pairs
  every 18 seconds, changing partners each social round; bubbles take turns only with a nearby partner. On the first frame and on a new width the scene re-seats everyone
  instead (no parade).
- **`sprites.ts`**: 12×17 chibi agents as pixel maps (front, back, side, walk frames), seated from
  behind with a headset, waving (hand up beside the head, part of the sprite), lounging. Principals and subagents use the same full-size bodies; hit targets match. Arms hang inside the silhouette: nothing may stick out of the torso's outline
  (`sprites.test.ts` checks it). Never draw limbs as separate overlays. **The shirt is the agent**:
  Claude orange, Codex white, Cursor charcoal, Antigravity blue; hair and skin from `hash(id)`.
- **`paint.ts`**: dark panel floor with a faint grid; screen wall (telemetry with today's usage, main
  screen with counters, a radar map keyed to repository colours and the ticker of what needs you,
  MET clock), chamfered decks following the occupied console rows (short final rows make a stepped
  outline), with recessed floor sockets, entry ramps, sector lighting and a sign ("REPO n · tokens"), then everything standing sorted by its feet `y` (console →
  operator → chair back, sofa back → agent → sofa front), then bubbles ("!", "?", OK, ZZ, "..." when
  chatting) and selection corners. **Usage is drawn, not written**: context fill on each monitor's
  bottom bezel (amber, then blinking red before compaction), tokens as cyan bars and cost as amber
  bars on the console (log scale, `paperStack`/`coinStack`). Running subagents show a glyph of what
  they do (`toolGlyph`: $ command, R read, E edit, S search, W web, A delegate). The lobby uses staggered wood boards, woven rugs under each nook, warm floor lamps and skyline
  windows; all decor stays behind actors and furniture. Names sit on the
  floor under each chair. Decoration is seeded (`hash`, `rand`) so nothing flickers.
- **`font.ts`** is a 3×5 bitmap font: uppercase, no accents, unknown glyphs → "?". Add glyphs when
  copy needs them.
- 20 fps; the loop reads live state from a ref and is never restarted; a new width or a lobby pushed
  down re-seats everyone. Hit test: doorway, cabinet, subagent, then the agent wherever it is (both
  where their actor is), then the desk cell. Right click on a desk or agent opens `DeskMenu` (preview,
  go to / resume, read the answer, seen, mute, dismiss).
- Always check with screenshots (`npm run shot` takes `pixel` and, 2.5 s later, `pixel-later`):
  overlap, depth and colour bugs only show up there.
