import { useEffect } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import { neighbourSession, type WarRoomView } from "../domain/attention";

type Options = { view: WarRoomView | null; showArchived: boolean; onHelp: () => void };

/** Where typing belongs to something else: a text box, the terminal, a menu item with focus. */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === document.body) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.closest(".xterm") != null;
}

/**
 * Room-wide keys: j / k next and previous session (opens its preview), Enter goes to the open one,
 * r reads its final answer, ? shows the help. Esc is handled by whatever is open.
 */
export function useShortcuts(store: WarRoomStore, { view, showArchived, onHelp }: Options) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      const { detail, reading } = store.snapshot();
      if (reading) return;
      const open = view?.rooms.flatMap((r) => r.sessions).find((s) => s.id === detail?.id) ?? null;
      switch (e.key) {
        case "j":
        case "k": {
          const next = view && neighbourSession(view, detail?.id ?? null, e.key === "j" ? 1 : -1, showArchived);
          if (next) store.openDetail(next.id);
          break;
        }
        case "Enter":
          // A focused button keeps its own Enter.
          if ((e.target as HTMLElement | null)?.closest("button, a")) return;
          if (open?.alive) store.goTo(open);
          break;
        case "r":
          if (open?.last_reply) store.readAnswer(open.id);
          break;
        case "?":
          onHelp();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, view, showArchived, onHelp]);
}
