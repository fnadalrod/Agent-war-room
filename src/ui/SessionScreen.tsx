import type { WarRoomStore } from "../application/warRoomStore";
import { ATTENTION_LABEL, deskName, shortId, type SessionView } from "../domain/attention";
import { since } from "./useStore";

type Props = { session: SessionView; store: WarRoomStore; now: number };

export function SessionScreen({ session: s, store, now }: Props) {
  return (
    <article
      className="screen"
      data-attention={s.attention}
      data-muted={s.muted}
      data-archived={s.archived}
      onClick={() => store.acknowledge(s)}
      title={s.attention === "finished" ? "Clic para marcar como revisada" : undefined}
    >
      <div className="glass">
        <div className="status">{s.status_label}</div>
        <div className="since">{since(s.status_since, now)}</div>
        {s.subagents.length > 0 && (
          <div className="subagents">
            {s.subagents.map((a) => (
              <span key={a.id} className="subagent" title={a.id}>
                {a.kind ?? "subagente"}
              </span>
            ))}
          </div>
        )}
      </div>

      <footer>
        <div className="where">
          <span className="desk">{deskName(s)}</span>
          {s.branch && <span className="branch">{s.branch}</span>}
          {s.is_linked_worktree && <span className="tag">worktree</span>}
        </div>
        <div className="meta">
          <span>{ATTENTION_LABEL[s.attention]}</span>
          <span>· {s.turns} turnos</span>
          {s.terminal && <span>· {s.terminal}</span>}
          {s.tmux_pane && <span>· tmux {s.tmux_pane}</span>}
          <span className="id">{shortId(s)}</span>
        </div>
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => store.toggleMute(s)}>{s.muted ? "Reactivar avisos" : "Silenciar"}</button>
          <button onClick={() => store.toggleArchive(s)}>{s.archived ? "Readmitir" : "Despedir"}</button>
        </div>
      </footer>
    </article>
  );
}
