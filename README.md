# Agent War Room

Una sala de control para tus agentes de código: una pantalla por sesión, agrupadas por repositorio,
que se ilumina cuando algo te necesita o ha terminado. Vive en la bandeja; solo la miras cuando cambia
de color. Arquitectura y decisiones: [`docs/adr/0001-arquitectura.md`](docs/adr/0001-arquitectura.md).

## Arrancar

```sh
npm install
npm run app          # compila warroom-hook y lanza `tauri dev`
```

La primera vez, pulsa **Conectar Claude Code**: añade hooks a `~/.claude/settings.json` (sin tocar los
tuyos, con copia `.warroom-bak`) apuntando a `~/.local/share/agent-war-room/bin/warroom-hook`. Las
sesiones que arranquen a partir de entonces aparecerán en la sala.

## Desarrollo

```sh
cargo test --workspace   # dominio, casos de uso, adaptadores; regenera src/domain/generated
npm run typecheck
```

- `WARROOM_HOOK_DUMP=/ruta/fichero.jsonl` hace que el puente guarde cada envelope: sirve para capturar
  fixtures reales.
- Datos: `~/.local/share/agent-war-room/events.db` (eventos append-only).
- Socket: `$XDG_RUNTIME_DIR/agent-war-room/ingress.sock`.
