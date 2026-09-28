import type { IntegrationStatus, SessionDetail, SessionView, SubagentPreview, WarRoomView } from "../domain/attention";
import type { IntegrationGateway, Launched, LaunchTarget, TerminalGateway, WarRoomGateway } from "./ports";

export type Toast = { text: string; tone: "ok" | "warn" };

/** Vista previa abierta: `data` es null mientras carga. `agent`: se está viendo uno de sus subagentes. */
export type OpenDetail = {
  id: string;
  data: SessionDetail | null;
  agent: { id: string; data: SubagentPreview | null } | null;
};

/** Terminal de la app abierto en el panel. */
export type OpenTerminal = { id: string; label: string };

export type WarRoomState = {
  view: WarRoomView | null;
  detail: OpenDetail | null;
  terminal: OpenTerminal | null;
  integration: IntegrationStatus | null;
  autostart: boolean | null;
  error: string | null;
  toast: Toast | null;
  busy: boolean;
};

const TOAST_MS = 3500;

/** Store sin framework: la UI se suscribe con `useSyncExternalStore`. */
export class WarRoomStore {
  private state: WarRoomState = { view: null, detail: null, terminal: null, integration: null, autostart: null, error: null, toast: null, busy: false };
  private readonly listeners = new Set<() => void>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly rooms: WarRoomGateway;
  private readonly integration: IntegrationGateway;
  readonly terminals: TerminalGateway;

  constructor(rooms: WarRoomGateway, integration: IntegrationGateway, terminals: TerminalGateway) {
    this.rooms = rooms;
    this.integration = integration;
    this.terminals = terminals;
  }

  async start(): Promise<() => void> {
    const unsubscribe = await this.rooms.onChange((view) => {
      this.set({ view });
      this.refreshDetailIfChanged(view);
    });
    const offOpen = await this.rooms.onOpenRequest((id) => this.openDetail(id));
    await this.run(async () => {
      const [view, integration] = await Promise.all([this.rooms.load(), this.integration.status()]);
      this.set({ view, integration });
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

  /** Ir a la ventana de la sesión; si era un "terminado", el núcleo lo marca como revisado. */
  goTo(s: SessionView) {
    void this.rooms.focus(s.id).then(
      (via) => this.notify({ text: `→ ${s.title ?? s.worktree_path} (${via})`, tone: "ok" }),
      (reason) => this.notify({ text: String(reason), tone: "warn" }),
    );
  }

  approve(s: SessionView) {
    void this.run(() => this.rooms.approve(s.id)).then((ok) => ok && this.notify({ text: "Permiso aprobado", tone: "ok" }));
  }

  deny(s: SessionView) {
    void this.run(() => this.rooms.deny(s.id)).then((ok) => ok && this.notify({ text: "Permiso denegado", tone: "ok" }));
  }

  /** Escribe un mensaje en la sesión y lo envía. Resuelve a `true` si se entregó. */
  async send(s: SessionView, text: string): Promise<boolean> {
    try {
      await this.rooms.sendInput(s.id, text);
      return true;
    } catch (e) {
      this.notify({ text: String(e), tone: "warn" });
      return false;
    }
  }

  launch(cwd: string, label: string, target: LaunchTarget) {
    void this.rooms.launch(cwd, target).then(
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

  /** Abre la vista previa de una sesión (o la cambia a otra). */
  openDetail(id: string) {
    this.set({ detail: { id, data: this.state.detail?.id === id ? this.state.detail.data : null, agent: null } });
    void this.loadDetail(id);
  }

  /** Abre la vista previa de un subagente (dentro del panel de su sesión). */
  openSubagent(id: string, agent: string) {
    const same = this.state.detail?.id === id;
    this.set({ detail: { id, data: same ? this.state.detail!.data : null, agent: { id: agent, data: null } } });
    if (!same) void this.loadDetail(id);
    void this.loadSubagent(id, agent);
  }

  /** Del subagente, de vuelta a su sesión. */
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

  openExternal(url: string) {
    void this.rooms.openExternal(url).catch((e) => this.notify({ text: String(e), tone: "warn" }));
  }

  private async loadDetail(id: string) {
    try {
      const data = await this.rooms.detail(id);
      // Puede haberse cerrado o cambiado a otra mientras cargaba.
      const open = this.state.detail;
      if (open?.id === id) this.set({ detail: { ...open, data } });
    } catch (e) {
      if (this.state.detail?.id === id) this.set({ detail: null });
      this.notify({ text: String(e), tone: "warn" });
    }
  }

  /** La vista previa sigue viva: se recarga cuando su sesión tiene actividad nueva. */
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
      // Pinta ya la tarjeta nueva y trae la conversación detrás.
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
    else this.notify({ text: `Abierto en ${launched.via}`, tone: "ok" });
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

  install() {
    void this.run(async () => this.set({ integration: await this.integration.install() }));
  }

  setAutostart(enabled: boolean) {
    void this.run(async () => this.set({ autostart: await this.integration.setAutostart(enabled) }));
  }

  uninstall() {
    void this.run(async () => this.set({ integration: await this.integration.uninstall() }));
  }

  dismissError() {
    this.set({ error: null });
  }

  private notify(toast: Toast) {
    clearTimeout(this.toastTimer);
    this.set({ toast });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), TOAST_MS);
  }

  /** Ejecuta una acción mostrando el error si falla. Resuelve a si tuvo éxito. */
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
