# React front (src/)

- Layers: `domain/` (pure presentation rules + generated types) · `application/` (`WarRoomStore`, ports)
  · `infrastructure/` (Tauri gateway, demo gateway, localStorage) · `ui/` (components).
  `main.tsx` is the composition root: Tauri adapters inside the app, demo adapters in a plain browser.
- `domain/generated/` is generated from Rust (`crates/application/src/view.rs`). Never edit it.
- The store is framework-free; components read it with `useWarRoom(store)` and call its methods.
- All user-visible Spanish text lives in `domain/copy.ts` (in domain because domain helpers produce
  labels too); components never inline strings. Status labels come already translated from Rust
  (`crates/application/src/locale.rs`); the demo gateway mirrors them in its `STATUS` constant.
- Styling: one `ui/styles.css` built on tokens (`--c` = attention color, `--k` = skill source color,
  set via `data-attention` / `data-source`). No CSS framework.
- Pixel art (`ui/pixel/`): `layout.ts` is pure and unit-tested (positions, hit testing, drones);
  `paint.ts` draws in logical pixels on a low-res canvas scaled with `image-rendering: pixelated`;
  `font.ts` is a 3×5 bitmap font (add glyphs there).
- Verify visually with `npm run shot -- <dir>` and read the PNGs; tests alone don't catch layout bugs.
- Tests: Vitest next to the code (`*.test.ts`), fixtures in `src/test/fixtures.ts`.
