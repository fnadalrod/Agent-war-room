// Adaptadores de demostración: una sala ficticia que cambia sola. Se usan fuera de Tauri (navegador,
// capturas, diseño de la UI) y demuestran que la UI solo depende de los puertos.
import type {
  IntegrationGateway,
  Launched,
  TerminalGateway,
  Unsubscribe,
  WarRoomGateway,
} from "../application/ports";
import type {
  AttentionView,
  IntegrationStatus,
  RoomView,
  SessionDetail,
  SessionView,
  TimelineEntryView,
  WarRoomView,
} from "../domain/attention";

const minutes = (m: number) => Date.now() - m * 60_000;

const DEMO_REPLY = `## Hecho

He actualizado \`docs/tareas/banco.md\` con el relevo del **bloque V**:

- Los rojos del último pase **no eran válidos**: el runner arrancó sin la base de datos de fixtures.
- Hay que repetirlo con \`make banco BLOQUE=V\`.

| Bloque | Estado |
| --- | --- |
| IV | ✅ verde |
| V | ⚠️ repetir |

> Siguiente paso: lanzar el bloque V cuando esté libre la máquina de CI.

Más contexto en [la guía del banco](https://example.com/banco).`;

function demoTimeline(s: SessionView): TimelineEntryView[] {
  const at = (m: number) => minutes(m);
  return [
    { kind: "prompt", text: s.first_prompt ?? "¿Puedes revisar esto?", at: at(40) },
    { kind: "tool", text: "Read · banco.md", at: at(39) },
    { kind: "tool", text: "Grep · bloque V", at: at(39) },
    { kind: "tool", text: "Read · runner.ts", at: at(38) },
    { kind: "reply", text: "Veo que el runner no espera a la base de datos. Lo compruebo con el log del último pase.", at: at(37) },
    { kind: "tool", text: "Bash · npm run banco -- --dry-run", at: at(30) },
    { kind: "prompt", text: "Vale, documenta el relevo y no toques el runner todavía.", at: at(12) },
    { kind: "tool", text: "Edit · banco.md", at: at(8) },
    { kind: "reply", text: s.last_reply ?? DEMO_REPLY, at: at(6) },
  ];
}

function session(p: Partial<SessionView> & Pick<SessionView, "id" | "attention" | "status_label">): SessionView {
  return {
    provider: "claude",
    title: null,
    first_prompt: null,
    command: null,
    last_prompt: null,
    last_reply: null,
    last_action: null,
    model: "claude-opus-5-5",
    context_tokens: 84_000,
    worktree_path: "/home/demo/code/app",
    branch: "main",
    is_linked_worktree: false,
    subagents: [],
    turns: 3,
    started_at: minutes(90),
    last_activity_at: minutes(1),
    status_since: minutes(1),
    archived: false,
    muted: false,
    alive: true,
    terminal: "konsole",
    tmux_pane: null,
    in_warp: false,
    pty_id: null,
    can_approve: false,
    ...p,
  };
}

function initialRooms(): RoomView[] {
  return [
    {
      repo_id: "/code/tintero/.git",
      repo_name: "Tintero",
      attention: "needs_you",
      sessions: [
        session({
          id: "a1b2c3d4-tintero-sync",
          attention: "needs_you",
          status_label: "Pide permiso: Bash · npm run e2e -- --grep sync",
          title: "Reparar la sincronización offline",
          first_prompt:
            "Los cambios hechos sin conexión se pierden al volver la red. Reprodúcelo con un e2e y arréglalo sin tocar el esquema de la base de datos.",
          command: "claude --permission-mode default",
          worktree_path: "/code/tintero",
          can_approve: true,
          status_since: minutes(2),
        }),
        session({
          id: "b2c3d4e5-tintero-inky",
          attention: "working",
          status_label: "Pensando",
          last_action: "Edit · inky-header.component.ts",
          title: "Cabecera animada de Inky",
          worktree_path: "/code/Tintero3Repo-wt-f1",
          branch: "feat/inky",
          is_linked_worktree: true,
          in_warp: true,
          subagents: [
            { id: "x1", kind: "Explore", description: "Buscar usos del header", last_tool: "Grep · InkyHeader" },
            { id: "x2", kind: "general-purpose", description: "Revisar estilos", last_tool: "Read · header.scss" },
          ],
        }),
        session({
          id: "c3d4e5f6-tintero-docs",
          attention: "finished",
          status_label: "Terminado",
          title: "Documentar el banco de pruebas",
          first_prompt: "Documenta en docs/tareas cómo repetir el bloque V del banco de pruebas.",
          command: "claude --resume c3d4e5f6",
          last_reply: DEMO_REPLY,
          worktree_path: "/code/tintero",
          status_since: minutes(6),
        }),
      ],
    },
    {
      repo_id: "/code/kainban/.git",
      repo_name: "Kainban",
      attention: "working",
      sessions: [
        session({
          id: "d4e5f6a7-kainban-roles",
          attention: "working",
          status_label: "Bash",
          last_action: "Bash · go test ./...",
          title: "Permisos por rol",
          worktree_path: "/code/kainban",
          tmux_pane: "%4",
          pty_id: null,
        }),
      ],
    },
    {
      repo_id: "/code/agentwarroom/.git",
      repo_name: "AgentWarRoom",
      attention: "idle",
      sessions: [
        session({
          id: "e5f6a7b8-awr-pixel",
          attention: "idle",
          status_label: "Te toca",
          title: "Pixel-agents aplicación Tauri",
          worktree_path: "/code/agentwarroom",
          pty_id: "pty-demo-1",
          muted: true,
        }),
        session({
          id: "f6a7b8c9-awr-old",
          attention: "offline",
          status_label: "Cerrada",
          title: "Prototipo de hooks",
          worktree_path: "/code/agentwarroom",
          alive: false,
        }),
      ],
    },
  ];
}

const ORDER: AttentionView[] = ["offline", "idle", "working", "finished", "needs_you"];
const rank = (a: AttentionView) => ORDER.indexOf(a);

function project(rooms: RoomView[]): WarRoomView {
  const onWatch = (s: SessionView) => !s.archived && !s.muted;
  const best = (list: SessionView[]) =>
    list.filter(onWatch).reduce<AttentionView>((acc, s) => (rank(s.attention) > rank(acc) ? s.attention : acc), "offline");
  const next = rooms.map((r) => ({ ...r, attention: best(r.sessions) }));
  return { aggregate: best(next.flatMap((r) => r.sessions)), rooms: next };
}

export function createDemo(): { rooms: WarRoomGateway; integration: IntegrationGateway; terminals: TerminalGateway } {
  let rooms = initialRooms();
  const listeners = new Set<(v: WarRoomView) => void>();
  const emit = () => listeners.forEach((l) => l(project(rooms)));
  const update = (id: string, patch: Partial<SessionView>) => {
    rooms = rooms.map((r) => ({ ...r, sessions: r.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    emit();
  };
  const find = (id: string) => rooms.flatMap((r) => r.sessions).find((s) => s.id === id);

  // El agente de Kainban termina a los 12 s; así se ven transiciones sin tocar nada.
  setTimeout(
    () =>
      update("d4e5f6a7-kainban-roles", {
        attention: "finished",
        status_label: "Terminado",
        status_since: Date.now(),
        last_reply: "Todos los tests de permisos pasan.",
      }),
    12_000,
  );

  const done = async () => {};
  let autostart = false;
  const launched = async (): Promise<Launched> => ({ pty_id: null, via: "demo" });

  const status: IntegrationStatus = {
    installed: true,
    hooked_events: [],
    settings_path: "~/.claude/settings.json",
    bridge_path: "~/.local/share/agent-war-room/bin/warroom-hook",
    bridge_present: true,
  };

  return {
    rooms: {
      load: async () => project(rooms),
      onChange: async (l): Promise<Unsubscribe> => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      markSeen: async (id) => update(id, { attention: "idle", status_label: "Te toca" }),
      markAllSeen: async () => {
        rooms.flatMap((r) => r.sessions).filter((s) => s.attention === "finished").forEach((s) => update(s.id, { attention: "idle", status_label: "Te toca" }));
      },
      focus: async (id) => {
        if (find(id)?.attention === "finished") update(id, { attention: "idle", status_label: "Te toca" });
        return "demo";
      },
      archive: async (id) => update(id, { archived: true }),
      unarchive: async (id) => update(id, { archived: false }),
      mute: async (id) => update(id, { muted: true }),
      unmute: async (id) => update(id, { muted: false }),
      approve: async (id) =>
        update(id, { attention: "working", status_label: "Bash", can_approve: false, status_since: Date.now() }),
      deny: async (id) => update(id, { attention: "working", status_label: "Pensando", can_approve: false }),
      sendInput: done,
      launch: launched,
      resume: launched,
      detail: async (id): Promise<SessionDetail> => {
        const s = find(id);
        if (!s) throw new Error("sesión desconocida");
        return { session: s, timeline: demoTimeline(s) };
      },
      openExternal: async (url) => void window.open(url, "_blank", "noopener"),
      onOpenRequest: async () => () => {},
    },
    integration: {
      status: async () => status,
      install: async () => status,
      uninstall: async () => status,
      autostart: async () => autostart,
      setAutostart: async (enabled) => (autostart = enabled),
    },
    terminals: {
      list: async () => [],
      snapshot: async () => new TextEncoder().encode("Terminal de demostración\r\n$ "),
      write: done,
      resize: done,
      close: done,
      onOutput: async () => () => {},
      onExit: async () => () => {},
    },
  };
}
