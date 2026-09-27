import { useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import {
  activity,
  contextLabel,
  deskName,
  isWritable,
  modelName,
  shortId,
  whereItLives,
  type SessionView,
} from "../domain/attention";
import { since } from "./useStore";

type Props = { session: SessionView; store: WarRoomStore; now: number };

export function SessionScreen({ session: s, store, now }: Props) {
  const reply = s.attention !== "working" ? s.last_reply : null;
  const label = s.title ?? deskName(s);

  return (
    <article className="screen" data-attention={s.attention} data-muted={s.muted} data-archived={s.archived}>
      <button
        className="glass"
        disabled={!s.alive}
        onClick={() => store.goTo(s)}
        title={s.alive ? `Ir a la sesión · ${whereItLives(s)}` : "Sesión cerrada"}
      >
        <div className="title">{label}</div>
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

      {s.can_approve && (
        <div className="approval">
          <button className="primary" onClick={() => store.approve(s)}>
            Aprobar
          </button>
          <button onClick={() => store.deny(s)}>Denegar</button>
          <span className="muted">o contesta en su terminal</span>
        </div>
      )}

      {isWritable(s) && <QuickInput session={s} store={store} />}

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
          {s.pty_id && s.alive && <button onClick={() => store.openTerminal(s.pty_id!, label)}>Terminal</button>}
          {!s.alive && (
            <>
              <button onClick={() => store.resume(s, "app")}>Reanudar</button>
              <button onClick={() => store.resume(s, "warp")}>Reanudar en Warp</button>
            </>
          )}
          <button onClick={() => store.toggleMute(s)}>{s.muted ? "Reactivar avisos" : "Silenciar"}</button>
          <button onClick={() => store.toggleArchive(s)}>{s.archived ? "Readmitir" : "Despedir"}</button>
        </div>
      </footer>
    </article>
  );
}

/** Mensaje rápido a la sesión, como si lo escribieras en su terminal. */
function QuickInput({ session, store }: { session: SessionView; store: WarRoomStore }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    if (await store.send(session, text)) setText("");
    setSending(false);
  };

  return (
    <form className="quick-input" onSubmit={submit}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escribir a la sesión…"
        disabled={sending}
        aria-label="Mensaje para la sesión"
      />
    </form>
  );
}
