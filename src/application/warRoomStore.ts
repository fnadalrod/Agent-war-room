import {
  type Filter,
  type IntegrationStatus,
  NO_FILTER,
  type SessionChanges,
  type SessionDetail,
  type SessionView,
  type SkillSourceView,
  type SubagentPreview,
  toggle,
  type WarRoomView,
} from "../domain/attention";
import { copy } from "../domain/copy";
import type {
  FilterStorage,
  IntegrationGateway,
  Launched,
  LaunchTarget,
  TerminalGateway,
  WarRoomGateway,
} from "./ports";

export type Toast = { text: string; tone: "ok" | "warn" };

/** Open preview: `data` is null while loading. `agent`: one of its subagents is being viewed. */
export type OpenDetail = {
  id: string;
  data: SessionDetail | null;
  agent: { id: string; data: SubagentPreview | null } | null;
  /** Put the cursor in the message box (came from a notification's "Reply"). */
  reply?: boolean;
  /** "What did it change": null until asked for (it runs git and scans transcripts). */
  changes?: { data: SessionChanges | null } | null;
  /** A commit's diff being viewed. */
  diff?: { hash: string; short: string; text: string | null } | null;
};

/** An agent's final answer open at reading size: the session's, or one of its subagents'. */
export type OpenReader = { id: string; agent: string | null };

/** In-app terminal open in the panel. */
export type OpenTerminal = { id: string; label: string };

export type WarRoomState = {
  view: WarRoomView | null;
  filter: Filter;
  detail: OpenDetail | null;
  terminal: OpenTerminal | null;
  reading: OpenReader | null;
  /** One per supported agent; empty until loaded. */
  integrations: IntegrationStatus[];
  autostart: boolean | null;
  error: string | null;
  toast: Toast | null;
  busy: boolean;
};

const TOAST_MS = 3500;

/** Framework-free store: the UI subscribes with `useSyncExternalStore`. */
export class WarRoomStore {
  private state: WarRoomState = { view: null, filter: NO_FILTER, detail: null, terminal: null, reading: null, integrations: [], autostart: null, error: null, toast: null, busy: false };
  private readonly listeners = new Set<() => void>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly rooms: WarRoomGateway;
  private readonly integration: IntegrationGateway;
  readonly terminals: TerminalGateway;
  private readonly filters: FilterStorage | null;

  constructor(
    rooms: WarRoomGateway,
    integration: IntegrationGateway,
    terminals: TerminalGateway,
    filters: FilterStorage | null = null,
  ) {
    this.rooms = rooms;
    this.integration = integration;
    this.terminals = terminals;
    this.filters = filters;
    this.state = { ...this.state, filter: filters?.load() ?? NO_FILTER };
  }

  setFilter(filter: Filter) {
    this.set({ filter });
    this.filters?.save(filter);
  }

  /** Only this repo (e.g. from the pixel room's cabinet of closed sessions). */
  showOnlyRepo(repoId: string) {
    this.setFilter({ ...this.state.filter, repos: [repoId] });
  }

  toggleRepoFilter(repoId: string) {
    this.setFilter({ ...this.state.filter, repos: toggle(this.state.filter.repos, repoId) });
  }

  toggleSkillFilter(name: string) {
    this.setFilter({ ...this.state.filter, skills: toggle(this.state.filter.skills, name) });
  }

  toggleModelFilter(model: string) {
    this.setFilter({ ...this.state.filter, models: toggle(this.state.filter.models, model) });
  }

  toggleEffortFilter(effort: string) {
    this.setFilter({ ...this.state.filter, efforts: toggle(this.state.filter.efforts, effort) });
  }

  toggleSourceFilter(source: SkillSourceView) {
    this.setFilter({ ...this.state.filter, sources: toggle(this.state.filter.sources, source) });
  }

  clearFilter() {
    this.setFilter(NO_FILTER);
  }

  async start(): Promise<() => void> {
    const unsubscribe = await this.rooms.onChange((view) => {
      this.set({ view });
      this.refreshDetailIfChanged(view);
    });
    const offOpen = await this.rooms.onOpenRequest((id, reply) => this.openDetail(id, { reply }));
    await this.run(async () => {
      const [view, integrations] = await Promise.all([this.rooms.load(), this.integration.status()]);
      this.set({ view, integrations });
    });
    this.integration.autostart().then(
      (autostart) => this.set({ autostart }),
      () => this.set({ autostart: null }),
    );
    return () => {
      unsubscribe();
      offOpen();
    };
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.state;

  /** Go to the session window; if it was finished, the core marks it as seen. */
  goTo(s: SessionView) {
    void this.rooms.focus(s.id).then(
      (via) => this.notify({ text: `→ ${s.title ?? s.worktree_path} (${via})`, tone: "ok" }),
      (reason) => this.notify({ text: String(reason), tone: "warn" }),
    );
  }

  approve(s: SessionView) {
    void this.run(() => this.rooms.approve(s.id)).then((ok) => ok && this.notify({ text: copy.toasts.approved, tone: "ok" }));
  }

  deny(s: SessionView) {
    void this.run(() => this.rooms.deny(s.id)).then((ok) => ok && this.notify({ text: copy.toasts.denied, tone: "ok" }));
  }

  /** Types a message into the session and sends it. Resolves to `true` if delivered. */
  async send(s: SessionView, text: string): Promise<boolean> {
    try {
      await this.rooms.sendInput(s.id, text);
      return true;
    } catch (e) {
      this.notify({ text: String(e), tone: "warn" });
      return false;
    }
  }

  launch(provider: string, cwd: string, label: string, target: LaunchTarget) {
    void this.rooms.launch(provider, cwd, target).then(
      (launched) => this.afterLaunch(launched, label),
      (e) => this.notify({ text: String(e), tone: "warn" }),
    );
  }

  resume(s: SessionView, target: LaunchTarget) {
    void this.rooms.resume(s.id, target).then(
      (launched) => this.afterLaunch(launched, s.title ?? s.worktree_path),
      (e) => this.notify({ text: String(e), tone: "warn" }),
    );
  }

  /** Opens a session preview (or switches it to another session). */
  openDetail(id: string, options: { reply?: boolean } = {}) {
    const same = this.state.detail?.id === id;
    this.set({
      detail: {
        id,
        data: same ? this.state.detail!.data : null,
        agent: null,
        reply: options.reply ?? false,
        changes: same ? this.state.detail!.changes : null,
      },
    });
    void this.loadDetail(id);
  }

  /** Jumps to what has waited longest (same as the global shortcut). */
  goNext() {
    void this.rooms.focusNext().then(
      (id) => id == null && this.notify({ text: copy.topbar.nothingWaiting, tone: "ok" }),
      (e) => this.notify({ text: String(e), tone: "warn" }),
    );
  }

  /** Loads the open session's edited files and commits. */
  loadChanges() {
    const open = this.state.detail;
    if (!open) return;
    this.set({ detail: { ...open, changes: { data: null } } });
    void this.rooms.sessionChanges(open.id).then(
      (data) => {
        const now = this.state.detail;
        if (now?.id === open.id) this.set({ detail: { ...now, changes: { data } } });
      },
      (e) => {
        const now = this.state.detail;
        if (now?.id === open.id) this.set({ detail: { ...now, changes: null } });
        this.notify({ text: String(e), tone: "warn" });
      },
    );
  }

  /** Shows one commit's diff over the preview. */
  openDiff(hash: string, short: string) {
    const open = this.state.detail;
    if (!open) return;
    this.set({ detail: { ...open, diff: { hash, short, text: null } } });
    void this.rooms.commitDiff(open.id, hash).then(
      (text) => {
        const now = this.state.detail;
        if (now?.id === open.id && now.diff?.hash === hash) this.set({ detail: { ...now, diff: { hash, short, text } } });
      },
      (e) => {
        this.closeDiff();
        this.notify({ text: String(e), tone: "warn" });
      },
    );
  }

  closeDiff() {
    const open = this.state.detail;
    if (open) this.set({ detail: { ...open, diff: null } });
  }

  /** Opens a subagent preview (inside its session panel). */
  openSubagent(id: string, agent: string) {
    const same = this.state.detail?.id === id;
    this.set({ detail: { id, data: same ? this.state.detail!.data : null, agent: { id: agent, data: null } } });
    if (!same) void this.loadDetail(id);
    void this.loadSubagent(id, agent);
  }

  /** From the subagent back to its session. */
  backToSession() {
    const open = this.state.detail;
    if (open) this.set({ detail: { ...open, agent: null } });
  }

  private async loadSubagent(id: string, agent: string) {
    try {
      const data = await this.rooms.subagentDetail(id, agent);
      const open = this.state.detail;
      if (open?.id === id && open.agent?.id === agent) this.set({ detail: { ...open, agent: { id: agent, data } } });
    } catch (e) {
      this.backToSession();
      this.notify({ text: String(e), tone: "warn" });
    }
  }

  closeDetail() {
    this.set({ detail: null });
  }

  /** Opens a final answer at reading size (a subagent's result when `agent` is given). */
  readAnswer(id: string, agent: string | null = null) {
    this.set({ reading: { id, agent } });
  }

  closeReader() {
    this.set({ reading: null });
  }

  openExternal(url: string) {
    void this.rooms.openExternal(url).catch((e) => this.notify({ text: String(e), tone: "warn" }));
  }

  private async loadDetail(id: string) {
    try {
      const data = await this.rooms.detail(id);
      // It may have been closed or switched while loading.
      const open = this.state.detail;
      if (open?.id === id) this.set({ detail: { ...open, data } });
    } catch (e) {
      if (this.state.detail?.id === id) this.set({ detail: null });
      this.notify({ text: String(e), tone: "warn" });
    }
  }

  /** The preview stays live: it reloads when its session has new activity. */
  private refreshDetailIfChanged(view: WarRoomView) {
    const open = this.state.detail;
    if (!open?.data) return;
    const fresh = view.rooms.flatMap((r) => r.sessions).find((s) => s.id === open.id);
    if (!fresh) return;
    const shown = open.data.session;
    if (
      fresh.last_activity_at !== shown.last_activity_at ||
      fresh.attention !== shown.attention ||
      fresh.can_approve !== shown.can_approve ||
      fresh.title !== shown.title
    ) {
      // Paint the fresh card now and fetch the conversation behind it.
      this.set({ detail: { ...open, data: { ...open.data, session: fresh } } });
      void this.loadDetail(open.id);
      if (open.agent) void this.loadSubagent(open.id, open.agent.id);
    }
  }

  openTerminal(id: string, label: string) {
    this.set({ terminal: { id, label } });
  }

  closeTerminalPanel() {
    this.set({ terminal: null });
  }

  private afterLaunch(launched: Launched, label: string) {
    if (launched.pty_id) this.openTerminal(launched.pty_id, label);
    else this.notify({ text: copy.toasts.openedIn(launched.via), tone: "ok" });
  }

  acknowledge(s: SessionView) {
    void this.run(() => this.rooms.markSeen(s.id));
  }

  acknowledgeAll() {
    void this.run(() => this.rooms.markAllSeen());
  }

  toggleArchive(s: SessionView) {
    void this.run(() => (s.archived ? this.rooms.unarchive(s.id) : this.rooms.archive(s.id)));
  }

  toggleMute(s: SessionView) {
    void this.run(() => (s.muted ? this.rooms.unmute(s.id) : this.rooms.mute(s.id)));
  }

  install(provider: string) {
    void this.run(async () => this.replaceIntegration(await this.integration.install(provider)));
  }

  setAutostart(enabled: boolean) {
    void this.run(async () => this.set({ autostart: await this.integration.setAutostart(enabled) }));
  }

  uninstall(provider: string) {
    void this.run(async () => this.replaceIntegration(await this.integration.uninstall(provider)));
  }

  private replaceIntegration(status: IntegrationStatus) {
    this.set({ integrations: this.state.integrations.map((i) => (i.provider === status.provider ? status : i)) });
  }

  dismissError() {
    this.set({ error: null });
  }

  private notify(toast: Toast) {
    clearTimeout(this.toastTimer);
    this.set({ toast });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), TOAST_MS);
  }

  /** Runs an action, showing the error if it fails. Resolves to whether it succeeded. */
  private async run(action: () => Promise<unknown>): Promise<boolean> {
    this.set({ busy: true });
    try {
      await action();
      this.set({ busy: false });
      return true;
    } catch (e) {
      this.set({ busy: false, error: String(e) });
      return false;
    }
  }

  private set(patch: Partial<WarRoomState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
}
