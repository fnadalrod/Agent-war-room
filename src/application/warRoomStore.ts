import type { IntegrationStatus, SessionView, WarRoomView } from "../domain/attention";
import type { IntegrationGateway, WarRoomGateway } from "./ports";

export type WarRoomState = {
  view: WarRoomView | null;
  integration: IntegrationStatus | null;
  error: string | null;
  busy: boolean;
};

/** Store sin framework: la UI se suscribe con `useSyncExternalStore`. */
export class WarRoomStore {
  private state: WarRoomState = { view: null, integration: null, error: null, busy: false };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly rooms: WarRoomGateway,
    private readonly integration: IntegrationGateway,
  ) {}

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

  /** Abrir una pantalla terminada equivale a haberla revisado. */
  acknowledge(s: SessionView) {
    if (s.attention === "finished") void this.run(() => this.rooms.markSeen(s.id));
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
