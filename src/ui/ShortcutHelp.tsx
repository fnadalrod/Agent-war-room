import { useEffect } from "react";
import { createPortal } from "react-dom";
import { copy } from "../domain/copy";
import { XIcon } from "./icons";

const KEYS: Array<[string, () => string]> = [
  ["j", () => copy.shortcuts.next],
  ["k", () => copy.shortcuts.prev],
  [copy.shortcuts.keyEnter, () => copy.shortcuts.go],
  ["r", () => copy.shortcuts.read],
  [copy.shortcuts.keyEsc, () => copy.shortcuts.close],
  ["?", () => copy.shortcuts.help],
];

/** The room's keyboard shortcuts. Esc, ? or a click outside closes it. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "?") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="reader-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="reader shortcuts" role="dialog" aria-modal="true" aria-label={copy.shortcuts.title}>
        <header>
          <strong>{copy.shortcuts.title}</strong>
          <span className="spacer" />
          <button className="icon" onClick={onClose} aria-label={copy.detail.closeShort} title={copy.detail.closeEsc}>
            <XIcon />
          </button>
        </header>
        <dl>
          {KEYS.map(([key, what]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{what()}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>,
    document.body,
  );
}
