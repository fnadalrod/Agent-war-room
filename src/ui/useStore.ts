import { useEffect, useState, useSyncExternalStore } from "react";
import type { WarRoomState, WarRoomStore } from "../application/warRoomStore";
import { copy } from "../domain/copy";

export function useWarRoom(store: WarRoomStore): WarRoomState {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

/** Clock for the "3 min ago" labels; no need for more precision. */
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
  if (s < 45) return copy.time.now;
  const m = Math.round(s / 60);
  if (m < 60) return copy.time.minutesAgo(m);
  const h = Math.round(m / 60);
  if (h < 24) return copy.time.hoursAgo(h);
  return copy.time.daysAgo(Math.round(h / 24));
}

/** Per-machine preference (chosen view…). Without storage it lives in memory. */
export function usePreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      return stored && allowed.includes(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  const update = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // Storage unavailable: the preference lasts as long as the window.
    }
  };
  return [value, update];
}
