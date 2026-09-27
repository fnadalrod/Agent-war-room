import type { IntegrationStatus, WarRoomView } from "../domain/attention";

export type Unsubscribe = () => void;

/** Todo lo que el front necesita del núcleo. La implementación real habla con Tauri. */
export interface WarRoomGateway {
  load(): Promise<WarRoomView>;
  onChange(listener: (view: WarRoomView) => void): Promise<Unsubscribe>;
  markSeen(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
  mute(id: string): Promise<void>;
  unmute(id: string): Promise<void>;
}

export interface IntegrationGateway {
  status(): Promise<IntegrationStatus>;
  install(): Promise<IntegrationStatus>;
  uninstall(): Promise<IntegrationStatus>;
}
