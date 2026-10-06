import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { copy } from "../domain/copy";
import { XIcon } from "./icons";
import { Markdown } from "./Markdown";
import { CopyButton } from "./CopyButton";

type Props = {
  /** What it is ("Final answer", "Result") and whose. */
  heading: string;
  title: string;
  text: string;
  onLink: (url: string) => void;
  onClose: () => void;
};

/** An agent's answer at reading size, over the whole window. Esc or a click outside closes it. */
export function AnswerReader({ heading, title, text, onLink, onClose }: Props) {
  // Focused on open, so arrows, PageDown and Space scroll the answer right away.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => body.current?.focus(), []);

  useEffect(() => {
    // Capture: closes the reader before the panel's own Esc (which would close the panel).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="reader-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <article className="reader" role="dialog" aria-modal="true" aria-label={`${heading}: ${title}`}>
        <header>
          <div>
            <span className="reader-kind">{heading}</span>
            <strong>{title}</strong>
          </div>
          <span className="spacer" />
          <CopyButton text={text} />
          <button className="icon" onClick={onClose} aria-label={copy.detail.closeShort} title={copy.detail.closeEsc}>
            <XIcon />
          </button>
        </header>
        <div className="reader-body" ref={body} tabIndex={-1}>
          <Markdown text={text} onLink={onLink} />
        </div>
      </article>
    </div>,
    document.body,
  );
}
