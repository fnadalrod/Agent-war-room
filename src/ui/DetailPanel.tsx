import { useEffect, useState } from "react";
import type { OpenDetail, WarRoomStore } from "../application/warRoomStore";
import {
  agentName,
  contextLabel,
  deskName,
  extraActivity,
  isWritable,
  modelAndEffort,
  toolDigest,
  whereItLives,
  type SessionView,
  type SubagentPreview,
  type SubagentView,
  type TimelineEntryView,
} from "../domain/attention";
import { copy } from "../domain/copy";
import { CheckIcon, CopyIcon, GoIcon, PlayIcon, RobotIcon, TerminalIcon, XIcon } from "./icons";
import { Markdown } from "./Markdown";
import { QuickInput } from "./QuickInput";
import { SkillTag } from "./SkillTag";
import { since } from "./useStore";

type Props = { detail: OpenDetail; fallback: SessionView | null; store: WarRoomStore; now: number };

/** Session preview: what you asked, what it answered and what it has been doing. */
export function DetailPanel({ detail, fallback, store, now }: Props) {
  const s = detail.data?.session ?? fallback;

  const inAgent = detail.agent != null;
  useEffect(() => {
    // Esc: from a subagent, back to the session; from the session, close.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (inAgent ? store.backToSession() : store.closeDetail());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, inAgent]);

  if (!s) return null;
  const onLink = (url: string) => store.openExternal(url);

  if (detail.agent) {
    const agent = detail.agent.data?.agent ?? s.subagents.find((a) => a.id === detail.agent!.id) ?? null;
    return <SubagentPanel session={s} agent={agent} preview={detail.agent.data} store={store} now={now} onLink={onLink} />;
  }

  return (
    <aside className="detail" data-attention={s.attention} aria-label={copy.detail.label(s.title ?? deskName(s))}>
      <header className="detail-head">
        <div className="detail-status">
          <span className="chip" data-attention={s.attention}>
            {copy.attention[s.attention]}
          </span>
          <span className="muted">{since(s.status_since, now)}</span>
          <span className="spacer" />
          <button className="icon" onClick={() => store.closeDetail()} aria-label={copy.detail.close} title={copy.detail.closeEsc}>
            <XIcon />
          </button>
        </div>
        <h2>{s.title ?? deskName(s)}</h2>
        <p className="detail-where">
          <span className="desk">{deskName(s)}</span>
          {s.branch && <span className="branch">{s.branch}</span>}
          {s.is_linked_worktree && <span className="tag">{copy.session.worktree}</span>}
          <span className="muted">
            {[modelAndEffort(s.model, s.effort), contextLabel(s) && copy.session.context(contextLabel(s)!), copy.session.turns(s.turns), whereItLives(s)]
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
                <CheckIcon size={14} /> {copy.actions.approve}
              </button>
              <button onClick={() => store.deny(s)}>{copy.actions.deny}</button>
            </div>
            <span className="muted">{copy.detail.answerInTerminal}</span>
          </section>
        )}

        {(s.first_prompt || s.command) && (
          <section>
            <h3>{copy.detail.initialTask}</h3>
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
            <h3>{copy.detail.lastReply}</h3>
            <Markdown text={s.last_reply} onLink={onLink} />
          </section>
        )}

        {s.skills.length > 0 && (
          <section>
            <h3>{copy.detail.skills}</h3>
            <ul className="skill-list">
              {s.skills.map((k) => (
                <li key={k.name}>
                  <SkillTag skill={k} store={store} />
                  <span className="muted">
                    {copy.skillSource[k.source]} · {copy.skill.launchedBy(k.by_user, k.by_agent)}
                    {k.count > 1 && ` · ${copy.skill.times(k.count)}`} · {since(k.last_at, now)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {s.subagents.length > 0 && (
          <section>
            <h3>{copy.detail.subagents}</h3>
            <ul className="subagent-list">
              {s.subagents.map((a) => (
                <li key={a.id}>
                  <button className="agent-row" data-running={a.running} onClick={() => store.openSubagent(s.id, a.id)}>
                    <span className="dot" data-attention={a.running ? "working" : "offline"} />
                    <span className="who">{agentName(a)}</span>
                    {a.kind && a.description && <span className="tag">{a.kind}</span>}
                    {a.model && <span className="tag">{modelAndEffort(a.model, a.effort)}</span>}
                    <span className="muted agent-doing">{a.running ? (a.last_tool ?? copy.session.subagentState(true)) : copy.session.subagentState(false)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>{copy.detail.recentConversation}</h3>
          {detail.data == null ? (
            <p className="muted">{copy.detail.loading}</p>
          ) : detail.data.timeline.length === 0 ? (
            <p className="muted">{copy.detail.noTranscript}</p>
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

type SubagentProps = {
  session: SessionView;
  agent: SubagentView | null;
  preview: SubagentPreview | null;
  store: WarRoomStore;
  now: number;
  onLink: (url: string) => void;
};

/** Subagent preview, inside its session panel. */
function SubagentPanel({ session: s, agent, preview, store, now, onLink }: SubagentProps) {
  const state = agent?.running ? "working" : "offline";
  return (
    <aside className="detail" data-attention={state} aria-label={copy.subagent.label(agent ? agentName(agent) : "")}>
      <header className="detail-head">
        <div className="detail-status">
          <button className="ghost back" onClick={() => store.backToSession()} title={copy.subagent.back}>
            ← {s.title ?? deskName(s)}
          </button>
          <span className="spacer" />
          <button className="icon" onClick={() => store.closeDetail()} aria-label={copy.detail.close} title={copy.detail.closeShort}>
            <XIcon />
          </button>
        </div>
        <h2>
          <RobotIcon size={18} /> {agent ? agentName(agent) : copy.subagent.title}
        </h2>
        <p className="detail-where">
          <span className="chip" data-attention={state}>
            {agent?.running ? copy.subagent.working : copy.subagent.finished}
          </span>
          {agent?.kind && <span className="tag">{agent.kind}</span>}
          {agent?.model && <span className="tag">{modelAndEffort(agent.model, agent.effort)}</span>}
          {agent && (
            <span className="muted">
              {agent.running
                ? copy.subagent.since(since(agent.started_at, now))
                : copy.subagent.finishedAgo(since(agent.finished_at ?? agent.started_at, now))}
            </span>
          )}
        </p>
        {agent?.running && agent.last_tool && (
          <p className="detail-activity" data-attention="working">
            {agent.last_tool}
          </p>
        )}
      </header>

      <div className="detail-body">
        {preview == null ? (
          <p className="muted">{copy.detail.loading}</p>
        ) : (
          <>
            {preview.first_prompt && (
              <section>
                <h3>{copy.subagent.task}</h3>
                <Collapsible text={preview.first_prompt} lines={8} plain />
              </section>
            )}
            {preview.last_reply && (
              <section>
                <h3>{agent?.running ? copy.subagent.lastReply : copy.subagent.result}</h3>
                <Markdown text={preview.last_reply} onLink={onLink} />
              </section>
            )}
            <section>
              <h3>{copy.subagent.activity}</h3>
              {preview.timeline.length === 0 ? (
                <p className="muted">{copy.detail.noTranscript}</p>
              ) : (
                <Timeline items={preview.timeline} onLink={onLink} who={{ prompt: copy.subagent.mainAgent, reply: copy.subagent.title }} />
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function Actions({ s, store }: { s: SessionView; store: WarRoomStore }) {
  return (
    <div className="detail-actions">
      {s.alive && (
        <button className="primary" onClick={() => store.goTo(s)} title={copy.actions.goToWindowVia(whereItLives(s))}>
          <GoIcon size={14} /> {copy.detail.goToSession}
        </button>
      )}
      {s.pty_id && s.alive && (
        <button onClick={() => store.openTerminal(s.pty_id!, s.title ?? deskName(s))}>
          <TerminalIcon size={14} /> {copy.detail.terminal}
        </button>
      )}
      {!s.alive && (
        <>
          <button className="primary" onClick={() => store.resume(s, "app")}>
            <PlayIcon size={13} /> {copy.actions.resume}
          </button>
          <button onClick={() => store.resume(s, "warp")}>{copy.detail.resumeInWarp}</button>
        </>
      )}
      {s.attention === "finished" && (
        <button onClick={() => store.acknowledge(s)}>
          <CheckIcon size={14} /> {copy.detail.seen}
        </button>
      )}
      <span className="spacer" />
      <button className="ghost" onClick={() => store.toggleMute(s)}>
        {s.muted ? copy.detail.unmute : copy.detail.mute}
      </button>
      <button className="ghost" onClick={() => store.toggleArchive(s)}>
        {s.archived ? copy.detail.unarchive : copy.detail.archive}
      </button>
    </div>
  );
}

/** `setting`: model and effort, only where they change from the agent's previous entry. */
type Block =
  | { kind: "prompt" | "reply"; text: string; at: number | null; setting: string | null }
  | { kind: "tools"; labels: string[]; at: number | null; setting: string | null };

/**
 * Groups consecutive tools so the conversation reads at a glance, and notes model and effort where
 * they change (e.g. after /model or /effort).
 */
export function blocks(items: TimelineEntryView[]): Block[] {
  const out: Block[] = [];
  let current: string | null = null;
  for (const item of items) {
    let setting: string | null = null;
    if (item.kind !== "prompt" && (item.model || item.effort)) {
      const now = modelAndEffort(item.model, item.effort);
      if (now !== current) setting = now;
      current = now;
    }
    const last = out[out.length - 1];
    if (item.kind === "tool") {
      if (last?.kind === "tools" && !setting) last.labels.push(item.text);
      else out.push({ kind: "tools", labels: [item.text], at: item.at, setting });
    } else {
      out.push({ kind: item.kind, text: item.text, at: item.at, setting });
    }
  }
  return out;
}

type Who = { prompt: string; reply: string };

function Timeline({
  items,
  onLink,
  who = { prompt: copy.detail.you, reply: copy.detail.agent },
}: {
  items: TimelineEntryView[];
  onLink: (url: string) => void;
  who?: Who;
}) {
  return (
    <ol className="timeline">
      {blocks(items).map((b, i) => (
        <li key={i} className={`tl-${b.kind}`}>
          {b.setting && <span className="tl-setting">{b.setting}</span>}
          {b.kind === "prompt" && (
            <>
              <span className="tl-who">
                {who.prompt}
                {b.at && <time> · {clock(b.at)}</time>}
              </span>
              <Collapsible text={b.text} lines={8} plain />
            </>
          )}
          {b.kind === "reply" && (
            <>
              <span className="tl-who">
                {who.reply}
                {b.at && <time> · {clock(b.at)}</time>}
              </span>
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
        {open ? "▾" : "▸"} {copy.detail.tools(labels.length, toolDigest(labels))}
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

/** Long text folded to a few lines, with a "show all" toggle. */
function Collapsible({ text, lines, plain, onLink }: { text: string; lines: number; plain?: boolean; onLink?: (url: string) => void }) {
  const long = text.split("\n").length > lines || text.length > lines * 90;
  const [open, setOpen] = useState(false);
  return (
    <div className="collapsible" data-open={open || !long} style={{ "--lines": lines } as React.CSSProperties}>
      {plain || !onLink ? <p className="plain">{text}</p> : <Markdown text={text} onLink={onLink} />}
      {long && (
        <button className="linkish" onClick={() => setOpen(!open)}>
          {open ? copy.detail.showLess : copy.detail.showAll}
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
      title={copy.detail.copy}
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
