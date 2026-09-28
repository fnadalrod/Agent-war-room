/**
 * User-facing copy, as a typed API over the translation catalogs (`locales/<lang>.json`, see
 * `i18n.ts`). No text lives here: add the string to every catalog, then expose it below.
 *
 * It lives in `domain` (not `ui`) because presentation rules and the store also produce visible text,
 * and `domain` must not import from `ui`. Plain strings are read once, when this module loads, so the
 * language must be set before that (main.tsx does it).
 */
import type { AttentionView } from "./generated/AttentionView";
import type { SkillSourceView } from "./generated/SkillSourceView";
import { t, tn } from "./i18n";

/** "you and the agent": who launched a skill. */
const who = (byUser: boolean, byAgent: boolean) =>
  byUser && byAgent ? t("skill.who_both") : byUser ? t("skill.who_you") : t("skill.who_agent");

export const copy = {
  appName: t("app_name"),

  attention: {
    needs_you: t("attention.needs_you"),
    finished: t("attention.finished"),
    working: t("attention.working"),
    idle: t("attention.idle"),
    offline: t("attention.offline"),
  } satisfies Record<AttentionView, string>,

  skillSource: {
    project: t("skill_source.project"),
    personal: t("skill_source.personal"),
    plugin: t("skill_source.plugin"),
    builtin: t("skill_source.builtin"),
  } satisfies Record<SkillSourceView, string>,

  effort: {
    low: t("effort.low"),
    medium: t("effort.medium"),
    high: t("effort.high"),
    xhigh: t("effort.xhigh"),
    max: t("effort.max"),
  } as Record<string, string>,

  stalled: {
    label: (minutes: number) => t("stalled.label", { minutes }),
    long: (minutes: number) => t("stalled.long", { minutes }),
    title: t("stalled.title"),
  },
  session: {
    /** "high effort". */
    effort: (name: string) => t("session.effort", { name }),
    context: (tokens: string) => t("session.context", { tokens }),
    turns: (n: number) => tn("session.turns", n),
    inWarp: t("session.in_warp"),
    tmux: (pane: string) => t("session.tmux", { pane }),
    unknownTerminal: t("session.unknown_terminal"),
    worktree: t("session.worktree"),
    subagent: t("session.subagent"),
    subagentState: (running: boolean) => (running ? t("session.subagent_working") : t("session.subagent_finished")),
  },

  time: {
    now: t("time.now"),
    minutesAgo: (n: number) => t("time.minutes_ago", { n }),
    hoursAgo: (n: number) => t("time.hours_ago", { n }),
    daysAgo: (n: number) => t("time.days_ago", { n }),
  },

  topbar: {
    next: t("topbar.next"),
    nextTitle: t("topbar.next_title"),
    nothingWaiting: t("topbar.nothing_waiting"),
    today: (tokens: string, cost: string) => t("topbar.today", { tokens, cost }),
    todayTitle: t("topbar.today_title"),
    summary: t("topbar.summary"),
    allSeen: t("topbar.all_seen"),
    view: t("topbar.view"),
    classic: t("topbar.classic"),
    warRoom: t("topbar.war_room"),
    archived: t("topbar.archived"),
  },

  app: {
    close: t("app.close"),
    noMatch: t("app.no_match"),
    clearFilters: t("app.clear_filters"),
    emptyRoom: t("app.empty_room"),
    emptyRoomHint: t("app.empty_room_hint"),
  },

  actions: {
    approve: t("actions.approve"),
    deny: t("actions.deny"),
    openPreview: t("actions.open_preview"),
    preview: t("actions.preview"),
    goToWindow: t("actions.go_to_window"),
    goToWindowVia: (where: string) => t("actions.go_to_window_via", { where }),
    markSeen: t("actions.mark_seen"),
    resume: t("actions.resume"),
    inWarp: t("actions.in_warp"),
    openTerminal: t("actions.open_terminal"),
    unmute: t("actions.unmute"),
    mute: t("actions.mute"),
    unarchive: t("actions.unarchive"),
    archive: t("actions.archive"),
  },

  queue: {
    title: t("queue.title"),
  },

  card: {
    subagentsWorking: t("card.subagents_working"),
    muted: t("card.muted"),
    noBranch: t("card.no_branch"),
    goTo: t("card.go_to"),
    resumeInApp: t("card.resume_in_app"),
    resumeInWarp: t("card.resume_in_warp"),
    subagents: t("card.subagents"),
    seeAllInPreview: t("card.see_all_in_preview"),
  },

  quickInput: {
    placeholder: t("quick_input.placeholder"),
    label: t("quick_input.label"),
  },

  room: {
    newAgent: t("room.new_agent"),
    newAgentTitle: (cwd: string) => t("room.new_agent_title", { cwd }),
    newAgentInWarpTitle: (cwd: string) => t("room.new_agent_in_warp_title", { cwd }),
  },

  skill: {
    /** Tooltip of a skill tag. */
    tagTitle: (name: string, source: string, byUser: boolean, byAgent: boolean, count: number) =>
      t("skill.tag_title", { name, source: source.toLowerCase(), who: who(byUser, byAgent) }) +
      (count > 1 ? t("skill.tag_times", { n: count }) : "") +
      `\n${t("skill.tag_click")}`,
    launchedBy: (byUser: boolean, byAgent: boolean) =>
      byUser && byAgent
        ? t("skill.launched_both")
        : byUser
          ? t("skill.launched_you")
          : t("skill.launched_agent"),
    times: (n: number) => tn("skill.times", n),
  },

  filters: {
    label: t("filters.label"),
    repos: t("filters.repos"),
    model: t("filters.model"),
    skills: t("filters.skills"),
    sessionsShown: (shown: number, total: number) => t("filters.sessions_shown", { shown, total }),
    clear: t("filters.clear"),
    effortTitle: (value: string) => t("filters.effort_title", { value }),
    skillTitle: (source: string, byUser: boolean, byAgent: boolean) =>
      t("filters.skill_title", { source, who: who(byUser, byAgent) }),
  },

  detail: {
    label: (title: string) => t("detail.label", { title }),
    close: t("detail.close"),
    closeEsc: t("detail.close_esc"),
    closeShort: t("detail.close_short"),
    answerInTerminal: t("detail.answer_in_terminal"),
    initialTask: t("detail.initial_task"),
    lastReply: t("detail.last_reply"),
    skills: t("detail.skills"),
    subagents: t("detail.subagents"),
    recentConversation: t("detail.recent_conversation"),
    loading: t("detail.loading"),
    noTranscript: t("detail.no_transcript"),
    goToSession: t("detail.go_to_session"),
    terminal: t("detail.terminal"),
    resumeInWarp: t("detail.resume_in_warp"),
    seen: t("detail.seen"),
    unmute: t("detail.unmute"),
    mute: t("detail.mute"),
    unarchive: t("detail.unarchive"),
    archive: t("detail.archive"),
    copy: t("detail.copy"),
    showLess: t("detail.show_less"),
    showAll: t("detail.show_all"),
    tools: (n: number, digest: string) => tn("detail.tools", n, { digest }),
    you: t("detail.you"),
    agent: t("detail.agent"),
    usage: t("detail.usage"),
    contextUsed: (used: string, window: string, pct: number) => t("detail.context_used", { used, window, pct }),
    tokenBreakdown: (input: string, output: string, cacheRead: string, cacheWrite: string) =>
      t("detail.token_breakdown", { input, output, cache_read: cacheRead, cache_write: cacheWrite }),
    estimatedCost: (cost: string) => t("detail.estimated_cost", { cost }),
    partialCost: t("detail.partial_cost"),
    changes: t("detail.changes"),
    showChanges: t("detail.show_changes"),
    changesHint: t("detail.changes_hint"),
    files: (n: number) => tn("detail.files", n),
    noFiles: t("detail.no_files"),
    edits: (n: number) => tn("detail.edits", n),
    written: t("detail.written"),
    commits: (n: number) => tn("detail.commits", n),
    noCommits: t("detail.no_commits"),
    commitStats: (files: number, add: number, del: number) =>
      t("detail.commit_stats", { files: tn("detail.files", files), add, del }),
    diffTitle: (short: string) => t("detail.diff_title", { short }),
  },

  subagent: {
    label: (name: string) => t("subagent.label", { name }),
    back: t("subagent.back"),
    title: t("subagent.title"),
    working: t("subagent.working"),
    finished: t("subagent.finished"),
    since: (ago: string) => t("subagent.since", { ago }),
    finishedAgo: (ago: string) => t("subagent.finished_ago", { ago }),
    task: t("subagent.task"),
    lastReply: t("subagent.last_reply"),
    result: t("subagent.result"),
    activity: t("subagent.activity"),
    mainAgent: t("subagent.main_agent"),
  },

  markdown: {
    image: (alt: string | undefined) => (alt ? t("markdown.image_alt", { alt }) : t("markdown.image")),
  },

  terminal: {
    label: (name: string) => t("terminal.label", { name }),
    exited: t("terminal.exited"),
    hide: t("terminal.hide"),
    hideTitle: t("terminal.hide_title"),
    forget: t("terminal.forget"),
    kill: t("terminal.kill"),
    close: t("terminal.close"),
    terminate: t("terminal.terminate"),
  },

  integration: {
    incomplete: t("integration.incomplete"),
    notConnected: t("integration.not_connected"),
    /** Wraps two inline `<code>` elements: the settings path and the backup suffix. */
    installNote: {
      beforePath: t("integration.install_before_path"),
      beforeBackup: t("integration.install_before_backup"),
      end: t("integration.install_end"),
    },
    connect: t("integration.connect"),
    badge: t("integration.badge"),
    title: t("integration.title"),
    hooksIn: t("integration.hooks_in"),
    bridge: t("integration.bridge"),
    autostart: t("integration.autostart"),
    reinstall: t("integration.reinstall"),
    disconnect: t("integration.disconnect"),
  },

  toasts: {
    approved: t("toasts.approved"),
    denied: t("toasts.denied"),
    openedIn: (via: string) => t("toasts.opened_in", { via }),
  },

  pixel: {
    title: t("pixel.title"),
    allQuiet: t("pixel.all_quiet"),
    finishedBubble: t("pixel.finished_bubble"),
    mutedBubble: t("pixel.muted_bubble"),
    canvasLabel: t("pixel.canvas_label"),
    subagentOf: (session: string | null) =>
      session ? t("pixel.subagent_of", { session }) : t("pixel.subagent_of_unknown"),
    empty: t("pixel.empty"),
  },
};
