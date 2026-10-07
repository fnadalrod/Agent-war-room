// Factories for front-end tests.
import type { AttentionView, RoomView, SessionView, SubagentView, WarRoomView } from "../domain/attention";

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
    context_window: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0, cost_usd: 0, partial_cost: false },
    stalled_since: null,
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
    awaiting_question: false,
    pending_question: null,
    can_answer_question: false,
    questions: [],
    shared_files: [],
    ...p,
  };
}

export function aSubagent(p: Partial<SubagentView> = {}): SubagentView {
  return {
    id: "a1",
    kind: null,
    description: null,
    last_tool: null,
    model: null,
    effort: null,
    running: true,
    started_at: 0,
    finished_at: null,
    ...p,
  };
}

export function aRoom(name: string, sessions: SessionView[], attention: AttentionView = "idle"): RoomView {
  return { repo_id: `/code/${name}/.git`, repo_name: name, attention, sessions };
}

export function aView(rooms: RoomView[], aggregate: AttentionView = "idle"): WarRoomView {
  const today = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0, cost_usd: 0, partial_cost: false };
  return { aggregate, rooms, today };
}
