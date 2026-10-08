# Packaging and startup

> Leaf of `app-shell.mdc`. Read it before touching bundling, the sidecar, autostart or icons.

- `npm run package` = `scripts/sidecar.mjs` (Node, so it runs on every OS: release build of
  `warroom-hook` copied to `src-tauri/binaries/warroom-hook-<target-triple>[.exe]`) + `tauri build
  --config src-tauri/tauri.bundle.conf.json`. `bundle.targets` is `"all"`: deb/rpm/AppImage on
  Linux, app/dmg on macOS, msi/nsis on Windows. Each OS bundles only on itself (CI `bundle` job).
- `externalBin` lives **only** in `tauri.bundle.conf.json`: in `tauri.conf.json` it makes every
  `cargo test`/`tauri dev` require the sidecar to exist.
- Bundles put `warroom-hook` next to the app binary (`/usr/bin/` in the RPM), which is where the
  installer looks (`lib.rs::built_bridge`, `warroom-hook.exe` on Windows). Verified by inspecting the
  RPM (`rpm -qlp`); the installed package was not run. macOS/Windows bundles were not built locally.
- Bundles are unsigned: Gatekeeper (macOS) and SmartScreen (Windows) warn until signing is set up.
- Autostart: `tauri-plugin-autostart` (v2 — v3 is alpha) writes the XDG autostart entry (a
  LaunchAgent on macOS, the Run registry key on Windows) with `--hidden`.
- Icons: `src-tauri/app-icon.png` (generated pixel screen) → `cargo tauri icon`. The tray icon is drawn
  at runtime (`tray.rs::lamp`).
