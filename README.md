# Agent War Room

Una sala de control para tus agentes de código. Si trabajas con varias sesiones de Claude Code a la
vez, repartidas por repos, terminales y ventanas del IDE, acabas perdiendo de vista cuál te está
esperando. Agent War Room muestra **una pantalla por sesión, agrupadas por repositorio**, que se
ilumina cuando algo te necesita, cuando termina o cuando parece atascada. Vive en la bandeja del
sistema: solo la miras cuando cambia de color.

![Vista clásica: varios repos, sesiones y subagentes](docs/screenshots/classic.png)

![War Room pixel art: el mismo estado como una sala con puestos](docs/screenshots/pixel.png)

- **Local por completo.** No hay servidor ni cuenta: lee los hooks y transcripts de Claude Code en
  tu máquina.
- **No molesta al agente.** Si la app está cerrada, el puente de hooks sale al instante y Claude
  sigue como si nada.
- **Linux primero** (KDE Plasma en Wayland es el entorno probado). El núcleo está en Rust y la
  interfaz en React sobre Tauri 2.

## Índice

- [Qué ves](#qué-ves)
- [Guía de uso](#guía-de-uso)
- [Instalación](#instalación)
- [Conectar Claude Code](#conectar-claude-code)
- [Cómo funciona](#cómo-funciona)
- [Datos y privacidad](#datos-y-privacidad)
- [Solución de problemas](#solución-de-problemas)
- [Desarrollo](#desarrollo)
- [Para agentes de código](#para-agentes-de-código)
- [Limitaciones y pendiente](#limitaciones-y-pendiente)

## Qué ves

### Estados

Cada sesión tiene un nivel de atención, de más a menos urgente. La bandeja toma el color del más
urgente de toda la sala.

| Estado | Cuándo | Aviso |
|---|---|---|
| 🔴 **Te necesita** | Pide un permiso, te hace una pregunta o espera que apruebes un plan | Sí |
| 🔵 **Terminado** | Acabó su turno y aún no lo has mirado | Sí |
| 🟠 **Atascado** | Lleva 6 minutos "trabajando" sin dar ninguna señal | Una vez |
| 🟢 **Trabajando** | Ejecutando herramientas o pensando | No |
| ⚪ **En espera** / **Cerrado** | Sin turno en curso / proceso terminado | No |

### Cola "Requiere tu atención"

Arriba del todo, lo que te espera en todos los repos, ordenado por urgencia y antigüedad. Se filtra
por repo, por skill y por procedencia de la skill; los filtros se recuerdan.

![Sala filtrada por repo y skill](docs/screenshots/filtered.png)

### Vista previa de una sesión

Al pulsar una pantalla se abre su detalle, leído del transcript:

- Título, **encargo inicial** (primer prompt) y **comando con el que se lanzó**.
- **Última respuesta completa en Markdown**, con vista ampliada.
- Conversación reciente con las herramientas agrupadas y la acción en curso (`Bash · cargo test`).
- **Modelo y esfuerzo** de la sesión, de cada subagente y de cada respuesta.
- **Contexto usado** (avisa antes de que compacte), tokens y **coste estimado** a precio de API,
  subagentes incluidos.
- **Skills** lanzadas, etiquetadas por quién las lanzó (tú o el agente) y de dónde vienen (del
  proyecto, tuyas, de un plugin o integradas).

![Detalle de una sesión](docs/screenshots/detail.png)

### Subagentes

Los subagentes aparecen en pequeño alrededor de su sesión, con su propio estado. Se pueden pulsar
para ver qué están haciendo, con qué modelo y cuánto llevan gastado.

![Detalle de un subagente](docs/screenshots/subagent.png)

### Cambios de una sesión (bajo demanda)

El botón **Cambios** muestra los ficheros que editó la sesión (también sus subagentes) y los
**commits hechos en su worktree desde que empezó**, con el diff de cada uno. No se calcula hasta que
lo pides.

![Cambios de una sesión](docs/screenshots/changes.png)

![Diff de un commit](docs/screenshots/diff.png)

## Guía de uso

- **Siguiente.** Salta a lo que más lleva esperándote: primero lo que te pide algo, luego lo
  terminado. Tienes botón en la cabecera, entrada en el menú de la bandeja y el comando
  `agent-war-room --next` para un atajo global (ver [Atajo global](#atajo-global-siguiente-kde)).
- **Ir a.** Lleva a la ventana de la sesión:
  - Warp: al pane exacto, con `WARP_FOCUS_URL`.
  - tmux: al pane, cambiando el cliente si hace falta.
  - KDE: a la ventana, localizada por su cadena de procesos y desempatada por el título. Así se
    distinguen varios proyectos abiertos en un mismo IDE.
- **Aprobar o denegar permisos desde la sala** o desde el propio aviso. Claude sigue mostrando su
  diálogo en el terminal: gana quien conteste antes.
- **Responder.** Escribe en la sesión cuando corre en un terminal de la app o en tmux. El botón
  "Responder" de los avisos abre la vista previa con el cursor en el mensaje (las notificaciones de
  Linux no admiten escribir dentro del aviso).
- **Lanzar y reanudar.** Arranca un agente en un repo, o reanuda una sesión cerrada, en un terminal
  integrado (xterm.js) o en una pestaña de Warp.
- **Despedir** (archivar) una sesión aunque siga abierta: deja de avisar y desaparece de la sala.
  Vuelve sola si le escribes. Se puede restaurar durante 3 días.
- **Silenciar**: sigue visible, pero sin avisos.
- **Hoy.** La cabecera suma los tokens y el coste estimado del día en todas las sesiones.
- **Dos vistas del mismo estado:** la clásica (tarjetas) y la **War Room** pixel art. Se cambia
  desde la cabecera.

Los avisos de escritorio llevan botones: **Ver**, **Ir a**, **Aprobar** y **Responder**.

## Instalación

### Requisitos

- Linux. Probado en Fedora con KDE Plasma (Wayland). Otros escritorios funcionan, pero sin "Ir a"
  por ventana: solo Warp y tmux.
- Rust estable (edición 2021) y Node 20 o superior.
- Dependencias de sistema de Tauri. En Fedora:

  ```sh
  sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel openssl-devel
  ```

  En Debian/Ubuntu: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev`.
- Opcional: `tmux` (escribir en sesiones y "Ir a" dentro de tmux), [Warp](https://www.warp.dev/)
  (pestañas y foco por pane), `git` (lista de commits de una sesión).

### Desde el código

```sh
npm install
npm run app          # compila el puente warroom-hook y lanza `tauri dev`
```

### Como paquete

```sh
npm run package      # compila el puente en release y genera .deb, .rpm y AppImage
```

Los paquetes quedan en `target/release/bundle/` e incluyen `warroom-hook` junto al ejecutable.

## Conectar Claude Code

La primera vez, pulsa **Conectar Claude Code** en la cabecera. Eso:

- Añade hooks a `~/.claude/settings.json` sin tocar los tuyos, y guarda antes una copia
  `settings.json.warroom-bak`.
- Hace que apunten a `~/.local/share/agent-war-room/bin/warroom-hook`, una copia estable del puente.
- Registra los eventos `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`,
  `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`,
  `SubagentStart`, `SubagentStop` y `PreCompact`.

Solo las sesiones que arranquen después quedan conectadas. **Desconectar**, en el mismo menú, quita
exactamente esos hooks y deja el resto como estaba.

En ese menú también está **Abrir al iniciar sesión**, que arranca la app oculta en la bandeja.

### Atajo global "siguiente" (KDE)

Configuración del sistema → Teclado → Atajos → Añadir nuevo → Comando o script:
`agent-war-room --next` (o la ruta del binario si no está instalado), y asígnale una tecla.

Con la app abierta, el atajo salta a la ventana de la sesión que más lleva esperando; si no la
encuentra, abre su vista previa. Si la app no está abierta, la arranca.

## Cómo funciona

```
 Claude Code ──hook──▶ warroom-hook ──socket unix──▶ Agent War Room (Tauri)
   (cada evento)       (puente, Rust)                 ├─ núcleo Rust (hexagonal)
                        · sube por /proc hasta el      │   dominio ─ aplicación ─ infraestructura
                          terminal/IDE                 ├─ SQLite: eventos append-only
                        · recoge TMUX, WARP_*, …       ├─ lectura incremental de transcripts
                        · sale siempre con 0           └─ UI React: vista clásica y pixel art
```

1. Claude Code ejecuta `warroom-hook` en cada evento. El puente averigua dónde corre la sesión
   (proceso, terminal, pane de tmux o de Warp) y manda un sobre al socket de la app. Si la app no
   está, sale al momento.
2. Para `PermissionRequest`, el puente espera la decisión de la sala (hasta ~10 minutos). Si
   contestas en el terminal, Claude mata el hook y la sala lo detecta.
3. La app guarda cada evento en SQLite y recalcula el estado de la sesión. El dominio es puro: una
   máquina de estados por sesión que decide el nivel de atención.
4. En paralelo lee el transcript JSONL de forma incremental para el título, las respuestas, el
   modelo, las skills, los subagentes, el consumo y los ficheros tocados.
5. La UI recibe una vista ya calculada; los tipos TypeScript se generan desde Rust con `ts-rs`.

El proyecto se divide así:

| Crate / carpeta | Qué contiene |
|---|---|
| `crates/domain` | Sesiones, estados, atención, subagentes, skills. Sin dependencias salvo serde. |
| `crates/application` | Casos de uso (`WarRoomService`), puertos y la vista que consume la UI. |
| `crates/infrastructure` | Adaptadores: Claude (hooks, transcripts, precios), SQLite, socket, KWin, tmux, Warp, PTYs, git. |
| `crates/wire` | Protocolo entre el puente y la app. |
| `crates/hook-bridge` | El binario `warroom-hook`. |
| `src-tauri` | Composición, comandos y eventos, bandeja, avisos, `--next`, autoarranque. |
| `src` | React por capas: dominio, aplicación, infraestructura (Tauri o demo) y UI. |

Los agentes están tras un puerto (`AgentProvider`). Hoy solo hay adaptador para Claude Code, pero
añadir otro no toca el dominio. Decisiones y alternativas en
[`docs/adr/0001-arquitectura.md`](docs/adr/0001-arquitectura.md).

## Datos y privacidad

Todo se queda en tu máquina; la app no hace peticiones de red.

| Qué | Dónde |
|---|---|
| Eventos (append-only, 14 días) | `~/.local/share/agent-war-room/events.db` |
| Puente instalado | `~/.local/share/agent-war-room/bin/warroom-hook` |
| Socket (permisos `0700`) | `$XDG_RUNTIME_DIR/agent-war-room/ingress.sock` |
| Hooks añadidos | `~/.claude/settings.json` (copia en `.warroom-bak`) |

La app **lee** los transcripts de `~/.claude/projects/`, `/proc` (para localizar procesos y
ventanas) y, al pulsar **Cambios**, el `git log` del worktree de la sesión. Solo **escribe** en tus
sesiones cuando tú respondes o apruebas algo desde la sala.

El coste es una **estimación** a precio público de API: con una suscripción no es lo que pagas,
pero sirve para comparar sesiones.

## Solución de problemas

| Síntoma | Qué mirar |
|---|---|
| Una sesión no aparece | Solo aparecen las que arrancaron después de conectar. Comprueba que el menú dice "conectado" y reinicia esa sesión de Claude. |
| Aparece pero sin título ni respuestas | Claude lanzado desde otra sesión de Claude hereda variables `CLAUDE_CODE_*` que desactivan el transcript. Lánzalo desde un terminal limpio (los lanzamientos de la app ya las limpian). |
| "Ir a" no hace nada | Fuera de KDE solo funcionan Warp y tmux. En KDE, si hay varias ventanas del mismo IDE, el título del proyecto desempata: que el nombre del repo aparezca en la ventana ayuda. |
| No puedo escribir en una sesión | Solo es posible si corre en un terminal de la app o en tmux. |
| No llegan avisos | Revisa que no esté silenciada o despedida y que el escritorio permita notificaciones de la app. |
| Quiero ver qué manda Claude | Arranca Claude con `WARROOM_HOOK_DUMP=/ruta/fichero.jsonl`: el puente guarda cada sobre. |

## Desarrollo

```sh
scripts/check.sh           # comprueba solo lo que cambió respecto a HEAD, con salida mínima
scripts/check.sh all       # todo: clippy, tests, tsc, vitest, build y docs de agentes
cargo test --workspace     # dominio, casos de uso y adaptadores; regenera src/domain/generated
npm test                   # front (Vitest)
npm run shot -- /tmp/shots # capturas de la UI de demostración (las de docs/screenshots)
```

Fuera de Tauri (`npm run dev` en el navegador), la UI usa una sala de demostración con 5 repos y 11
sesiones. Sirve para diseñar sin la app ni agentes reales.

Pruebas de punta a punta con un Claude Code real. Van aisladas (socket, carpeta y tmux propios, sin
tocar tu configuración) y cuestan una llamada corta cada una:

```sh
cargo build -p warroom-hook
cargo test -p awr-infrastructure --test claude_e2e -- --ignored --nocapture
```

Pruebas manuales contra el escritorio:

```sh
cargo test -p awr-infrastructure kwin_live -- --ignored
AWR_TRANSCRIPT=/ruta/sesion.jsonl cargo test -p awr-infrastructure transcript_live -- --ignored --nocapture
```

Convenciones: el código y los comentarios en inglés; los textos de la interfaz en español,
centralizados en `locale.rs` (Rust) y `src/domain/copy.ts` (front). Commits convencionales en
español.

## Para agentes de código

El proyecto trae documentación pensada para agentes (Claude Code, Cursor, Codex…), organizada para
gastar poco contexto: el agente carga un índice corto y va abriendo solo lo que necesita.

- **[`AGENTS.md`](AGENTS.md)** es la única entrada: invariantes, una tabla de "qué leer según lo que
  vas a hacer" y otra por área. No contiene conocimiento, solo dice dónde está.
- **`.cursor/rules/`** guarda el conocimiento en dos niveles. Los *routers* (`*.mdc`) se asocian a
  rutas de código con `globs`. Las *hojas* (`*.md`) solo se abren cuando su disparador, en la tabla
  del router, encaja con la tarea.
- **Hook de reglas.** En Claude Code, al leer o editar un fichero, un hook avisa una vez por sesión
  de qué regla lo cubre (y de sus secciones, si es larga). En cualquier herramienta:
  `python3 scripts/rules_for_path.py <fichero>`.
- **`.agents/skills/`** tiene procedimientos paso a paso (`verify`, `extend-session-model`,
  `add-provider`, `e2e`, `close-task`, `anti-rot`).
- **`.agents/agents/`** tiene subagentes que leen mucho y devuelven poco (transcripts, capturas,
  revisión). `.claude/skills` y `.claude/agents` son enlaces a estas carpetas.
- **Antipodredumbre.** `python3 scripts/check_docs.py` (también `scripts/check.sh docs`) detecta
  rutas muertas, reglas inalcanzables, hojas huérfanas, globs sin ficheros y documentos demasiado
  grandes. La skill `anti-rot` cubre lo que requiere criterio.

Qué carga cada herramienta y qué se pierde fuera de Claude Code: [`.agents/README.md`](.agents/README.md).

## Limitaciones y pendiente

- Solo Claude Code. El puerto para otros agentes existe (skill `add-provider`), pero sin adaptadores.
- "Ir a" por ventana solo en KDE (KWin). GNOME y X11 genérico no están hechos.
- Sin verificar en vivo: los botones de los avisos, el atajo `--next`, el autoarranque, el paquete
  RPM instalado y que Warp recoja las pestañas generadas.
- El coste depende de una tabla de precios en el código (`claude/pricing.rs`); un modelo nuevo sin
  precio aparece sin coste.
- Sin versión web: la UI de navegador es solo la demo.

## Licencia

Propietaria. Todos los derechos reservados.
