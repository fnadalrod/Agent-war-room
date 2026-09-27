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

Prioridad: saltar a la ventana/pane correcto (KWin por DBus en KDE Wayland, tmux, Warp a nivel de
ventana). Escribir en la sesión solo para sesiones lanzadas desde la app (PTY) o en tmux.

## Fases

- **F0**: puente, ingesta, máquina de estados, bandeja con color agregado, avisos, vista clásica por
  repo, archivar/silenciar/visto, instalador.
- **F1**: "ir a" (KWin, tmux, Warp), transcript (último mensaje, herramienta), árbol de subagentes.
- **F2**: aprobar permisos desde la app (hook bloqueante con fallback a `ask`), sesiones PTY propias.
- **F3**: War Room pixel art (PixiJS) sobre el mismo read model.

## Consecuencias

- Plataforma objetivo inicial: Linux (KDE Wayland). macOS después.
- Los tipos del read model se generan desde Rust (`ts-rs`) a `src/domain/generated`; el front no
  duplica contratos a mano.
- Sin la app abierta no se registra nada (el puente descarta). Aceptable: la app vive en la bandeja.
