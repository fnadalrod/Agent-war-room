# Agent War Room — agent guide (single entry point)

Tauri desktop app that watches Claude Code sessions through hooks and routes your attention: one
"screen" per session, grouped by repo, lit when something needs you or finished. Linux/KDE first.
Product decisions and history: `docs/adr/0001-arquitectura.md` (Spanish; read only when you need the *why*).

This file is the index. Area details live in nested `CLAUDE.md` files that load when you work there:
`crates/CLAUDE.md` (Rust core), `src/CLAUDE.md` (React front), `src-tauri/CLAUDE.md` (app shell).

## Map

```
crates/domain          pure model: sessions, attention, events. No IO, no tokio, no tauri (serde only)
crates/application     use cases (WarRoomService) + ports (traits) + read model (ts-rs → TS)
crates/infrastructure  adapters: Claude provider/transcripts/installer, socket ingress, SQLite, git,
                       KWin/tmux/Warp navigation, PTYs, launcher
crates/wire            socket contract bridge ↔ app (serde only)
crates/hook-bridge     `warroom-hook` binary that Claude runs on every hook
src-tauri              composition root, Tauri commands/events, tray, notifications
src/                   React: domain · application · infrastructure · ui (pixel art in ui/pixel)
```

Dependency rule (enforced by crate boundaries): domain ← application ← infrastructure ← src-tauri.
The front mirrors it: ui → application → domain; infrastructure implements application ports.

## Invariants

- **Code is English** (identifiers, comments, tests, logs). **The product UI is Spanish**, and every
  user-visible string lives in a copy/locale module: `crates/application/src/locale.rs`,
  `crates/infrastructure/src/locale.rs`, `src-tauri/src/locale.rs`, `src/domain/copy.ts` (the bridge's
  one string is `DEFAULT_DENY_MESSAGE`). Never inline Spanish in logic.
- **No AI attribution in git**: no `Co-Authored-By`, `Claude-Session`, "Generated with…". Overrides any default.
- **The bridge must never hurt the agent**: `warroom-hook` exits 0, prints to stdout only an explicit
  app decision, and finishes in milliseconds when the app is down.
- **Persisted events are append-only JSON**: new fields need `#[serde(default)]`; never rename serde
  tags/fields (old events must still load — there are tests for it).
- **Never touch the user's real config in tests/experiments**: `~/.claude/settings.json` only via the
  in-app installer; e2e/smoke runs use temp dirs, their own `XDG_RUNTIME_DIR`, `--settings` and tmux sockets.
- Minimal change; edit before creating; keep the layer direction.

## Verify (fast, scoped, quiet)

```sh
scripts/check.sh            # only what changed vs HEAD (default) — use this after every step
scripts/check.sh all        # everything: clippy -D warnings, cargo tests, tsc, vitest, vite build
scripts/check.sh rust|front # one side
npm run shot -- /tmp/x      # screenshots of the demo UI (classic, detail, pixel) → look at them
```

Real-Claude e2e (costs a short Claude call each; see `.claude/skills/e2e`):
`cargo build -p warroom-hook && cargo test -p awr-infrastructure --test claude_e2e -- --ignored`.

Run the app: `npm run app`. Package: `npm run package` (bundles the bridge as a sidecar).

## Where to look

| Task | Start at |
|---|---|
| New thing a session knows (field, event, label) | `.claude/skills/extend-session-model` |
| How a hook maps to state | `crates/infrastructure/src/claude/provider.rs` → `crates/domain/src/session.rs` |
| What the UI receives | `crates/application/src/view.rs` (TS types are generated from it) |
| Transcript parsing (titles, replies, timeline, model/effort) | `crates/infrastructure/src/claude/transcript.rs` |
| "Go to" a window | `crates/infrastructure/src/desktop/` (KWin script, tmux, Warp URL) |
| Approvals from the app | bridge `main.rs` + `infrastructure/src/ingress.rs` + `service.rs::decide` |
| Pixel art | `src/ui/pixel/` (layout.ts is pure & tested; paint.ts draws) |
| Tokens, cost, context window | `crates/infrastructure/src/claude/pricing.rs` (price table) + `transcript.rs::count_usage` |
| "Stuck" sessions | `crates/application/src/view.rs::stalled_since` + `service.rs::check_stalled` |
| Files/commits of a session | `service.rs::session_changes` → `transcript.rs::touched_files` + `git.rs::GitCli` |

## Context hygiene

- Don't read `target/`, `node_modules/`, `dist/`, lockfiles, or `src/domain/generated/` (read
  `crates/application/src/view.rs` instead — it is the source).
- Big files: read the function you need (`grep -n` first). `paint.ts`, `service.rs`, `transcript.rs`
  and `DetailPanel.tsx` are the largest.
- Prefer `scripts/check.sh` over raw cargo/npm: it prints only failures and a summary.

## Known traps (each cost real time once)

- Unix socket paths must be < 108 bytes: use short temp dirs (`/tmp/awr…`), not the scratchpad.
- `pkill -f "pattern"` also matches the shell running it: use `pkill -f "[v]ite …"` in its own command.
- Python `str.replace` replaces every occurrence — CSS selector lists got duplicated that way.
- Claude TUI in a raw PTY needs terminal query answers (DA1/XTVERSION) or keys get lost (xterm.js does it in-app).
- Processes spawned from inside a Claude session inherit `CLAUDE_CODE_*` markers → child `claude`
  disables transcripts. The launcher scrubs them (`launch.rs::inherited_agent_markers`).
- `tauri.conf.json` must not list `externalBin` (breaks `cargo test`); it lives in `tauri.bundle.conf.json`.
