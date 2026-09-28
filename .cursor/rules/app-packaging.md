# Packaging and startup

> Leaf of `app-shell.mdc`. Read it before touching bundling, the sidecar, autostart or icons.

- `npm run package` = `scripts/sidecar.sh` (release build of `warroom-hook` copied to
  `src-tauri/binaries/warroom-hook-<target-triple>`) + `tauri build --config src-tauri/tauri.bundle.conf.json`.
- `externalBin` lives **only** in `tauri.bundle.conf.json`: in `tauri.conf.json` it makes every
  `cargo test`/`tauri dev` require the sidecar to exist.
- Bundles put `warroom-hook` next to the app binary (`/usr/bin/` in the RPM), which is where the
  installer looks (`lib.rs::built_bridge`). Verified by inspecting the RPM (`rpm -qlp`); the installed
  package was not run.
- Autostart: `tauri-plugin-autostart` (v2 — v3 is alpha) writes the XDG autostart entry with `--hidden`.
- Icons: `src-tauri/app-icon.png` (generated pixel screen) → `cargo tauri icon`. The tray icon is drawn
  at runtime (`tray.rs::lamp`).
