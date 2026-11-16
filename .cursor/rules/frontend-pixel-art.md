# The pixel-art War Room

> Leaf of `frontend.mdc`. Read it before touching `src/ui/pixel/`.

A top-down mission control in the spirit of pixel-agents: a screen wall at the front, tiers of consoles curving round it
(one per session, each repo a section of a tier, dark ones waiting for new sessions), operators with headsets who walk between their
console and the lobby next door. Classic and pixel views show the same state; the pixel one adds movement.

- **War room and divided lobby.** `layoutOffice` stacks the war room (`bands.war`) and, under its bottom
  wall, the lobby (`bands.lobby`, its own wall, then the crew lounge); each fills the window. The only
  way between them is `lobbyDoor`, a walkable tile of the war room's bottom wall. The scene shows one
  band at a time (tabs "War room | Lobby n", remembered in `awr.pixelRoom`; clicking the doorway,
  `doorwayAtPoint`, switches). A third tab, **Closed n**, lays `ClosedShelf` over the room (the canvas
  keeps its size): every closed, undismissed session by repo (`closedSessions`, latest closed first)
  with resume (app or Warp, keeping its model and effort: `resumeOptions`), preview and dismiss: the canvas is the band's height and the transform shifts it up, so the
  sim and hit tests keep working in office coordinates. Idle agents walk down through the doorway. Inside the lobby, a partition separates a restrained
  slate team room from a premium wood/brass principals club. Their goals and conversation pairs
  stay in their own room. On narrow layouts the rooms stack; both have reachable doorways.

- **Size.** The layout follows the room's size with no side panel or terminal open (`roomWidth`:
  window minus the page margins; `roomHeight`: from the canvas area's top to the window's bottom),
  so opening the preview or the terminal never reflows the room or re-seats anyone: the canvas just
  shrinks keeping its aspect ratio (smoothed while shrunk, `data-shrunk`). A window resize or the
  filters/banners changing height relays it out. `fitOffice` picks the largest scale whose layout
  fits the room on show in that height (a tall lobby never shrinks the war room), so a wide, short window gets a wide room with smaller art instead
  of a shrunk square; only when even scale 2 is too tall does the view shrink. `fitViewport`
  contains the whole room in both axes (including the border), centring it without document
  scrolling. Hit tests use the fitted canvas content bounds.
- **Logical pixels.** The art is drawn in low-resolution logical pixels (office width = that width /
  scale, scale 2–4: at most `pixelScale` for the width, lower if the height needs it); the canvas has one pixel per CSS pixel and `setTransform(scale)`
  blows the art up. Integer rects only; no smoothing. Names under the chairs use a finer font pixel
  (`nameDot`: two CSS pixels, so half the art's size at scale 4) to fit twice the letters, on up to two
  lines (`wrap` in `font.ts`: between words or after a hyphen, then truncated with a dot).
- **`office.ts` is pure and tested**: 16 px tiles, a taller `WAR_WALL_ROWS` command wall and `WALL_ROWS` lobby wall.
  The war room has **tiers** (`tiers`): rows of consoles `RING_GAP` rows apart, each a gentle arc
  whose ends rise towards the screen (`office.arena`: the middle, `half`, `rise` and each tier's row;
  `ringY` gives a tier's row at a column). Along a tier the 3×3 cells touch (never overlap), mirrored
  about a seat under the middle of the screen, with free columns at the sides as aisles; any a person
  could not walk to is dropped. Every console is laid out before anyone sits. **Each repo is a run of
  neighbouring consoles on a tier** (`packRings`): repos by name fill the tiers from the screen out,
  one free place (empty floor) between two repos, each tier's runs centred; a repo that does not fit a
  tier's tail starts the next tier, one longer than a whole tier carries on into the next. What is
  left is `office.dark` (powered off until a session lights one). The war room grows only when its
  tiers cannot seat every repo. Check layouts under volume with the demo's `?crowd=N`. Desks go by session start (never the core's
  urgency order, or agents would swap consoles whenever one needs you); consoles come in pairs
  (`spares`: a powered-off console with a standby light in the repo's colour) so a new session sits at a
  free one instead of pushing the next repo along. `Zone.segments` are a repo's cells per tier, from the
  screen out (hit tests, joined pads, its glow and sign); `Zone.rect` is only their bounding box. Each desk cell is three tiles wide and three tall
  (always: subagents never stretch it). Repositories
  without any live, unarchived session have no consoles once `LINGER_MS` (15 min) have passed since
  their last one closed (`now` given to `layoutOffice`; history remains in the Closed tab and the classic view). A repo with more than
  `FOLD_AFTER` sessions keeps consoles only for live ones; closed ones go into a cabinet ("+N",
  click → classic view filtered to that repo) standing in one more console place. The lobby has repeated seating nooks on either side of a central aisle: sofas,
  coffee tables, plants/lamps and refreshment, reading or arcade corners. Furniture (including sofas) blocks
  transit; sofa tiles remain reachable as goals. Chatting pairs occupy separate rows at the bottom,
  and capacity grows until every idle principal and finished teammate has a spot. Door at the top left, `walkable` grid and 4-way BFS `findPath`. Every console's desk row and chair
  block, lit or not; a chair is only a goal, so nobody walks through a seated agent. Each desk has two fixed `slots` for its
  running subagents, either side of the chair (the aisle stays clear for the name); however many
  there are, each running one is also a light on the console's front (`squadRack` in `paint.ts`; past what
  the console holds, a "+N"), the hover tip counts them and the desk menu lists them all (up to five, then
  "N more in the preview"), each opening its own preview.
- **`sim.ts` is pure and tested**: `goals()` says where each agent wants to be (working / needs you /
  finished / stuck → its seat; idle → a lounge spot that changes every ~15–23 s; closed → no agent),
  `step()` walks actors there at 3 tiles/s. New agents come in through the door, gone ones walk out.
  **Running subagents are actors too** (`subagentKey`, `owner` = their session): they stand up from
  their agent's chair and stand still at their own slot (no orbiting); finished ones
  walk to the lobby and remain clickable for their results while their principal is alive. Closed
  sessions and their teammates leave. Lobby occupants alternate rest and facing conversation pairs
  every 18 seconds, changing partners each social round; bubbles take turns only with a nearby partner. On the first frame and on a new width the scene re-seats everyone
  instead (no parade); when the floor is laid out again (a session arrives or closes), an agent whose
  desk or slot moved appears there at once (`step`) rather than getting up and marching.
- **`sprites.ts`**: 12×17 chibi agents as pixel maps (front, back, side, walk frames), seated from
  behind with a headset, waving (hand up beside the head, part of the sprite), lounging. Principals and subagents use the same full-size bodies; hit targets match. Arms hang inside the silhouette: nothing may stick out of the torso's outline
  (`sprites.test.ts` checks it). Never draw limbs as separate overlays. **The shirt is the agent**:
  Claude orange, Codex white, Cursor charcoal, Antigravity blue; hair and skin from `hash(id)`.
- **`paint.ts`**: dark panel floor with a faint grid; the screen wall is one wide board listing what
  waits for you in order (`boardEntries`: ! needs you pulsing, hourglass stuck, OK finished; repo · title, "+N"
  when it overflows, ALL QUIET when empty) — no counters or clocks, the header already has them),
  flanked where the wall is wide enough by two wordless screens: a `radar` (a turning sweep, a blip
  per console in its agent's colour, lit as the sweep passes, blinking when it needs you) and a
  `statusRack` (a heartbeat that quickens with working agents, a bar per repo, a light per session).
  Then the floor (`arenaFloor`: the screen's light pool, a glow in its colour under each repo's run,
  a dotted track behind each tier with a light running along it), an armored pad under every
  console edged in its repo's colour (grey when dark; neighbours of the same repo on a tier join into
  one platform), then everything standing sorted by its feet `y` (console →
  operator → chair back, sofa back → agent → sofa front), then bubbles ("!", an hourglass for stuck — never "?", which reads as a question —, OK, ZZ, "..." when
  chatting) and selection corners, names and repo signs (`sign`, one per repo: "REPO n" in the finer `nameDot`
  letters, centred over its run on its innermost tier, above the highest console under it so the
  tier ahead's names stay clear; red while a session there needs you). **A console boots** the first time its session is
  painted (`litAt`, kept by the scene): a white flash, a boot bar and a ring of light leaving its pad for
  `BOOT_FRAMES`; on opening the room every console boots at once. **Usage is drawn, not written**: context fill on each monitor's
  bottom bezel (amber, then blinking red before compaction), tokens as cyan bars and cost as amber
  bars on the console (log scale, `paperStack`/`coinStack`). Running subagents show a glyph of what
  they do (`toolGlyph`: $ command, R read, E edit, S search, W web, A delegate). The lobby uses staggered wood boards, woven rugs under each nook, warm floor lamps and skyline
  windows; all decor stays behind actors and furniture. Names sit on the
  floor under each chair. Decoration is seeded (`hash`, `rand`) so nothing flickers.
- **`font.ts`** is a 3×5 bitmap font: uppercase, no accents, unknown glyphs → "?". Add glyphs when
  copy needs them.
- 20 fps; the loop reads live state from a ref and is never restarted; a new width or a lobby pushed
  down re-seats everyone. Hit test: doorway, cabinet, subagent, then the agent wherever it is (both
  where their actor is), then the desk cell. Right click on a desk or agent opens `DeskMenu`: approve/deny
  (never focused first, so a stray Enter cannot approve), answer a question (preview with the reply
  box), a prompt box when the session is writable (`isWritable`), preview, its app terminal / go to /
  resume, read the answer, seen, mute, dismiss.
- Always check with screenshots (`npm run shot` takes `pixel` and, 2.5 s later, `pixel-later`):
  overlap, depth and colour bugs only show up there.
