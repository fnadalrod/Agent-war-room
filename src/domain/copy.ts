/**
 * Spanish user-facing copy. The product UI is in Spanish; keep every user-visible string here so the
 * rest of the code stays in English.
 *
 * It lives in `domain` (not `ui`) because presentation rules and the store also produce visible text,
 * and `domain` must not import from `ui`.
 */
import type { AttentionView } from "./generated/AttentionView";
import type { SkillSourceView } from "./generated/SkillSourceView";

/** "tú y el agente": who launched a skill. */
const launchedBy = (byUser: boolean, byAgent: boolean) =>
  [byUser && "tú", byAgent && "el agente"].filter(Boolean).join(" y ");

export const copy = {
  appName: "Agent War Room",

  attention: {
    needs_you: "Te necesita",
    finished: "Terminado",
    working: "Trabajando",
    idle: "En espera",
    offline: "Sin conexión",
  } satisfies Record<AttentionView, string>,

  skillSource: {
    project: "Del repo",
    personal: "Tuyas",
    plugin: "De plugins",
    builtin: "Integradas",
  } satisfies Record<SkillSourceView, string>,

  effort: {
    low: "bajo",
    medium: "medio",
    high: "alto",
    xhigh: "muy alto",
    max: "máximo",
  } as Record<string, string>,

  session: {
    /** "esfuerzo alto". */
    effort: (name: string) => `esfuerzo ${name}`,
    context: (tokens: string) => `${tokens} ctx`,
    turns: (n: number) => `${n} turnos`,
    inWarp: "Warp (pane exacto)",
    tmux: (pane: string) => `tmux ${pane}`,
    unknownTerminal: "terminal desconocida",
    worktree: "worktree",
    subagent: "subagente",
    subagentState: (running: boolean) => (running ? "trabajando" : "terminado"),
  },

  time: {
    now: "ahora",
    minutesAgo: (m: number) => `hace ${m} min`,
    hoursAgo: (h: number) => `hace ${h} h`,
    daysAgo: (d: number) => `hace ${d} d`,
  },

  topbar: {
    summary: "Resumen",
    allSeen: "Todo visto",
    view: "Vista",
    classic: "Clásica",
    warRoom: "War Room",
    archived: "Archivadas",
  },

  app: {
    close: "Cerrar",
    noMatch: "Nada coincide con el filtro.",
    clearFilters: "Quitar filtros",
    emptyRoom: "Sala vacía.",
    emptyRoomHint: "Cuando un agente arranque o haga algo, aparecerá aquí su tarjeta.",
  },

  actions: {
    approve: "Aprobar",
    deny: "Denegar",
    openPreview: "Abrir la vista previa",
    preview: "Vista previa",
    goToWindow: "Ir a su ventana",
    goToWindowVia: (where: string) => `Ir a su ventana · ${where}`,
    markSeen: "Marcar como visto",
    resume: "Reanudar",
    inWarp: "en Warp",
    openTerminal: "Abrir su terminal",
    unmute: "Reactivar avisos",
    mute: "Silenciar avisos",
    unarchive: "Readmitir en la sala",
    archive: "Despedir: ocultar y dejar de avisar",
  },

  queue: {
    title: "Requiere tu atención",
  },

  card: {
    subagentsWorking: "Subagentes trabajando",
    muted: "Silenciada",
    noBranch: "sin rama",
    goTo: "Ir a",
    resumeInApp: "Reanudar en un terminal de la app",
    resumeInWarp: "Reanudar en una pestaña de Warp",
    subagents: "Subagentes",
    seeAllInPreview: "Ver todos en la vista previa",
  },

  quickInput: {
    placeholder: "Escribir a la sesión… (Enter envía)",
    label: "Mensaje para la sesión",
  },

  room: {
    newAgent: "Agente",
    newAgentTitle: (cwd: string) => `Abrir claude en ${cwd}`,
    newAgentInWarpTitle: (cwd: string) => `Abrir claude en una pestaña de Warp, en ${cwd}`,
  },

  skill: {
    /** Tooltip of a skill tag. */
    tagTitle: (name: string, source: string, byUser: boolean, byAgent: boolean, count: number) =>
      `${name} · ${source.toLowerCase()} · la lanzó ${launchedBy(byUser, byAgent)}${
        count > 1 ? ` · ${count} veces` : ""
      }\nClic: filtrar por esta skill`,
    launchedBy: (byUser: boolean, byAgent: boolean) =>
      [byUser && "la lanzaste tú", byAgent && "la lanzó el agente"].filter(Boolean).join(" y "),
    times: (n: number) => `${n} veces`,
  },

  filters: {
    label: "Filtros",
    repos: "Repos",
    model: "Modelo",
    skills: "Skills",
    sessionsShown: (shown: number, total: number) => `${shown} de ${total} sesiones`,
    clear: "Quitar filtros",
    effortTitle: (value: string) => `Esfuerzo ${value}`,
    skillTitle: (source: string, byUser: boolean, byAgent: boolean) =>
      `${source} · la lanzó ${launchedBy(byUser, byAgent)}`,
  },

  detail: {
    label: (title: string) => `Vista previa: ${title}`,
    close: "Cerrar vista previa",
    closeEsc: "Cerrar (Esc)",
    closeShort: "Cerrar",
    answerInTerminal: "También puedes contestar en su terminal: vale la primera respuesta.",
    initialTask: "Encargo inicial",
    lastReply: "Última respuesta",
    skills: "Skills",
    subagents: "Subagentes",
    recentConversation: "Conversación reciente",
    loading: "Cargando…",
    noTranscript: "Sin transcript todavía.",
    goToSession: "Ir a la sesión",
    terminal: "Terminal",
    resumeInWarp: "Reanudar en Warp",
    seen: "Visto",
    unmute: "Reactivar avisos",
    mute: "Silenciar",
    unarchive: "Readmitir",
    archive: "Despedir",
    copy: "Copiar",
    showLess: "Ver menos",
    showAll: "Ver todo",
    tools: (n: number, digest: string) => `${n} herramientas · ${digest}`,
    you: "Tú",
    agent: "Agente",
  },

  subagent: {
    label: (name: string) => `Subagente: ${name}`,
    back: "Volver a la sesión (Esc)",
    title: "Subagente",
    working: "Trabajando",
    finished: "Terminado",
    since: (ago: string) => `desde ${ago}`,
    finishedAgo: (ago: string) => `terminó ${ago}`,
    task: "Encargo",
    lastReply: "Última respuesta",
    result: "Resultado",
    activity: "Actividad",
    mainAgent: "Agente principal",
  },

  markdown: {
    image: (alt: string | undefined) => `[imagen${alt ? `: ${alt}` : ""}]`,
  },

  terminal: {
    label: (name: string) => `Terminal: ${name}`,
    exited: "proceso terminado",
    hide: "Ocultar",
    hideTitle: "El proceso sigue vivo; reábrelo desde su pantalla",
    forget: "Olvidar este terminal",
    kill: "Termina el proceso",
    close: "Cerrar",
    terminate: "Terminar",
  },

  integration: {
    incomplete: "La integración con Claude Code está incompleta",
    notConnected: "Claude Code aún no avisa a la war room",
    /** Wraps two inline `<code>` elements: the settings path and the backup suffix. */
    installNote: {
      beforePath: "Se añadirán hooks a",
      beforeBackup: "sin tocar los que ya tengas (queda una copia",
      end: "). Solo las sesiones que arranquen después quedan conectadas.",
    },
    connect: "Conectar Claude Code",
    badge: "Claude Code",
    title: "Integración con Claude Code",
    hooksIn: "Hooks en",
    bridge: "Puente:",
    autostart: "Abrir al iniciar sesión (en la bandeja)",
    reinstall: "Reinstalar",
    disconnect: "Desconectar",
  },

  toasts: {
    approved: "Permiso aprobado",
    denied: "Permiso denegado",
    openedIn: (via: string) => `Abierto en ${via}`,
  },

  pixel: {
    title: "AGENT WAR ROOM",
    allQuiet: "TODO TRANQUILO",
    finishedBubble: "OK",
    mutedBubble: "ZZ",
    canvasLabel: "Sala de control: un puesto por sesión, coloreado por su estado",
    subagentOf: (session: string | null) => ` — subagente de ${session ?? "la sesión"}`,
    empty: "Sala vacía: los puestos aparecerán cuando un agente arranque.",
  },
};
