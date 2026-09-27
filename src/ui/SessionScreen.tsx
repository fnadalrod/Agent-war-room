import type { WarRoomStore } from "../application/warRoomStore";
import {
  activity,
  contextLabel,
  deskName,
  modelName,
  shortId,
  whereItLives,
  type SessionView,
} from "../domain/attention";
import { since } from "./useStore";

type Props = { session: SessionView; store: WarRoomStore; now: number };

export function SessionScreen({ session: s, store, now }: Props) {
  const reply = s.attention !== "working" ? s.last_reply : null;

  return (
    <article className="screen" data-attention={s.attention} data-muted={s.muted} data-archived={s.archived}>
      <button
        className="glass"
        disabled={!s.alive}
        onClick={() => store.goTo(s)}
        title={s.alive ? `Ir a la sesión · ${whereItLives(s)}` : "Sesión cerrada"}
      >
        <div className="title">{s.title ?? deskName(s)}</div>
        <div className="status">{activity(s)}</div>
        <div className="since">{since(s.status_since, now)}</div>
        {reply && <p className="reply">{reply}</p>}
        {s.subagents.length > 0 && (
          <ul className="subagents">
            {s.subagents.map((a) => (
              <li key={a.id} title={a.id}>
                <span className="who">{a.description ?? a.kind ?? "subagente"}</span>
                {a.last_tool && <span className="doing">{a.last_tool}</span>}
              </li>
            ))}
          </ul>
        )}
      </button>

      <footer>
        <div className="where">
          <span className="desk">{deskName(s)}</span>
          {s.branch && <span className="branch">{s.branch}</span>}
          {s.is_linked_worktree && <span className="tag">worktree</span>}
        </div>
        <div className="meta">
          {modelName(s) && <span>{modelName(s)}</span>}
          {contextLabel(s) && <span>· {contextLabel(s)} ctx</span>}
          <span>· {s.turns} turnos</span>
          <span>· {whereItLives(s)}</span>
          <span className="id">{shortId(s)}</span>
        </div>
        <div className="actions">
          {s.attention === "finished" && <button onClick={() => store.acknowledge(s)}>Visto</button>}
          <button onClick={() => store.toggleMute(s)}>{s.muted ? "Reactivar avisos" : "Silenciar"}</button>
          <button onClick={() => store.toggleArchive(s)}>{s.archived ? "Readmitir" : "Despedir"}</button>
        </div>
      </footer>
    </article>
  );
}
