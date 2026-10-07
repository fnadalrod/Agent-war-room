import { useEffect, useRef, useState } from "react";
import { copy } from "../domain/copy";

type Props = {
  active: boolean;
  count: number;
  disabled: boolean;
  onToggle: () => void;
};

/** Pixel-art drinking bird: its nodding loop presses Y while automatic approval is active. */
export function DrinkingBird({ active, count, disabled, onToggle }: Props) {
  const title = active ? copy.topbar.autoApproveOn : copy.topbar.autoApproveOff;
  const previous = useRef(count);
  const [increment, setIncrement] = useState<number | null>(null);
  useEffect(() => {
    const increased = count > previous.current;
    previous.current = count;
    if (!increased) return;
    setIncrement(count);
    const timeout = setTimeout(() => setIncrement(null), 1000);
    return () => clearTimeout(timeout);
  }, [count]);
  return (
    <button
      className="drinking-bird"
      data-active={active}
      aria-label={title}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onClick={onToggle}
    >
      <svg viewBox="0 0 58 40" width="58" height="40" shapeRendering="crispEdges" aria-hidden="true">
        <g className="drinking-bird__key">
          <path className="drinking-bird__key-shadow" d="M2 27h18v11H2Z" />
          <path className="drinking-bird__keycap" d="M3 24h16v12H3Z" />
          <path className="drinking-bird__key-letter" d="M6 27h2v2h2v-2h2v2h-2v4H8v-4H6Z" />
        </g>
        <g className="drinking-bird__stand">
          <path d="M26 35h20v3H26Z" />
          <path d="M29 19h3v17h-3Zm12 0h3v17h-3Z" />
          <path d="M29 19h15v3H29Z" />
        </g>
        <g className="drinking-bird__rocker">
          <path className="drinking-bird__body" d="M28 18h11v10H28Zm-3 3h17v5H25Z" />
          <path className="drinking-bird__neck" d="M30 8h5v13h-5Z" />
          <path className="drinking-bird__head" d="M23 2h15v9H23Zm-3 3h21v4H20Z" />
          <path className="drinking-bird__beak" d="M14 6h9v4h-9Zm-3 1h3v2h-3Z" />
          <path className="drinking-bird__eye" d="M23 5h3v3h-3Z" />
          <path className="drinking-bird__pupil" d="M23 6h2v2h-2Z" />
        </g>
        <path className="drinking-bird__pivot" d="M32 19h5v5h-5Z" />
      </svg>
      <span className="drinking-bird__count" aria-hidden="true">{count}</span>
      {increment != null && (
        <span key={increment} className="drinking-bird__increment" aria-hidden="true">
          {copy.topbar.autoApproveIncrement}
        </span>
      )}
    </button>
  );
}
