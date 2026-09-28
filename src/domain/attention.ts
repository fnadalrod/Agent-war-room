// Pure presentation rules over the read model. No React, no Tauri.
import { copy } from "./copy";
import type { AttentionView } from "./generated/AttentionView";
import type { SessionView } from "./generated/SessionView";
import type { SkillSourceView } from "./generated/SkillSourceView";
import type { SkillView } from "./generated/SkillView";
import type { SubagentView } from "./generated/SubagentView";
import type { WarRoomView } from "./generated/WarRoomView";
import type { RoomView } from "./generated/RoomView";
import type { IntegrationStatus } from "./generated/IntegrationStatus";
import type { UsageView } from "./generated/UsageView";

export type { AttentionView, SessionView, SkillSourceView, SkillView, WarRoomView };
export type { RoomView };
export type { SubagentView } from "./generated/SubagentView";
export type { IntegrationStatus } from "./generated/IntegrationStatus";
export type { SessionDetail } from "./generated/SessionDetail";
export type { SessionChanges } from "./generated/SessionChanges";
export type { CommitView } from "./generated/CommitView";
export type { UsageView } from "./generated/UsageView";
export type { SubagentPreview } from "./generated/SubagentPreview";
export type { TimelineEntryView } from "./generated/TimelineEntryView";

/** Sessions that count for the queue and the notifications. */
export function isOnWatch(s: SessionView): boolean {
  return !s.archived && !s.muted;
}

export function countBy(view: WarRoomView, attention: AttentionView): number {
  return view.rooms
    .flatMap((r) => r.sessions)
    .filter((s) => isOnWatch(s) && s.attention === attention).length;
}

export function archivedCount(view: WarRoomView): number {
  return view.rooms.flatMap((r) => r.sessions).filter((s) => s.archived).length;
}

/** Short desk name: the worktree folder. */
export function deskName(s: SessionView): string {
  return s.worktree_path.split("/").filter(Boolean).pop() ?? s.worktree_path;
}

export function shortId(s: SessionView): string {
  return s.id.slice(0, 8);
}

/** "claude-opus-5-5" → "opus-5-5". */
export function shortModel(model: string | null | undefined): string | null {
  return model?.replace(/^claude-/, "") ?? null;
}

/** "claude" → "Claude Code"; unknown providers pass through. */
export function providerName(provider: string): string {
  return copy.provider[provider] ?? provider;
}

/** Hooks in place and the bridge where they point. */
export function isConnected(status: IntegrationStatus | null | undefined): boolean {
  return status != null && status.installed && status.bridge_present;
}

/** Agents you can start from a room: the connected ones, else the installed ones, else Claude. Some
 *  (Antigravity) only run inside their own app. */
export function launchableAgents(integrations: IntegrationStatus[]): string[] {
  const startable = integrations.filter((i) => i.launchable);
  const connected = startable.filter(isConnected).map((i) => i.provider);
  if (connected.length) return connected;
  const found = startable.filter((i) => i.agent_found).map((i) => i.provider);
  return found.length ? found : ["claude"];
}

/** More than one kind of agent in the room: then cards say which one each is. */
export function mixesAgents(view: WarRoomView): boolean {
  return new Set(view.rooms.flatMap((r) => r.sessions.map((s) => s.provider))).size > 1;
}

export function modelName(s: SessionView): string | null {
  return shortModel(s.model);
}

/** Readable effort ("high" → "alto"); unknown values pass through as-is. */
export function effortName(effort: string | null | undefined): string | null {
  return effort ? (copy.effort[effort] ?? effort) : null;
}

/** "opus-5-5 · esfuerzo alto". */
export function modelAndEffort(model: string | null | undefined, effort: string | null | undefined): string | null {
  const name = effortName(effort);
  const parts = [shortModel(model), name && copy.session.effort(name)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** 152340 → "152k". */
export function contextLabel(s: SessionView): string | null {
  if (s.context_tokens == null) return null;
  const k = s.context_tokens / 1000;
  return k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${Math.round(k)}k`;
}

/** What it is doing now: the detailed transcript action if any, otherwise the hook label. */
export function activity(s: SessionView): string {
  if (s.attention === "working" && s.last_action) return s.last_action;
  return s.status_label;
}

/** The activity, only when it says more than the status chip (which already shows the attention label). */
export function extraActivity(s: SessionView): string | null {
  const text = activity(s);
  return text === copy.attention[s.attention] ? null : text;
}

/** How the session is reached, for the "go to" button tooltip. */
export function whereItLives(s: SessionView): string {
  if (s.in_warp) return copy.session.inWarp;
  if (s.tmux_pane) return copy.session.tmux(s.tmux_pane);
  return s.terminal ?? copy.session.unknownTerminal;
}

/** The app can type into it (in-app terminal or tmux). */
export function isWritable(s: SessionView): boolean {
  return s.alive && (s.pty_id != null || s.tmux_pane != null);
}

/** Folder to open a new agent in for this room: the main checkout when known. */
export function roomHome(room: RoomView): string | null {
  const main = room.sessions.find((s) => !s.is_linked_worktree) ?? room.sessions[0];
  return main?.worktree_path ?? null;
}

/** Plain text from Markdown, for one- to three-line excerpts. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "$1 —")
    .replace(/^\s{0,3}(>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, "$2")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Consecutive tool calls grouped by name: "Read ×3 · Bash · Edit". */
export function toolDigest(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const name = label.split(" · ")[0];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(" · ");
}

/** Display name of a subagent: its description, its kind, or a generic fallback. */
export function agentName(a: SubagentView): string {
  return a.description ?? a.kind ?? copy.session.subagent;
}

// ---------- Skills and filters ----------

export const SKILL_SOURCES: SkillSourceView[] = ["project", "personal", "plugin", "builtin"];

/** What to show. An empty list means no filtering on that criterion. */
export type Filter = {
  repos: string[];
  skills: string[];
  sources: SkillSourceView[];
  models: string[];
  efforts: string[];
};

export const NO_FILTER: Filter = { repos: [], skills: [], sources: [], models: [], efforts: [] };

export function isFiltering(f: Filter): boolean {
  return [f.repos, f.skills, f.sources, f.models, f.efforts].some((l) => l.length > 0);
}

function matches(s: SessionView, f: Filter): boolean {
  if (f.models.length > 0 && !(s.model && f.models.includes(s.model))) return false;
  if (f.efforts.length > 0 && !(s.effort && f.efforts.includes(s.effort))) return false;
  if (f.skills.length > 0 && !s.skills.some((k) => f.skills.includes(k.name))) return false;
  if (f.sources.length > 0 && !s.skills.some((k) => f.sources.includes(k.source))) return false;
  return true;
}

/** The view with only what passes the filter; rooms left empty are dropped. */
export function applyFilter(view: WarRoomView, f: Filter): WarRoomView {
  if (!isFiltering(f)) return view;
  const rooms = view.rooms
    .filter((r) => f.repos.length === 0 || f.repos.includes(r.repo_id))
    .map((r) => ({ ...r, sessions: r.sessions.filter((s) => matches(s, f)) }))
    .filter((r) => r.sessions.length > 0);
  return { ...view, rooms };
}

export type RepoOption = { id: string; name: string; sessions: number };
export type SkillOption = { name: string; source: SkillSourceView; sessions: number; byUser: boolean; byAgent: boolean };

export type ValueOption = { value: string; sessions: number };

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];

function countValues(values: (string | null)[]): ValueOption[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, sessions]) => ({ value, sessions }));
}

/** Filter bar options, taken from what is in the view. */
export function filterOptions(view: WarRoomView): {
  repos: RepoOption[];
  skills: SkillOption[];
  models: ValueOption[];
  efforts: ValueOption[];
} {
  const sessions = view.rooms.flatMap((r) => r.sessions);
  const models = countValues(sessions.map((s) => s.model)).sort((a, b) => b.sessions - a.sessions);
  const efforts = countValues(sessions.map((s) => s.effort)).sort(
    (a, b) => (EFFORT_ORDER.indexOf(a.value) + 1 || 99) - (EFFORT_ORDER.indexOf(b.value) + 1 || 99),
  );
  const repos = view.rooms
    .map((r) => ({ id: r.repo_id, name: r.repo_name, sessions: r.sessions.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const skills = new Map<string, SkillOption>();
  for (const s of view.rooms.flatMap((r) => r.sessions)) {
    for (const k of s.skills) {
      const known = skills.get(k.name) ?? { name: k.name, source: k.source, sessions: 0, byUser: false, byAgent: false };
      known.sessions += 1;
      known.byUser ||= k.by_user;
      known.byAgent ||= k.by_agent;
      skills.set(k.name, known);
    }
  }
  return {
    repos,
    skills: [...skills.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)),
    models,
    efforts,
  };
}

export function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

// ---------- Usage, context and stalls ----------

/** 1234 → "1.2k"; 12_345_678 → "12.3M". Compact counts for badges. */
export function tokenCount(n: number): string {
  if (n < 1000) return String(n);
  const [value, unit] = n >= 1_000_000 ? [n / 1_000_000, "M"] : [n / 1000, "k"];
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, "")}${unit}`;
}

/** "$0.42", "$12". */
/** Nothing in it has a known price (e.g. Codex's own models): show tokens, not "$0.00". */
export function unpriced(u: UsageView): boolean {
  return u.partial_cost && u.cost_usd === 0;
}

/** "12.6M tok · $3.40", or only the tokens when there is no price at all. */
export function usageLabel(u: UsageView): string {
  const tokens = `${tokenCount(u.total_tokens)} tok`;
  return unpriced(u) ? tokens : `${tokens} · ${money(u.cost_usd)}`;
}

export function money(usd: number): string {
  if (usd >= 100) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(2)}`;
}

/** How full the context is, 0..1, if the window is known. */
export function contextRatio(s: SessionView): number | null {
  if (s.context_tokens == null || !s.context_window) return null;
  return Math.min(1, s.context_tokens / s.context_window);
}

/** Level for coloring the context bar. */
export function contextLevel(ratio: number): "ok" | "warn" | "full" {
  return ratio >= 0.85 ? "full" : ratio >= 0.6 ? "warn" : "ok";
}

/** Minutes since a working session went silent, if it looks stuck. */
export function stalledMinutes(s: SessionView, now: number): number | null {
  return s.stalled_since == null ? null : Math.max(0, Math.round((now - s.stalled_since) / 60_000));
}
