import { useEffect, useRef } from "react";
import type { WarRoomStore } from "../../application/warRoomStore";
import { agentName, deskName, whereItLives } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { ArchiveIcon, BellIcon, BellOffIcon, CheckIcon, EyeIcon, GoIcon, PlayIcon, ReadIcon, RestoreIcon } from "../icons";
import type { Hit } from "./office";

type Props = { at: { x: number; y: number }; hit: Hit; store: WarRoomStore; onClose: () => void };

/** Right click on a desk or an agent: what you would do from its card, without opening anything. */
export function DeskMenu({ at, hit, store, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const s = hit.session;
  const title = s.title ?? deskName(s);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const act = (run: () => void) => () => {
    run();
    onClose();
  };

  return (
    <div ref={ref} className="desk-menu" role="menu" aria-label={copy.pixel.menuLabel(title)} style={{ left: at.x, top: at.y }}>
      <p className="desk-menu-title">{hit.agent ? agentName(hit.agent) : title}</p>
      {hit.agent ? (
        <button role="menuitem" onClick={act(() => store.openSubagent(s.id, hit.agent!.id))}>
          <EyeIcon size={14} /> {copy.actions.openPreview}
        </button>
      ) : (
        <>
          <button role="menuitem" onClick={act(() => store.openDetail(s.id))}>
            <EyeIcon size={14} /> {copy.actions.openPreview}
          </button>
          {s.alive ? (
            <button role="menuitem" onClick={act(() => store.goTo(s))}>
              <GoIcon size={14} /> {copy.actions.goToWindowVia(whereItLives(s))}
            </button>
          ) : (
            <button role="menuitem" onClick={act(() => store.resume(s, "app"))}>
              <PlayIcon size={13} /> {copy.actions.resume}
            </button>
          )}
          {s.last_reply && s.attention !== "working" && (
            <button role="menuitem" onClick={act(() => store.readAnswer(s.id))}>
              <ReadIcon size={14} /> {copy.actions.readAnswer}
            </button>
          )}
          {s.attention === "finished" && (
            <button role="menuitem" onClick={act(() => store.acknowledge(s))}>
              <CheckIcon size={14} /> {copy.actions.markSeen}
            </button>
          )}
          <button role="menuitem" onClick={act(() => store.toggleMute(s))}>
            {s.muted ? <BellIcon size={14} /> : <BellOffIcon size={14} />} {s.muted ? copy.actions.unmute : copy.actions.mute}
          </button>
          <button role="menuitem" onClick={act(() => store.toggleArchive(s))}>
            {s.archived ? <RestoreIcon size={14} /> : <ArchiveIcon size={14} />} {s.archived ? copy.actions.unarchive : copy.actions.archive}
          </button>
        </>
      )}
    </div>
  );
}
