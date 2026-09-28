# The pixel-art War Room

> Leaf of `frontend.mdc`. Read it before touching `src/ui/pixel/`.

- **Logical pixels.** The canvas is drawn at low resolution (`layoutScene` width = CSS width / scale,
  scale 2–4 from `pixelScale`) and scaled with `image-rendering: pixelated`. Draw with integer rects
  (`paint.ts::rect`); never smooth.
- **`layout.ts` is pure and tested**: one bay per repo, desks in a grid, bays packed in shelves and
  centered on both axes, room at least the viewport height. Drones (subagents) sit in **fixed slots**
  around the monitor (`DRONE_SLOTS`, 5 max, then "+N") so they can be clicked; `hitTest` returns
  `{session, agent}` and a drone wins over its desk.
- **`paint.ts` draws**: wall (main screen with a marquee of what needs you, clock, windows with a
  skyline, racks, beacons that blink on alarm), floor lights under lit monitors, desks with monitor
  states (code lines, "!", ✓, screensaver), operators (typing, waving, relaxed, mug when idle, empty
  chair when closed), bubbles ("!", OK, ZZ, "?" for stalled), drones (floating when running, parked
  when finished). Random-looking details come from `hash(id)` / `rand(seed)` so nothing flickers.
- **`font.ts`** is a 3×5 bitmap font: uppercase, no accents (normalised), unknown glyphs → "?". Add
  glyphs there when copy needs them (`>` and `<` were missing once and rendered as "??").
- Frame rate 10 fps; the render loop reads live state from a ref so it is never restarted.
- Always check with screenshots: layout, overlap and colour bugs only show up there.
