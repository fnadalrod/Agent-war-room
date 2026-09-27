import type { WarRoomStore } from "../application/warRoomStore";
import type { RoomView } from "../domain/attention";
import { SessionScreen } from "./SessionScreen";

type Props = { room: RoomView; store: WarRoomStore; now: number; showArchived: boolean };

export function RoomPanel({ room, store, now, showArchived }: Props) {
  const sessions = room.sessions.filter((s) => showArchived || !s.archived);

  return (
    <section className="room" data-attention={room.attention}>
      <h2>
        <span className="lamp small" data-attention={room.attention} />
        {room.repo_name}
        <small>{sessions.length}</small>
      </h2>
      <div className="screens">
        {sessions.map((s) => (
          <SessionScreen key={s.id} session={s} store={store} now={now} />
        ))}
      </div>
    </section>
  );
}
