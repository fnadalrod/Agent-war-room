import type { WarRoomStore } from "../application/warRoomStore";
import { roomHome, type RoomView } from "../domain/attention";
import { SessionScreen } from "./SessionScreen";

type Props = { room: RoomView; store: WarRoomStore; now: number; showArchived: boolean };

export function RoomPanel({ room, store, now, showArchived }: Props) {
  const sessions = room.sessions.filter((s) => showArchived || !s.archived);
  const home = roomHome(room);

  return (
    <section className="room" data-attention={room.attention}>
      <h2>
        <span className="lamp small" data-attention={room.attention} />
        {room.repo_name}
        <small>{sessions.length}</small>
        {home && (
          <span className="room-actions">
            <button onClick={() => store.launch(home, room.repo_name, "app")} title={`Abrir claude en ${home}`}>
              + Agente
            </button>
            <button onClick={() => store.launch(home, room.repo_name, "warp")} title={`Abrir claude en Warp, en ${home}`}>
              + en Warp
            </button>
          </span>
        )}
      </h2>
      <div className="screens">
        {sessions.map((s) => (
          <SessionScreen key={s.id} session={s} store={store} now={now} />
        ))}
      </div>
    </section>
  );
}
