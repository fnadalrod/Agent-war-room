/**
 * User-facing copy. Keep every user-visible string here so wording lives in one place (and a future
 * translation has a single file to replace).
 *
 * It lives in `domain` (not `ui`) because presentation rules and the store also produce visible text,
 * and `domain` must not import from `ui`.
 */
import type { AttentionView } from "./generated/AttentionView";
import type { SkillSourceView } from "./generated/SkillSourceView";

/** "you and the agent": who launched a skill. */
const launchedBy = (byUser: boolean, byAgent: boolean) =>
  [byUser && "you", byAgent && "the agent"].filter(Boolean).join(" and ");

export const copy = {
  appName: "Agent War Room",

  attention: {
    needs_you: "Needs you",
    finished: "Finished",
    working: "Working",
    idle: "Idle",
    offline: "Offline",
  } satisfies Record<AttentionView, string>,

  skillSource: {
    project: "From the repo",
    personal: "Yours",
    plugin: "From plugins",
    builtin: "Built-in",
  } satisfies Record<SkillSourceView, string>,

  effort: {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "extra high",
    max: "max",
  } as Record<string, string>,

  stalled: {
    label: (minutes: number) => `Stuck? ${minutes} min`,
    long: (minutes: number) => `Stuck? ${minutes} min without activity`,
    title: "Still working but silent: it may be hung or waiting on something that doesn't notify",
  },
  session: {
    /** "high effort". */
    effort: (name: string) => `${name} effort`,
    context: (tokens: string) => `${tokens} ctx`,
    turns: (n: number) => `${n} turns`,
    inWarp: "Warp (exact pane)",
    tmux: (pane: string) => `tmux ${pane}`,
    unknownTerminal: "unknown terminal",
    worktree: "worktree",
    subagent: "subagent",
    subagentState: (running: boolean) => (running ? "working" : "finished"),
  },

  time: {
    now: "now",
    minutesAgo: (m: number) => `${m} min ago`,
    hoursAgo: (h: number) => `${h} h ago`,
    daysAgo: (d: number) => `${d} d ago`,
  },

  topbar: {
    next: "Next",
    nextTitle: "Go to whatever has waited for you longest (also: agent-war-room --next)",
    nothingWaiting: "Nothing is waiting for you",
    today: (tokens: string, cost: string) => `Today ${tokens} · ${cost}`,
    todayTitle: "Tokens and estimated cost at API prices across today's sessions",
    summary: "Summary",
    allSeen: "All seen",
    view: "View",
    classic: "Classic",
    warRoom: "War Room",
    archived: "Dismissed",
  },

  app: {
    close: "Close",
    noMatch: "Nothing matches the filter.",
    clearFilters: "Clear filters",
    emptyRoom: "Empty room.",
    emptyRoomHint: "When an agent starts or does something, its card will show up here.",
  },

  actions: {
    approve: "Approve",
    deny: "Deny",
    openPreview: "Open the preview",
    preview: "Preview",
    goToWindow: "Go to its window",
    goToWindowVia: (where: string) => `Go to its window · ${where}`,
    markSeen: "Mark as seen",
    resume: "Resume",
    inWarp: "in Warp",
    openTerminal: "Open its terminal",
    unmute: "Unmute notifications",
    mute: "Mute notifications",
    unarchive: "Bring back to the room",
    archive: "Dismiss: hide and stop notifying",
  },

  queue: {
    title: "Needs your attention",
  },

  card: {
    subagentsWorking: "Subagents working",
    muted: "Muted",
    noBranch: "no branch",
    goTo: "Go to",
    resumeInApp: "Resume in an app terminal",
    resumeInWarp: "Resume in a Warp tab",
    subagents: "Subagents",
    seeAllInPreview: "See all in the preview",
  },

  quickInput: {
    placeholder: "Write to the session… (Enter sends)",
    label: "Message for the session",
  },

  room: {
    newAgent: "Agent",
    newAgentTitle: (cwd: string) => `Open claude in ${cwd}`,
    newAgentInWarpTitle: (cwd: string) => `Open claude in a Warp tab, in ${cwd}`,
  },

  skill: {
    /** Tooltip of a skill tag. */
    tagTitle: (name: string, source: string, byUser: boolean, byAgent: boolean, count: number) =>
      `${name} · ${source.toLowerCase()} · launched by ${launchedBy(byUser, byAgent)}${
        count > 1 ? ` · ${count} times` : ""
      }\nClick: filter by this skill`,
    launchedBy: (byUser: boolean, byAgent: boolean) =>
      [byUser && "you launched it", byAgent && "the agent launched it"].filter(Boolean).join(" and "),
    times: (n: number) => `${n} times`,
  },

  filters: {
    label: "Filters",
    repos: "Repos",
    model: "Model",
    skills: "Skills",
    sessionsShown: (shown: number, total: number) => `${shown} of ${total} sessions`,
    clear: "Clear filters",
    effortTitle: (value: string) => `Effort ${value}`,
    skillTitle: (source: string, byUser: boolean, byAgent: boolean) =>
      `${source} · launched by ${launchedBy(byUser, byAgent)}`,
  },

  detail: {
    label: (title: string) => `Preview: ${title}`,
    close: "Close preview",
    closeEsc: "Close (Esc)",
    closeShort: "Close",
    answerInTerminal: "You can also answer in its terminal: the first answer wins.",
    initialTask: "Initial task",
    lastReply: "Last reply",
    skills: "Skills",
    subagents: "Subagents",
    recentConversation: "Recent conversation",
    loading: "Loading…",
    noTranscript: "No transcript yet.",
    goToSession: "Go to the session",
    terminal: "Terminal",
    resumeInWarp: "Resume in Warp",
    seen: "Seen",
    unmute: "Unmute",
    mute: "Mute",
    unarchive: "Bring back",
    archive: "Dismiss",
    copy: "Copy",
    showLess: "Show less",
    showAll: "Show all",
    tools: (n: number, digest: string) => `${n} tools · ${digest}`,
    you: "You",
    agent: "Agent",
    usage: "Usage",
    contextUsed: (used: string, window: string, pct: number) => `Context ${used} of ${window} (${pct}%)`,
    tokenBreakdown: (input: string, output: string, cacheRead: string, cacheWrite: string) =>
      `input ${input} · output ${output} · cache read ${cacheRead} · cache write ${cacheWrite}`,
    estimatedCost: (cost: string) => `${cost} estimated at API prices`,
    partialCost: "(some model has no known price)",
    changes: "Changes",
    showChanges: "Show files and commits",
    changesHint: "Files it edited (its subagents too) and commits in its worktree since it started.",
    files: (n: number) => (n === 1 ? "1 file" : `${n} files`),
    noFiles: "It hasn't edited any files.",
    edits: (n: number) => (n === 1 ? "1 edit" : `${n} edits`),
    written: "created/rewritten",
    commits: (n: number) => (n === 1 ? "1 commit" : `${n} commits`),
    noCommits: "No commits in its worktree during the session.",
    commitStats: (files: number, add: number, del: number) => `${files} files · +${add} −${del}`,
    diffTitle: (short: string) => `Commit ${short}`,
  },

  subagent: {
    label: (name: string) => `Subagent: ${name}`,
    back: "Back to the session (Esc)",
    title: "Subagent",
    working: "Working",
    finished: "Finished",
    since: (ago: string) => `since ${ago}`,
    finishedAgo: (ago: string) => `finished ${ago}`,
    task: "Task",
    lastReply: "Last reply",
    result: "Result",
    activity: "Activity",
    mainAgent: "Main agent",
  },

  markdown: {
    image: (alt: string | undefined) => `[image${alt ? `: ${alt}` : ""}]`,
  },

  terminal: {
    label: (name: string) => `Terminal: ${name}`,
    exited: "process exited",
    hide: "Hide",
    hideTitle: "The process keeps running; reopen it from its screen",
    forget: "Forget this terminal",
    kill: "Kill the process",
    close: "Close",
    terminate: "Terminate",
  },

  integration: {
    incomplete: "The Claude Code integration is incomplete",
    notConnected: "Claude Code doesn't notify the war room yet",
    /** Wraps two inline `<code>` elements: the settings path and the backup suffix. */
    installNote: {
      beforePath: "Hooks will be added to",
      beforeBackup: "without touching the ones you already have (a copy is kept as",
      end: "). Only sessions started afterwards get connected.",
    },
    connect: "Connect Claude Code",
    badge: "Claude Code",
    title: "Claude Code integration",
    hooksIn: "Hooks in",
    bridge: "Bridge:",
    autostart: "Open at login (in the tray)",
    reinstall: "Reinstall",
    disconnect: "Disconnect",
  },

  toasts: {
    approved: "Permission approved",
    denied: "Permission denied",
    openedIn: (via: string) => `Opened in ${via}`,
  },

  pixel: {
    title: "AGENT WAR ROOM",
    allQuiet: "ALL QUIET",
    finishedBubble: "OK",
    mutedBubble: "ZZ",
    canvasLabel: "Control room: one desk per session, colored by its state",
    subagentOf: (session: string | null) => ` — subagent of ${session ?? "the session"}`,
    empty: "Empty room: desks will appear when an agent starts.",
  },
};
