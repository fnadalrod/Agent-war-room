import type {
  Filter,
  IntegrationStatus,
  SessionChanges,
  SessionDetail,
  SubagentPreview,
  WarRoomView,
} from "../domain/attention";

export type Unsubscribe = () => void;

export type LaunchTarget = "app" | "warp";

/** `pty_id` is set when the agent was opened in an in-app terminal. */
export type Launched = { pty_id: string | null; via: string };

/** Everything the front needs from the core. The real implementation talks to Tauri. */
export interface WarRoomGateway {
  load(): Promise<WarRoomView>;
  onChange(listener: (view: WarRoomView) => void): Promise<Unsubscribe>;
  markSeen(id: string): Promise<void>;
  markAllSeen(): Promise<void>;
  /** Jumps to the session window. Resolves with the route used; rejects with the reason. */
  focus(id: string): Promise<string>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
  mute(id: string): Promise<void>;
  unmute(id: string): Promise<void>;
  approve(id: string): Promise<void>;
  deny(id: string, message?: string): Promise<void>;
  sendInput(id: string, text: string): Promise<void>;
  launch(cwd: string, target: LaunchTarget): Promise<Launched>;
  resume(id: string, target: LaunchTarget): Promise<Launched>;
  /** Preview: card + recent conversation. */
  detail(id: string): Promise<SessionDetail>;
  /** Preview of one of the session's subagents. */
  subagentDetail(id: string, agent: string): Promise<SubagentPreview>;
  /** Opens a link in the system browser. */
  openExternal(url: string): Promise<void>;
  /** The core asks to open a session preview (e.g. a notification was clicked). */
  /** `reply`: open it with the message box focused (the notification's "Reply" button). */
  onOpenRequest(listener: (id: string, reply: boolean) => void): Promise<Unsubscribe>;
  /** Jumps to what has waited longest; resolves to its id, or null if nothing waits. */
  focusNext(): Promise<string | null>;
  /** Files the session edited and commits in its worktree since it started. */
  sessionChanges(id: string): Promise<SessionChanges>;
  /** `git show` of one of those commits. */
  commitDiff(id: string, hash: string): Promise<string>;
}

export type TerminalInfo = { id: string; label: string; cwd: string; alive: boolean };

/** In-app terminals (PTY). */
export interface TerminalGateway {
  list(): Promise<TerminalInfo[]>;
  snapshot(id: string): Promise<Uint8Array>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  onOutput(listener: (id: string, data: Uint8Array) => void): Promise<Unsubscribe>;
  onExit(listener: (id: string) => void): Promise<Unsubscribe>;
}

export interface IntegrationGateway {
  status(): Promise<IntegrationStatus>;
  install(): Promise<IntegrationStatus>;
  uninstall(): Promise<IntegrationStatus>;
  /** Start the app (hidden, in the tray) on login. */
  autostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<boolean>;
}

/** Where the filter is remembered across launches (on this machine). */
export interface FilterStorage {
  load(): Filter | null;
  save(filter: Filter): void;
}
