import type { WarRoomStore } from "../application/warRoomStore";
import { deskName, isOnWatch, plainText, type SessionView, type WarRoomView } from "../domain/attention";
import { CheckIcon, EyeIcon, GoIcon } from "./icons";
import { since } from "./useStore";

type Props = { view: WarRoomView; store: WarRoomStore; now: number };

/** Lo que te está esperando, de todos los repos, en un solo sitio. */
export function AttentionQueue({ view, store, now }: Props) {
  const waiting = view.rooms
    .flatMap((room) => room.sessions.map((s) => ({ room: room.repo_name, s })))
    .filter(({ s }) => isOnWatch(s) && (s.attention === "needs_you" || s.attention === "finished"))
    .sort((a, b) => urgency(b.s) - urgency(a.s) || b.s.status_since - a.s.status_since);

  if (waiting.length === 0) return null;

  return (
    <section className="queue" aria-label="Requiere tu atención">
      <h2>Requiere tu atención</h2>
      <ul>
        {waiting.map(({ room, s }) => (
          <li key={s.id} data-attention={s.attention}>
            <span className="dot" data-attention={s.attention} />
            <button className="queue-main" onClick={() => store.openDetail(s.id)} title="Abrir la vista previa">
              <strong>{s.title ?? deskName(s)}</strong>
              <span className="muted">
                {room}
                {s.branch && ` · ${s.branch}`}
              </span>
              <span className="queue-status" data-kind={s.attention === "finished" && s.last_reply ? "reply" : "status"}>
                {s.attention === "finished" && s.last_reply ? plainText(s.last_reply) : s.status_label}
              </span>
            </button>
            <span className="muted queue-time">{since(s.status_since, now)}</span>
            <span className="queue-actions">
              {s.can_approve && (
                <>
                  <button className="primary danger" onClick={() => store.approve(s)}>
                    Aprobar
                  </button>
                  <button onClick={() => store.deny(s)}>Denegar</button>
                </>
              )}
              <button className="icon" onClick={() => store.openDetail(s.id)} title="Vista previa">
                <EyeIcon />
              </button>
              {s.alive && (
                <button className="icon" onClick={() => store.goTo(s)} title="Ir a su ventana">
                  <GoIcon />
                </button>
              )}
              {s.attention === "finished" && (
                <button className="icon" onClick={() => store.acknowledge(s)} title="Marcar como visto">
                  <CheckIcon />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function urgency(s: SessionView): number {
  return s.attention === "needs_you" ? 1 : 0;
}
