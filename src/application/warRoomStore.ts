import type { IntegrationStatus, SessionView, WarRoomView } from "../domain/attention";
import type { IntegrationGateway, Launched, LaunchTarget, TerminalGateway, WarRoomGateway } from "./ports";

export type Toast = { text: string; tone: "ok" | "warn" };

/** Terminal de la app abierto en el panel. */
export type OpenTerminal = { id: string; label: string };

export type WarRoomState = {
  view: WarRoomView | null;
  terminal: OpenTerminal | null;
  integration: IntegrationStatus | null;
  error: string | null;
  toast: Toast | null;
  busy: boolean;
};

const TOAST_MS = 3500;

/** Store sin framework: la UI se suscribe con `useSyncExternalStore`. */
export class WarRoomStore {
  private state: WarRoomState = { view: null, terminal: null, integration: null, error: null, toast: null, busy: false };
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
    const unsubscribe = await this.rooms.onChange((view) => this.set({ view }));
    await this.run(async () => {
      const [view, integration] = await Promise.all([this.rooms.load(), this.integration.status()]);
      this.set({ view, integration });
    });
    return unsubscribe;
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
