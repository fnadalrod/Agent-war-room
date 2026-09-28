import type { WarRoomStore } from "../application/warRoomStore";
import { roomHome, type RoomView } from "../domain/attention";
import { copy } from "../domain/copy";
import { PlusIcon } from "./icons";
import { SessionScreen } from "./SessionScreen";

type Props = { room: RoomView; store: WarRoomStore; now: number; showArchived: boolean };

export function RoomPanel({ room, store, now, showArchived }: Props) {
  const sessions = room.sessions.filter((s) => showArchived || !s.archived);
  const home = roomHome(room);

  return (
    <section className="room" data-attention={room.attention}>
      <header className="room-head">
        <span className="dot" data-attention={room.attention} />
        <h2>{room.repo_name}</h2>
        <span className="count">{sessions.length}</span>
        {home && (
          <span className="room-actions">
            <button className="ghost" onClick={() => store.launch(home, room.repo_name, "app")} title={copy.room.newAgentTitle(home)}>
              <PlusIcon size={14} /> {copy.room.newAgent}
            </button>
            <button
              className="ghost"
              onClick={() => store.launch(home, room.repo_name, "warp")}
              title={copy.room.newAgentInWarpTitle(home)}
            >
              <PlusIcon size={14} /> {copy.actions.inWarp}
            </button>
          </span>
        )}
      </header>
      <div className="cards">
        {sessions.map((s) => (
          <SessionScreen key={s.id} session={s} store={store} now={now} />
        ))}
      </div>
    </section>
  );
}
