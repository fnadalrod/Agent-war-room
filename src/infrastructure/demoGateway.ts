// Demo adapters: a fake war room that changes on its own. Used outside Tauri (browser, screenshots,
// UI design) and they prove the UI depends only on the ports.
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
  SessionChanges,
  SessionDetail,
  SessionView,
  SubagentPreview,
  TimelineEntryView,
  UsageView,
  WarRoomView,
} from "../domain/attention";

const minutes = (m: number) => Date.now() - m * 60_000;

/** Status labels come from the core in Spanish (crates/application/src/locale.rs); mirror them. */
const STATUS = {
  thinking: "Pensando",
  asksQuestion: "Te pregunta",
  asksPermission: "Pide permiso",
  finished: "Terminado",
  yourTurn: "Te toca",
  ended: "Cerrada",
};

const DEMO_REPLY = `## Done

I updated \`docs/tasks/bench.md\` with the handover for **block V**:

- The reds from the last run **were not valid**: the runner started without the fixtures database.
- It needs a rerun with \`make bench BLOCK=V\`.

| Block | Status |
| --- | --- |
| IV | ✅ green |
| V | ⚠️ rerun |

> Next step: launch block V once the CI machine is free.

More context in [the bench guide](https://example.com/bench).`;

function demoTimeline(s: SessionView): TimelineEntryView[] {
  const at = (m: number) => minutes(m);
  return [
    { kind: "prompt", text: s.first_prompt ?? "Can you review this?", at: at(40), model: null, effort: null },
    { kind: "tool", text: "Read · bench.md", at: at(39), model: "claude-sonnet-5", effort: "medium" },
    { kind: "tool", text: "Grep · block V", at: at(39), model: "claude-sonnet-5", effort: "medium" },
    { kind: "tool", text: "Read · runner.ts", at: at(38), model: "claude-sonnet-5", effort: "medium" },
    { kind: "reply", text: "The runner does not wait for the database. Checking it against the last run's log.", at: at(37), model: "claude-sonnet-5", effort: "medium" },
    { kind: "tool", text: "Bash · npm run bench -- --dry-run", at: at(30), model: "claude-sonnet-5", effort: "medium" },
    { kind: "prompt", text: "OK, document the handover and don't touch the runner yet.", at: at(12), model: null, effort: null },
    { kind: "tool", text: "Edit · bench.md", at: at(8), model: "claude-opus-5-5", effort: "high" },
    { kind: "reply", text: s.last_reply ?? DEMO_REPLY, at: at(6), model: "claude-opus-5-5", effort: "high" },
  ];
}

function usage(totalTokens: number, costUsd: number): UsageView {
  const out = Math.round(totalTokens * 0.01);
  const write = Math.round(totalTokens * 0.03);
  const input = Math.round(totalTokens * 0.001);
  return {
    input_tokens: input,
    output_tokens: out,
    cache_read_tokens: totalTokens - out - write - input,
    cache_write_tokens: write,
    total_tokens: totalTokens,
    cost_usd: costUsd,
    partial_cost: false,
  };
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
    effort: "high",
    context_tokens: 84_000,
    context_window: 1_000_000,
    usage: usage(6_200_000, 3.1),
    stalled_since: null,
    worktree_path: "/home/demo/code/app",
    branch: "main",
    is_linked_worktree: false,
    subagents: [],
    skills: [],
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

type Agent = SessionView["subagents"][number];

function agent(id: string, kind: string, description: string, tool: string | null, model = "claude-haiku-4-5", running = true): Agent {
  return {
    id,
    kind,
    description,
    last_tool: tool,
    model,
    effort: model.includes("haiku") ? null : "medium",
    running,
    started_at: minutes(running ? 4 : 20),
    finished_at: running ? null : minutes(12),
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
          status_label: `${STATUS.asksPermission}: Bash · npm run e2e -- --grep sync`,
          title: "Fix offline sync",
          first_prompt:
            "Changes made offline are lost when the network comes back. Reproduce it with an e2e test and fix it without touching the database schema.",
          command: "claude --permission-mode default",
          worktree_path: "/code/tintero",
          can_approve: true,
          status_since: minutes(2),
          context_tokens: 312_000,
          usage: usage(28_400_000, 14.2),
          skills: [
            { name: "run-task", source: "project", by_user: true, by_agent: false, count: 1, last_at: minutes(20) },
            { name: "close-task", source: "project", by_user: false, by_agent: true, count: 2, last_at: minutes(4) },
          ],
        }),
        session({
          id: "b2c3d4e5-tintero-inky",
          attention: "working",
          status_label: STATUS.thinking,
          last_action: "Edit · inky-header.component.ts",
          title: "Animated Inky header",
          skills: [{ name: "anthropic-skills:docx", source: "plugin", by_user: false, by_agent: true, count: 1, last_at: minutes(10) }],
          worktree_path: "/code/Tintero3Repo-wt-f1",
          branch: "feat/inky",
          is_linked_worktree: true,
          in_warp: true,
          context_tokens: 540_000,
          usage: usage(41_000_000, 19.8),
          subagents: [
            agent("x1", "Explore", "Find usages of the header", "Grep · InkyHeader"),
            agent("x2", "general-purpose", "Review styles", "Read · header.scss", "claude-opus-5-5"),
            agent("x3", "Explore", "Component map", null, "claude-haiku-4-5", false),
          ],
        }),
        session({
          id: "c3d4e5f6-tintero-docs",
          attention: "finished",
          status_label: STATUS.finished,
          title: "Document the test bench",
          skills: [
            { name: "teacher-content", source: "personal", by_user: true, by_agent: false, count: 1, last_at: minutes(30) },
            { name: "claude-api", source: "builtin", by_user: false, by_agent: true, count: 3, last_at: minutes(7) },
          ],
          first_prompt: "Document in docs/tasks how to rerun block V of the test bench.",
          command: "claude --resume c3d4e5f6",
          last_reply: DEMO_REPLY,
          worktree_path: "/code/tintero",
          status_since: minutes(6),
          model: "claude-sonnet-5",
          effort: "medium",
          usage: usage(9_800_000, 2.6),
        }),
        session({
          id: "a9b8c7d6-tintero-i18n",
          attention: "working",
          status_label: "Bash",
          last_action: "Bash · npm run build:i18n -- --watch",
          title: "Migrate i18n keys",
          worktree_path: "/code/Tintero2Repo",
          branch: "chore/i18n",
          stalled_since: minutes(9),
          last_activity_at: minutes(9),
          status_since: minutes(9),
          usage: usage(4_100_000, 1.9),
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
          title: "Role-based permissions",
          model: "claude-sonnet-5",
          effort: "medium",
          skills: [{ name: "run-epic", source: "project", by_user: true, by_agent: true, count: 2, last_at: minutes(2) }],
          worktree_path: "/code/kainban",
          tmux_pane: "%4",
          usage: usage(12_600_000, 3.4),
        }),
        session({
          id: "k2k2k2k2-kainban-notify",
          attention: "working",
          status_label: STATUS.thinking,
          last_action: "Agent · Split the notifications epic",
          title: "Epic: in-app notifications",
          worktree_path: "/code/kainban-wt-notify",
          branch: "epic/notifications",
          is_linked_worktree: true,
          context_tokens: 880_000,
          usage: usage(96_000_000, 47.3),
          skills: [{ name: "refine", source: "project", by_user: false, by_agent: true, count: 4, last_at: minutes(3) }],
          subagents: [
            agent("n1", "general-purpose", "Backend: notification table", "Edit · 000015_notifications.sql", "claude-opus-5-5"),
            agent("n2", "general-purpose", "Frontend: bell component", "Write · bell.component.ts", "claude-opus-5-5"),
            agent("n3", "Explore", "Where events are emitted", "Grep · publish("),
            agent("n4", "Explore", "Existing websocket code", null, "claude-haiku-4-5", false),
          ],
        }),
      ],
    },
    {
      repo_id: "/code/git-pro-reviewer/.git",
      repo_name: "git-pro-reviewer",
      attention: "finished",
      sessions: [
        session({
          id: "g1g1g1g1-gpr-review",
          attention: "finished",
          status_label: STATUS.finished,
          title: "Review PR #42: diff viewer",
          last_reply: "## Review\n\n3 issues found, 1 blocking: the diff viewer drops the last hunk when the file has no trailing newline.",
          worktree_path: "/code/git-pro-reviewer",
          status_since: minutes(14),
          usage: usage(7_300_000, 3.0),
          skills: [{ name: "code-review", source: "builtin", by_user: true, by_agent: false, count: 1, last_at: minutes(25) }],
        }),
        session({
          id: "g2g2g2g2-gpr-tauri",
          attention: "working",
          status_label: STATUS.thinking,
          last_action: "Read · tauri.conf.json",
          title: "Upgrade Tauri plugins",
          worktree_path: "/code/git-pro-reviewer",
          model: "claude-sonnet-5",
          effort: "low",
          usage: usage(2_100_000, 0.4),
          subagents: [agent("t1", "Explore", "Breaking changes in plugins", "WebFetch · tauri.app/release")],
        }),
      ],
    },
    {
      repo_id: "/code/TinteroBackend/.git",
      repo_name: "TinteroBackend",
      attention: "needs_you",
      sessions: [
        session({
          id: "b9b9b9b9-backend-sync",
          attention: "needs_you",
          status_label: STATUS.asksQuestion,
          title: "Sync conflicts strategy",
          last_action: "AskUserQuestion",
          worktree_path: "/code/TinteroBackend",
          status_since: minutes(4),
          usage: usage(5_500_000, 2.2),
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
          status_label: STATUS.yourTurn,
          title: "Pixel-agents Tauri app",
          worktree_path: "/code/agentwarroom",
          pty_id: "pty-demo-1",
          muted: true,
          usage: usage(120_000_000, 47.7),
        }),
        session({
          id: "f6a7b8c9-awr-old",
          attention: "offline",
          status_label: STATUS.ended,
          title: "Hooks prototype",
          worktree_path: "/code/agentwarroom",
          alive: false,
          usage: usage(1_200_000, 0.5),
        }),
      ],
    },
  ];
}

const DEMO_DIFF = `commit 3f9c2ab71e0d4c55a2e1b9f0c7d6e5a4b3c2d1e0
Author:     Francisco <f@example.com>
Date:       Sun Sep 28 01:12:00 2026 +0200

    fix(sync): keep offline edits when the socket reconnects

 src/app/sync/outbox.ts      | 18 ++++++++++++------
 e2e/sync-offline.spec.ts    | 31 +++++++++++++++++++++++++++++++
 2 files changed, 43 insertions(+), 6 deletions(-)

diff --git a/src/app/sync/outbox.ts b/src/app/sync/outbox.ts
--- a/src/app/sync/outbox.ts
+++ b/src/app/sync/outbox.ts
@@ -41,9 +41,15 @@ export class Outbox {
   async flush() {
-    this.pending = [];
-    await this.socket.send(this.pending);
+    const batch = [...this.pending];
+    try {
+      await this.socket.send(batch);
+      this.pending = this.pending.slice(batch.length);
+    } catch (error) {
+      // Keep them: the next reconnect retries the same batch.
+      this.log.warn("flush failed", error);
+    }
   }
`;

const ORDER: AttentionView[] = ["offline", "idle", "working", "finished", "needs_you"];
const rank = (a: AttentionView) => ORDER.indexOf(a);

function project(rooms: RoomView[]): WarRoomView {
  const onWatch = (s: SessionView) => !s.archived && !s.muted;
  const best = (list: SessionView[]) =>
    list.filter(onWatch).reduce<AttentionView>((acc, s) => (rank(s.attention) > rank(acc) ? s.attention : acc), "offline");
  const next = rooms.map((r) => ({ ...r, attention: best(r.sessions) }));
  const today = next.flatMap((r) => r.sessions).reduce(
    (acc, s) => ({ ...acc, total_tokens: acc.total_tokens + s.usage.total_tokens, cost_usd: acc.cost_usd + s.usage.cost_usd }),
    usage(0, 0),
  );
  return { aggregate: best(next.flatMap((r) => r.sessions)), rooms: next, today };
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

  // The Kainban agent finishes after 12 s, so transitions show up without touching anything.
  setTimeout(
    () =>
      update("d4e5f6a7-kainban-roles", {
        attention: "finished",
        status_label: STATUS.finished,
        status_since: Date.now(),
        last_reply: "All permission tests pass.",
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
      markSeen: async (id) => update(id, { attention: "idle", status_label: STATUS.yourTurn }),
      markAllSeen: async () => {
        rooms.flatMap((r) => r.sessions).filter((s) => s.attention === "finished").forEach((s) => update(s.id, { attention: "idle", status_label: STATUS.yourTurn }));
      },
      focus: async (id) => {
        if (find(id)?.attention === "finished") update(id, { attention: "idle", status_label: STATUS.yourTurn });
        return "demo";
      },
      archive: async (id) => update(id, { archived: true }),
      unarchive: async (id) => update(id, { archived: false }),
      mute: async (id) => update(id, { muted: true }),
      unmute: async (id) => update(id, { muted: false }),
      approve: async (id) =>
        update(id, { attention: "working", status_label: "Bash", can_approve: false, status_since: Date.now() }),
      deny: async (id) => update(id, { attention: "working", status_label: STATUS.thinking, can_approve: false }),
      sendInput: done,
      launch: launched,
      resume: launched,
      detail: async (id): Promise<SessionDetail> => {
        const s = find(id);
        if (!s) throw new Error("unknown session");
        return { session: s, timeline: demoTimeline(s) };
      },
      subagentDetail: async (id, agent): Promise<SubagentPreview> => {
        const a = find(id)?.subagents.find((x) => x.id === agent);
        if (!a) throw new Error("unknown subagent");
        return {
          session_id: id,
          agent: a,
          first_prompt: `${a.description ?? "Task"}: find every usage and summarise where to change it.`,
          last_reply: a.running ? null : "Found **12 components**:\n\n- `InkyHeader` in 4 pages\n- `ThemeToggle` in 2",
          timeline: [
            { kind: "prompt", text: `${a.description ?? "Task"}: find every usage and summarise where to change it.`, at: minutes(3), model: null, effort: null },
            { kind: "tool", text: "Grep · InkyHeader", at: minutes(3), model: a.model, effort: a.effort },
            { kind: "tool", text: "Read · app.component.html", at: minutes(2), model: a.model, effort: a.effort },
            ...(a.running ? [] : [{ kind: "reply" as const, text: "Found **12 components**.", at: minutes(1), model: a.model, effort: a.effort }]),
          ],
        };
      },
      openExternal: async (url) => void window.open(url, "_blank", "noopener"),
      onOpenRequest: async () => () => {},
      focusNext: async () => {
        const waiting = rooms
          .flatMap((r) => r.sessions)
          .filter((x) => !x.muted && !x.archived && (x.attention === "needs_you" || x.attention === "finished"))
          .sort((a, b) => (a.attention === b.attention ? a.status_since - b.status_since : a.attention === "needs_you" ? -1 : 1));
        return waiting[0]?.id ?? null;
      },
      sessionChanges: async (id): Promise<SessionChanges> => ({
        worktree: find(id)?.worktree_path ?? "/code/app",
        files: [
          { path: "src/app/sync/outbox.ts", edits: 6, written: false },
          { path: "e2e/sync-offline.spec.ts", edits: 1, written: true },
          { path: "src/app/sync/socket.ts", edits: 2, written: false },
          { path: "docs/tasks/sync.md", edits: 1, written: false },
        ],
        commits: [
          { hash: "3f9c2ab71e0d4c55", short: "3f9c2ab7", subject: "fix(sync): keep offline edits when the socket reconnects", author: "Francisco", at: minutes(3), files_changed: 2, insertions: 43, deletions: 6 },
          { hash: "8d1e0f9a2b3c4d5e", short: "8d1e0f9a", subject: "test(sync): reproduce lost offline edits", author: "Francisco", at: minutes(25), files_changed: 1, insertions: 31, deletions: 0 },
        ],
      }),
      commitDiff: async () => DEMO_DIFF,
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
      snapshot: async () => new TextEncoder().encode("Demo terminal\r\n$ "),
      write: done,
      resize: done,
      close: done,
      onOutput: async () => () => {},
      onExit: async () => () => {},
    },
  };
}
