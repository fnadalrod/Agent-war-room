import type { IntegrationStatus, SessionView, WarRoomView } from "../domain/attention";
import type { IntegrationGateway, WarRoomGateway } from "./ports";

export type Toast = { text: string; tone: "ok" | "warn" };

export type WarRoomState = {
  view: WarRoomView | null;
  integration: IntegrationStatus | null;
  error: string | null;
  toast: Toast | null;
  busy: boolean;
};

const TOAST_MS = 3500;

/** Store sin framework: la UI se suscribe con `useSyncExternalStore`. */
export class WarRoomStore {
  private state: WarRoomState = { view: null, integration: null, error: null, toast: null, busy: false };
  private readonly listeners = new Set<() => void>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly rooms: WarRoomGateway;
  private readonly integration: IntegrationGateway;

  constructor(rooms: WarRoomGateway, integration: IntegrationGateway) {
    this.rooms = rooms;
    this.integration = integration;
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

  private async run(action: () => Promise<unknown>) {
    this.set({ busy: true });
    try {
      await action();
      this.set({ busy: false });
    } catch (e) {
      this.set({ busy: false, error: String(e) });
    }
  }

  private set(patch: Partial<WarRoomState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
}
