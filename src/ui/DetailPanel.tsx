import { useEffect, useState } from "react";
import type { OpenDetail, WarRoomStore } from "../application/warRoomStore";
import {
  ATTENTION_LABEL,
  contextLabel,
  deskName,
  extraActivity,
  isWritable,
  modelName,
  toolDigest,
  whereItLives,
  type SessionView,
  type TimelineEntryView,
} from "../domain/attention";
import { CheckIcon, CopyIcon, GoIcon, PlayIcon, TerminalIcon, XIcon } from "./icons";
import { Markdown } from "./Markdown";
import { QuickInput } from "./QuickInput";
import { since } from "./useStore";

type Props = { detail: OpenDetail; fallback: SessionView | null; store: WarRoomStore; now: number };

/** Vista previa de una sesión: qué le pediste, qué ha contestado y qué ha ido haciendo. */
export function DetailPanel({ detail, fallback, store, now }: Props) {
  const s = detail.data?.session ?? fallback;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && store.closeDetail();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  if (!s) return null;
  const onLink = (url: string) => store.openExternal(url);

  return (
    <aside className="detail" data-attention={s.attention} aria-label={`Vista previa: ${s.title ?? deskName(s)}`}>
      <header className="detail-head">
        <div className="detail-status">
          <span className="chip" data-attention={s.attention}>
            {ATTENTION_LABEL[s.attention]}
          </span>
          <span className="muted">{since(s.status_since, now)}</span>
          <span className="spacer" />
          <button className="icon" onClick={() => store.closeDetail()} aria-label="Cerrar vista previa" title="Cerrar (Esc)">
            <XIcon />
          </button>
        </div>
        <h2>{s.title ?? deskName(s)}</h2>
        <p className="detail-where">
          <span className="desk">{deskName(s)}</span>
          {s.branch && <span className="branch">{s.branch}</span>}
          {s.is_linked_worktree && <span className="tag">worktree</span>}
          <span className="muted">
            {[modelName(s), contextLabel(s) && `${contextLabel(s)} ctx`, `${s.turns} turnos`, whereItLives(s)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
        {extraActivity(s) && (
          <p className="detail-activity" data-attention={s.attention}>
            {extraActivity(s)}
          </p>
        )}
        <Actions s={s} store={store} />
      </header>

      <div className="detail-body">
        {s.can_approve && (
          <section className="approval-banner">
            <strong>{s.status_label}</strong>
            <div>
              <button className="primary danger" onClick={() => store.approve(s)}>
                <CheckIcon size={14} /> Aprobar
              </button>
              <button onClick={() => store.deny(s)}>Denegar</button>
            </div>
            <span className="muted">También puedes contestar en su terminal: vale la primera respuesta.</span>
          </section>
        )}

        {(s.first_prompt || s.command) && (
          <section>
            <h3>Encargo inicial</h3>
            {s.first_prompt && <Collapsible text={s.first_prompt} lines={6} plain />}
            {s.command && (
              <p className="command">
                <code>{s.command}</code>
                <CopyButton text={s.command} />
              </p>
            )}
          </section>
        )}

        {s.last_reply && (
          <section>
            <h3>Última respuesta</h3>
            <Markdown text={s.last_reply} onLink={onLink} />
          </section>
        )}

        {s.subagents.length > 0 && (
          <section>
            <h3>Subagentes</h3>
            <ul className="subagent-list">
              {s.subagents.map((a) => (
                <li key={a.id}>
                  <span className="who">{a.description ?? a.kind ?? "subagente"}</span>
                  {a.kind && a.description && <span className="tag">{a.kind}</span>}
                  {a.last_tool && <span className="muted">{a.last_tool}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>Conversación reciente</h3>
          {detail.data == null ? (
            <p className="muted">Cargando…</p>
          ) : detail.data.timeline.length === 0 ? (
            <p className="muted">Sin transcript todavía.</p>
          ) : (
            <Timeline items={detail.data.timeline} onLink={onLink} />
          )}
        </section>
      </div>

      {isWritable(s) && (
        <footer className="detail-foot">
          <QuickInput session={s} store={store} />
        </footer>
      )}
    </aside>
  );
}

function Actions({ s, store }: { s: SessionView; store: WarRoomStore }) {
  return (
    <div className="detail-actions">
      {s.alive && (
        <button className="primary" onClick={() => store.goTo(s)} title={`Ir a su ventana · ${whereItLives(s)}`}>
          <GoIcon size={14} /> Ir a la sesión
        </button>
      )}
      {s.pty_id && s.alive && (
        <button onClick={() => store.openTerminal(s.pty_id!, s.title ?? deskName(s))}>
          <TerminalIcon size={14} /> Terminal
        </button>
      )}
      {!s.alive && (
        <>
          <button className="primary" onClick={() => store.resume(s, "app")}>
            <PlayIcon size={13} /> Reanudar
          </button>
          <button onClick={() => store.resume(s, "warp")}>Reanudar en Warp</button>
        </>
      )}
      {s.attention === "finished" && (
        <button onClick={() => store.acknowledge(s)}>
          <CheckIcon size={14} /> Visto
        </button>
      )}
      <span className="spacer" />
      <button className="ghost" onClick={() => store.toggleMute(s)}>
        {s.muted ? "Reactivar avisos" : "Silenciar"}
      </button>
      <button className="ghost" onClick={() => store.toggleArchive(s)}>
        {s.archived ? "Readmitir" : "Despedir"}
      </button>
    </div>
  );
}

type Block =
  | { kind: "prompt" | "reply"; text: string; at: number | null }
  | { kind: "tools"; labels: string[]; at: number | null };

/** Agrupa herramientas seguidas para que la conversación se lea de un vistazo. */
function blocks(items: TimelineEntryView[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (item.kind === "tool") {
      if (last?.kind === "tools") last.labels.push(item.text);
      else out.push({ kind: "tools", labels: [item.text], at: item.at });
    } else {
      out.push({ kind: item.kind, text: item.text, at: item.at });
    }
  }
  return out;
}

function Timeline({ items, onLink }: { items: TimelineEntryView[]; onLink: (url: string) => void }) {
  return (
    <ol className="timeline">
      {blocks(items).map((b, i) => (
        <li key={i} className={`tl-${b.kind}`}>
          {b.kind === "prompt" && (
            <>
              <span className="tl-who">Tú{b.at && <time> · {clock(b.at)}</time>}</span>
              <Collapsible text={b.text} lines={8} plain />
            </>
          )}
          {b.kind === "reply" && (
            <>
              <span className="tl-who">Agente{b.at && <time> · {clock(b.at)}</time>}</span>
              <Collapsible text={b.text} lines={14} onLink={onLink} />
            </>
          )}
          {b.kind === "tools" && <ToolRun labels={b.labels} />}
        </li>
      ))}
    </ol>
  );
}

function ToolRun({ labels }: { labels: string[] }) {
  const [open, setOpen] = useState(false);
  if (labels.length === 1) return <span className="tl-tool">{labels[0]}</span>;
  return (
    <div className="tl-tools">
      <button className="linkish" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "▾" : "▸"} {labels.length} herramientas · {toolDigest(labels)}
      </button>
      {open && (
        <ul>
          {labels.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Texto largo plegado a unas líneas, con "ver todo". */
function Collapsible({ text, lines, plain, onLink }: { text: string; lines: number; plain?: boolean; onLink?: (url: string) => void }) {
  const long = text.split("\n").length > lines || text.length > lines * 90;
  const [open, setOpen] = useState(false);
  return (
    <div className="collapsible" data-open={open || !long} style={{ "--lines": lines } as React.CSSProperties}>
      {plain || !onLink ? <p className="plain">{text}</p> : <Markdown text={text} onLink={onLink} />}
      {long && (
        <button className="linkish" onClick={() => setOpen(!open)}>
          {open ? "Ver menos" : "Ver todo"}
        </button>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon"
      title="Copiar"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        })
      }
    >
      {done ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
