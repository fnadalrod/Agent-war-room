import { useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import { providerName, roomHome, type RoomView } from "../domain/attention";
import { copy } from "../domain/copy";
import { PlusIcon } from "./icons";
import { SessionScreen } from "./SessionScreen";

type Props = {
  room: RoomView;
  store: WarRoomStore;
  now: number;
  showArchived: boolean;
  /** Agents that can be started here (`claude`, `codex`…). */
  agents: string[];
  /** Say on each card which agent it is (the room mixes several). */
  showProvider: boolean;
};

export function RoomPanel({ room, store, now, showArchived, agents, showProvider }: Props) {
  const sessions = room.sessions.filter((s) => showArchived || !s.archived);
  const home = roomHome(room);

  return (
    <section className="room" data-attention={room.attention}>
      <header className="room-head">
        <span className="dot" data-attention={room.attention} />
        <h2>{room.repo_name}</h2>
        <span className="count">{sessions.length}</span>
        {home && <LaunchButtons home={home} label={room.repo_name} agents={agents} store={store} />}
      </header>
      <div className="cards">
        {sessions.map((s) => (
          <SessionScreen key={s.id} session={s} store={store} now={now} showProvider={showProvider} />
        ))}
      </div>
    </section>
  );
}

type LaunchProps = { home: string; label: string; agents: string[]; store: WarRoomStore };

/** One agent: "+ Agent" and "+ in Warp". Several: "+ Agent" opens a menu of agent × terminal. */
function LaunchButtons({ home, label, agents, store }: LaunchProps) {
  const [open, setOpen] = useState(false);
  if (agents.length <= 1) {
    const agent = agents[0] ?? "claude";
    return (
      <span className="room-actions">
        <button className="ghost" onClick={() => store.launch(agent, home, label, "app")} title={copy.room.newAgentTitle(home)}>
          <PlusIcon size={14} /> {copy.room.newAgent}
        </button>
        <button className="ghost" onClick={() => store.launch(agent, home, label, "warp")} title={copy.room.newAgentInWarpTitle(home)}>
          <PlusIcon size={14} /> {copy.actions.inWarp}
        </button>
      </span>
    );
  }
  const pick = (agent: string, target: "app" | "warp") => {
    setOpen(false);
    store.launch(agent, home, label, target);
  };
  return (
    <span className="room-actions launch-menu">
      <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title={copy.room.launchTitle(home)}>
        <PlusIcon size={14} /> {copy.room.newAgent}
      </button>
      {open && (
        <div className="popover" role="menu" aria-label={copy.room.launchTitle(home)}>
          {agents.map((agent) => (
            <div className="launch-row" key={agent}>
              <button role="menuitem" onClick={() => pick(agent, "app")}>
                {copy.room.launchInApp(providerName(agent))}
              </button>
              <button role="menuitem" onClick={() => pick(agent, "warp")}>
                {copy.room.launchInWarp(providerName(agent))}
              </button>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
