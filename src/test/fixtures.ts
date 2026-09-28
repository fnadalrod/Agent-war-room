// Factories for front-end tests.
import type { AttentionView, RoomView, SessionView, WarRoomView } from "../domain/attention";

export function aSession(p: Partial<SessionView> = {}): SessionView {
  return {
    id: "s1",
    provider: "claude",
    attention: "idle",
    status_label: "Idle",
    title: null,
    first_prompt: null,
    command: null,
    last_prompt: null,
    last_reply: null,
    last_action: null,
    model: null,
    effort: null,
    context_tokens: null,
    worktree_path: "/code/app",
    branch: "main",
    is_linked_worktree: false,
    subagents: [],
    skills: [],
    turns: 0,
    started_at: 0,
    last_activity_at: 0,
    status_since: 0,
    archived: false,
    muted: false,
    alive: true,
    terminal: null,
    tmux_pane: null,
    in_warp: false,
    pty_id: null,
    can_approve: false,
    ...p,
  };
}

export function aRoom(name: string, sessions: SessionView[], attention: AttentionView = "idle"): RoomView {
  return { repo_id: `/code/${name}/.git`, repo_name: name, attention, sessions };
}

export function aView(rooms: RoomView[], aggregate: AttentionView = "idle"): WarRoomView {
  return { aggregate, rooms };
}
