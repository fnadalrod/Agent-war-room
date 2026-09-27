# ADR 0001 — Arquitectura de Agent War Room

- Estado: aceptado
- Fecha: 2026-09-28

## Contexto

Trabajamos con varios agentes (Claude Code, a futuro otros) en paralelo, repartidos por repositorios,
worktrees y terminales. Se pierden ventanas y hay que vigilar a mano cuándo un agente termina o pide
algo. Queremos una única "war room" que dirija la atención: solo se mira cuando algo lo pide.

## Decisión

### Núcleo en Rust, hexagonal, con la regla de dependencias impuesta por crates

```
crates/domain          puro: sin IO, sin tokio, sin tauri (solo serde)
crates/application     casos de uso + puertos (traits) + read model (DTOs exportados a TS)
crates/infrastructure  adaptadores: proveedor Claude, ingress por socket, SQLite, git, /proc, instalador
crates/wire            contrato del socket entre el puente del hook y la app (solo serde)
crates/hook-bridge     binario `warroom-hook` que Claude invoca en cada hook
src-tauri              raíz de composición + adaptadores de entrada (commands) y salida (tray, avisos)
src/                   React en capas: domain · application · infrastructure · ui
```

`domain` no conoce a Claude. Claude es un adaptador del puerto `AgentProvider`; otros proveedores
(opencode, Codex, Gemini) se añaden sin tocar el núcleo. TS solo pinta: el estado vive en Rust para que
la bandeja y los avisos funcionen con la ventana cerrada.

### Ingesta: hooks + socket Unix

`warroom-hook` lee el JSON del hook por stdin, lo envuelve con contexto que solo existe en ese momento
(cadena de procesos padre → PID del agente y de la terminal, `$TMUX_PANE`, `$TERM_PROGRAM`) y lo manda a
`$XDG_RUNTIME_DIR/agent-war-room/ingress.sock`. Invariantes: **no escribe nada en stdout, sale siempre
con 0 y en milisegundos si la app no está**. Nunca puede romper ni frenar al agente.

El instalador hace merge no destructivo en `~/.claude/settings.json` (respeta hooks ajenos, deja copia
de seguridad) y desinstala limpio.

### Estado: eventos append-only + fold

Todo lo que cambia el estado es un `SessionEvent` (señales del agente e intenciones del usuario:
visto, archivar, silenciar). Se persisten en SQLite y el estado se reconstruye plegándolos al arrancar.
Tests = reproducir secuencias de eventos.

### Modelo de atención

| Atención   | Cuándo                                                        |
|------------|---------------------------------------------------------------|
| `NeedsYou` | pide permiso o hace una pregunta (AskUserQuestion, plan)       |
| `Finished` | ha acabado el turno y no lo has visto                          |
| `Working`  | ejecutando / compactando                                      |
| `Idle`     | esperando, ya visto                                           |
| `Offline`  | sesión cerrada o proceso perdido                              |

- **Archivar** ("despedir"): oculta la sesión y la saca de avisos aunque el proceso siga vivo. Se
  desarchiva sola si vuelves a escribirle (`UserPromptSubmit`). Matar el proceso es otra acción, explícita.
- **Silenciar**: sigue visible, pero no avisa ni cuenta para el color agregado de la bandeja.
- Un repo se identifica por su `git common dir`: los worktrees caen en la misma sala.

### "Ir a" antes que "escribir"

Prioridad: saltar a la ventana o pane correcto.

- **Warp:** enfoca el pane exacto con `WARP_FOCUS_URL`, que el puente captura.
- **tmux:** selecciona el pane y enfoca la terminal de su cliente.
- **KDE Plasma (X11 y Wayland):** un script de KWin cargado por DBus busca la ventana cuya PID esté
  en la cadena de procesos del agente. Si hay varias del mismo proceso, desempata por el título,
  dando más peso a la palabra completa (`Tintero` no gana en `Tintero3Repo`).

Escribir en la sesión solo es posible si corre en un terminal de la app (PTY enlazado por
`AWR_PTY_ID`) o en tmux.

### Aprobar permisos desde la app

Comprobado con Claude Code real (2.1.283):

- El diálogo de `PermissionRequest` se muestra en la terminal **mientras** el hook está en marcha.
- Si el hook responde primero, Claude aplica su decisión.
- Si contestas antes en la terminal, Claude mata el hook y descarta su respuesta.

Por eso el puente espera la decisión de la app (timeout de 600 s) sin bloquear a nadie, y no hace
falta ningún interruptor. La app detecta el EOF de la conexión para retirar el botón de aprobar.

### Agentes lanzados desde la app

- Se abren con un shell de login, porque el PATH del escritorio no incluye `~/.local/bin`.
- No heredan las marcas de subsesión (`CLAUDECODE`, `CLAUDE_CODE_*`…). Con ellas Claude se tomaría
  por un subproceso y no guardaría transcript.
- **Reanudar en Warp:** se escribe un Tab Config (`awr-*.toml`, que se borra pasadas 24 h) y se abre
  con `warp://tab_config/…`.

## Fases

Todas implementadas:

- **F0**: puente, ingesta, máquina de estados, bandeja con el color agregado, avisos, vista clásica
  por repo, archivar/silenciar/visto e instalador.
- **F1**: "ir a" (Warp, tmux, KWin), lectura incremental del transcript y actividad de los
  subagentes.
- **F2**: aprobar o denegar permisos desde la app, terminales propios, escritura en sesiones, y
  lanzar o reanudar agentes (en la app o en Warp).
- **F3**: War Room pixel art sobre el mismo read model. Es Canvas 2D a baja resolución con fuente
  bitmap propia: no hizo falta PixiJS.

Pendiente o fuera de alcance por ahora:

- Matar el proceso de un agente desde la app.
- Otros proveedores además de Claude (el puerto `AgentProvider` está listo).
- Escritorios que no sean KDE para "ir a".
- macOS.

## Consecuencias

- Plataforma objetivo inicial: Linux (KDE Wayland). macOS después.
- Los tipos del read model se generan desde Rust (`ts-rs`) a `src/domain/generated`: el front no
  duplica contratos a mano.
- Fuera de Tauri, el front usa adaptadores de demostración que implementan los mismos puertos.
- Sin la app abierta no se registra nada (el puente descarta). Aceptable: la app vive en la bandeja.
