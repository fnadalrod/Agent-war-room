import type { WarRoomStore } from "../application/warRoomStore";
import { deskName, isOnWatch, plainText, type SessionView, stalledMinutes, type WarRoomView } from "../domain/attention";
import { copy } from "../domain/copy";
import { CheckIcon, EyeIcon, GoIcon } from "./icons";
import { since } from "./useStore";

type Props = { view: WarRoomView; store: WarRoomStore; now: number };

/** Everything waiting on you, across all repos, in one place. */
export function AttentionQueue({ view, store, now }: Props) {
  const waiting = view.rooms
    .flatMap((room) => room.sessions.map((s) => ({ room: room.repo_name, s })))
    .filter(({ s }) => isOnWatch(s) && (s.attention === "needs_you" || s.attention === "finished" || s.stalled_since != null))
    .sort((a, b) => urgency(b.s) - urgency(a.s) || b.s.status_since - a.s.status_since);

  if (waiting.length === 0) return null;

  return (
    <section className="queue" aria-label={copy.queue.title}>
      <h2>{copy.queue.title}</h2>
      <ul>
        {waiting.map(({ room, s }) => (
          <li key={s.id} data-attention={s.attention} data-stalled={s.stalled_since != null}>
            <span className="dot" data-attention={s.attention} />
            <button className="queue-main" onClick={() => store.openDetail(s.id)} title={copy.actions.openPreview}>
              <strong>{s.title ?? deskName(s)}</strong>
              <span className="muted">
                {room}
                {s.branch && ` · ${s.branch}`}
              </span>
              <span className="queue-status" data-kind={s.attention === "finished" && s.last_reply ? "reply" : "status"}>
                {s.stalled_since != null
                  ? `${copy.stalled.long(stalledMinutes(s, now) ?? 0)} · ${s.last_action ?? s.status_label}`
                  : s.attention === "finished" && s.last_reply
                    ? plainText(s.last_reply)
                    : s.status_label}
              </span>
            </button>
            <span className="muted queue-time">{since(s.status_since, now)}</span>
            <span className="queue-actions">
              {s.can_approve && (
                <>
                  <button className="primary danger" onClick={() => store.approve(s)}>
                    {copy.actions.approve}
                  </button>
                  <button onClick={() => store.deny(s)}>{copy.actions.deny}</button>
                </>
              )}
              <button className="icon" onClick={() => store.openDetail(s.id)} title={copy.actions.preview}>
                <EyeIcon />
              </button>
              {s.alive && (
                <button className="icon" onClick={() => store.goTo(s)} title={copy.actions.goToWindow}>
                  <GoIcon />
                </button>
              )}
              {s.attention === "finished" && (
                <button className="icon" onClick={() => store.acknowledge(s)} title={copy.actions.markSeen}>
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
  if (s.attention === "needs_you") return 2;
  return s.stalled_since != null ? 1 : 0;
}
