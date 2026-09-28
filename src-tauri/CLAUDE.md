# App shell (src-tauri/)

- `lib.rs` is the composition root: builds every adapter, wires `WarRoomService`, spawns the socket
  ingress and the 5 s tick (process liveness + transcript refresh), handles notification actions.
- `commands.rs`: thin driving adapter. Blocking work goes through `blocking()` (spawn_blocking).
  Command and argument names are the contract with `src/infrastructure/tauriGateway.ts`.
- Events to the front: `warroom://view`, `warroom://open-detail`, `pty://output`, `pty://exit`
  (constants in `adapters.rs` / `lib.rs`, mirrored in the TS gateway).
- Notifications use `notify-rust` (freedesktop actions); closing the window hides to tray;
  `--hidden` is passed by autostart.
- Packaging: `npm run package` = `scripts/sidecar.sh` + `tauri build --config src-tauri/tauri.bundle.conf.json`.
