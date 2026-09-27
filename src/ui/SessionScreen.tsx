import type { WarRoomStore } from "../application/warRoomStore";
import {
  ATTENTION_LABEL,
  contextLabel,
  deskName,
  extraActivity,
  isWritable,
  modelName,
  plainText,
  whereItLives,
  type SessionView,
} from "../domain/attention";
import {
  ArchiveIcon,
  BellIcon,
  BellOffIcon,
  BranchIcon,
  CheckIcon,
  GoIcon,
  PlayIcon,
  RestoreIcon,
  RobotIcon,
  TerminalIcon,
} from "./icons";
import { QuickInput } from "./QuickInput";
import { since } from "./useStore";

type Props = { session: SessionView; store: WarRoomStore; now: number };

/** Tarjeta de una sesión. Clic en el cuerpo: vista previa. */
export function SessionScreen({ session: s, store, now }: Props) {
  const excerpt = s.attention !== "working" && s.last_reply ? plainText(s.last_reply) : null;
  const label = s.title ?? deskName(s);

  return (
    <article className="card" data-attention={s.attention} data-muted={s.muted} data-archived={s.archived}>
      <button className="card-body" onClick={() => store.openDetail(s.id)} title="Abrir la vista previa">
        <div className="card-top">
          <span className="chip" data-attention={s.attention}>
            {ATTENTION_LABEL[s.attention]}
          </span>
          <span className="muted">{since(s.status_since, now)}</span>
          <span className="spacer" />
          {s.subagents.length > 0 && (
            <span className="badge" title={s.subagents.map((a) => a.description ?? a.kind).join("\n")}>
              <RobotIcon size={13} /> {s.subagents.length}
            </span>
          )}
          {s.muted && (
            <span className="badge" title="Silenciada">
              <BellOffIcon size={13} />
            </span>
          )}
        </div>
        <h3 className="card-title">{label}</h3>
        {extraActivity(s) && <p className="card-activity">{extraActivity(s)}</p>}
        {excerpt && <p className="card-excerpt">{excerpt}</p>}
        {s.attention === "working" && s.subagents.length > 0 && (
          <ul className="card-subagents">
            {s.subagents.slice(0, 3).map((a) => (
              <li key={a.id}>
                <span className="who">{a.description ?? a.kind ?? "subagente"}</span>
                {a.last_tool && <span className="doing">{a.last_tool}</span>}
              </li>
            ))}
          </ul>
        )}
      </button>

      {s.can_approve && (
        <div className="card-approval">
          <button className="primary danger" onClick={() => store.approve(s)}>
            <CheckIcon size={14} /> Aprobar
          </button>
          <button onClick={() => store.deny(s)}>Denegar</button>
        </div>
      )}

      {isWritable(s) && <QuickInput session={s} store={store} />}

      <footer className="card-foot">
        <div className="card-where">
          <BranchIcon size={13} />
          <span className="branch">{s.branch ?? "sin rama"}</span>
          <span className="muted">· {deskName(s)}</span>
          {s.is_linked_worktree && <span className="tag">worktree</span>}
        </div>
        <div className="card-meta">
          {[modelName(s), contextLabel(s) && `${contextLabel(s)} ctx`, whereItLives(s)].filter(Boolean).join(" · ")}
        </div>
        <div className="card-actions">
          {s.alive ? (
            <button className="primary" onClick={() => store.goTo(s)} title={`Ir a su ventana · ${whereItLives(s)}`}>
              <GoIcon size={14} /> Ir a
            </button>
          ) : (
            <button className="primary" onClick={() => store.resume(s, "app")} title="Reanudar en un terminal de la app">
              <PlayIcon size={13} /> Reanudar
            </button>
          )}
          {!s.alive && (
            <button onClick={() => store.resume(s, "warp")} title="Reanudar en una pestaña de Warp">
              en Warp
            </button>
          )}
          <span className="spacer" />
          {s.attention === "finished" && (
            <button className="icon" onClick={() => store.acknowledge(s)} title="Marcar como visto">
              <CheckIcon />
            </button>
          )}
          {s.pty_id && s.alive && (
            <button className="icon" onClick={() => store.openTerminal(s.pty_id!, label)} title="Abrir su terminal">
              <TerminalIcon />
            </button>
          )}
          <button className="icon" onClick={() => store.toggleMute(s)} title={s.muted ? "Reactivar avisos" : "Silenciar avisos"}>
            {s.muted ? <BellIcon /> : <BellOffIcon />}
          </button>
          <button
            className="icon"
            onClick={() => store.toggleArchive(s)}
            title={s.archived ? "Readmitir en la sala" : "Despedir: ocultar y dejar de avisar"}
          >
            {s.archived ? <RestoreIcon /> : <ArchiveIcon />}
          </button>
        </div>
      </footer>
    </article>
  );
}
