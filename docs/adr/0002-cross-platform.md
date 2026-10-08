# ADR 0002 — Linux, macOS and Windows from one codebase

## Context

The app was Linux-only (KDE first, ADR 0001). The domain and application layers never touched the
OS, but four adapters did: the hook bridge and ingress spoke Unix sockets, process facts came from
`/proc`, "go to" needed KWin, and packaging only produced Linux formats. The hexagonal layout meant
porting was a matter of adapters, not of the core.

## Decision

- **No `#[cfg]` in domain or application.** Every OS difference sits in an adapter behind an
  existing port, picked at compile time with `#[cfg]`.
- **Process table in its own leaf crate (`crates/procs`)**, shared by the bridge and the app:
  `/proc` on Linux (no syscalls, fast for the bridge), `sysinfo` on macOS and Windows (one snapshot
  per chain, since Windows lists every process on any query anyway). Names are normalised (no `.exe`).
- **Transport:** Unix socket on Linux and macOS; on Windows a named pipe whose name derives from the
  same socket path (`awr_wire::pipe_name`), so a private runtime dir isolates tests on every OS.
  Everything past `accept` (reading the envelope, waiting for and writing the approval reply) is one
  generic code path over `AsyncRead + AsyncWrite`. Localhost TCP was rejected: any local user could
  connect, and a port can be taken.
- **"Go to":** one `WindowRaiser` per OS: KWin script (Linux), `NSRunningApplication` (macOS: no
  permission prompt, but the whole app comes forward), `EnumWindows` + `SetForegroundWindow`
  (Windows). The caption-hint rule is shared (`pick_window` mirrors the KWin script).
- **Notifications:** freedesktop keeps its buttons; macOS and Windows get plain notices (notify-rust
  has no actions there). The tray and the window carry the actions.
- **Verification:** `scripts/cross_check.sh` type-checks and lints macOS and Windows from Linux (zig
  as the C cross compiler); CI runs clippy, tests and the front on the three OSes and builds every
  installer on demand.

## Consequences

- macOS and Windows behaviour is verified in CI, not on a desktop: the first real run on each OS may
  reveal integration details (window focus rules, hook command quoting in Claude Code on Windows,
  Warp's tab config folder outside Linux).
- Bundles are unsigned: Gatekeeper and SmartScreen warn until signing is set up.
- Supersedes the "macOS later" and "desktops other than KDE" items of ADR 0001.
