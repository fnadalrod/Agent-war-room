import { useEffect, useState, useSyncExternalStore } from "react";
import type { WarRoomState, WarRoomStore } from "../application/warRoomStore";

export function useWarRoom(store: WarRoomStore): WarRoomState {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

/** Reloj para los "hace 3 min"; no hace falta más precisión. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function since(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "ahora";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
