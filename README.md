# Agent War Room

Una sala de control para tus agentes de código. Muestra una pantalla por sesión, agrupadas por
repositorio, que se ilumina cuando algo te necesita o ha terminado. Vive en la bandeja: solo la
miras cuando cambia de color. Arquitectura y decisiones en
[`docs/adr/0001-arquitectura.md`](docs/adr/0001-arquitectura.md).

## Qué hace

- **Vista previa de cada sesión:** encargo inicial y comando con que se lanzó, última respuesta
  completa en Markdown y conversación reciente con las herramientas agrupadas.
- **Cola "Requiere tu atención"** con lo que te espera en todos los repos.
- **Avisos con botones:** "Ver", "Ir a" y "Aprobar" desde la propia notificación.
- **Estado de cada agente** a partir de los hooks de Claude Code:
  - 🔴 te necesita: permiso, pregunta o plan pendiente
  - 🔵 terminado sin revisar
  - 🟢 trabajando
  - en espera
  - cerrado
- **Bandeja con el color de lo más urgente** y avisos de escritorio cuando algo pasa a rojo o azul.
- **Detalle de cada sesión, leído del transcript:** título, último prompt, última respuesta, acción
  en curso (`Bash · cargo test`), modelo, contexto usado y qué hace cada subagente.
- **Ir a la sesión:** salta a su ventana.
  - Warp: al pane exacto, con `WARP_FOCUS_URL`.
  - tmux: al pane y a su cliente.
  - KDE: a la ventana, localizada por su cadena de PIDs y desempatada por el título. Así se
    distinguen varios proyectos abiertos en un mismo IDE.
- **Aprobar o denegar permisos desde la sala.** Claude sigue mostrando su diálogo y gana quien
  conteste antes.
- **Escribir en la sesión** cuando corre en un terminal de la app o en tmux.
- **Lanzar agentes** en un repo, o **reanudar** una sesión cerrada, en un terminal de la app
  (xterm.js) o en una pestaña de Warp.
- **Despedir (archivar)** una sesión, aunque siga abierta: deja de avisar y vuelve sola si le
  escribes. **Silenciar**: sigue visible, pero sin avisos.
- **Dos vistas del mismo estado:** la clásica (tarjetas) y la **War Room** pixel art.

## Arrancar

```sh
npm install
npm run app          # compila warroom-hook y lanza `tauri dev`
```

La primera vez, pulsa **Conectar Claude Code**. Eso:

- Añade hooks a `~/.claude/settings.json`, sin tocar los tuyos y guardando una copia
  `.warroom-bak`.
- Hace que apunten a `~/.local/share/agent-war-room/bin/warroom-hook`.

Las sesiones que arranquen a partir de entonces aparecerán en la sala.

Para que se abra sola al iniciar sesión (oculta, en la bandeja), actívalo en el menú de
**Claude Code** de la cabecera.

### Instalar como paquete

```sh
npm run package      # compila el puente en release y genera .deb, .rpm y AppImage
```

Los paquetes quedan en `target/release/bundle/` e incluyen `warroom-hook` junto al ejecutable.

Fuera de Tauri (`npm run dev` en un navegador), la UI usa adaptadores de demostración con una sala
ficticia. Sirve para diseñar sin la app.

## Desarrollo

```sh
cargo test --workspace   # dominio, casos de uso y adaptadores; regenera src/domain/generated
npm test                 # front (Vitest)
npm run typecheck
```

Pruebas de punta a punta con un Claude Code real. Van aisladas (socket, carpeta y tmux propios, sin
tocar tu configuración) y cuestan una llamada corta cada una:

```sh
cargo build -p warroom-hook
cargo test -p awr-infrastructure --test claude_e2e -- --ignored --nocapture
```

Otras utilidades:

- `WARROOM_HOOK_DUMP=/ruta/fichero.jsonl` hace que el puente guarde cada envelope, para capturar
  fixtures reales.
- Pruebas manuales contra el escritorio:

  ```sh
  cargo test -p awr-infrastructure kwin_live -- --ignored
  AWR_TRANSCRIPT=… cargo test -p awr-infrastructure transcript_live -- --ignored --nocapture
  ```

- Datos: `~/.local/share/agent-war-room/events.db` (eventos append-only; se conservan 14 días).
- Socket: `$XDG_RUNTIME_DIR/agent-war-room/ingress.sock`.
