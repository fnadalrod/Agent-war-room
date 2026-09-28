import type { WarRoomStore } from "../application/warRoomStore";
import {
  agentName,
  deskName,
  extraActivity,
  isWritable,
  modelAndEffort,
  stalledMinutes,
  plainText,
  providerName,
  usageLabel,
  whereItLives,
  type SessionView,
} from "../domain/attention";
import { copy } from "../domain/copy";
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
import { ContextBar } from "./ContextBar";
import { QuickInput } from "./QuickInput";
import { SkillTags } from "./SkillTag";
import { since } from "./useStore";

type Props = { session: SessionView; store: WarRoomStore; now: number; showProvider?: boolean };

/** A session card. Clicking the body opens the preview. */
export function SessionScreen({ session: s, store, now, showProvider = false }: Props) {
  const stalled = stalledMinutes(s, now);
  const excerpt = s.attention !== "working" && s.last_reply ? plainText(s.last_reply) : null;
  const label = s.title ?? deskName(s);

  return (
    <article
      className="card"
      data-attention={s.attention}
      data-muted={s.muted}
      data-archived={s.archived}
      data-stalled={stalled != null}
    >
      <button className="card-body" onClick={() => store.openDetail(s.id)} title={copy.actions.openPreview}>
        <div className="card-top">
          <span className="chip" data-attention={s.attention}>
            {copy.attention[s.attention]}
          </span>
          <span className="muted">{since(s.status_since, now)}</span>
          <span className="spacer" />
          {showProvider && (
            <span className="agent-tag" data-provider={s.provider} title={providerName(s.provider)}>
              {copy.providerShort[s.provider] ?? s.provider}
            </span>
          )}
          {stalled != null && (
            <span className="badge stalled" title={copy.stalled.title}>
              {copy.stalled.label(stalled)}
            </span>
          )}
          {s.subagents.some((a) => a.running) && (
            <span className="badge" title={copy.card.subagentsWorking}>
              <RobotIcon size={13} /> {s.subagents.filter((a) => a.running).length}
            </span>
          )}
          {s.muted && (
            <span className="badge" title={copy.card.muted}>
              <BellOffIcon size={13} />
            </span>
          )}
        </div>
        <h3 className="card-title">{label}</h3>
        <SkillTags skills={s.skills} store={store} />
        {extraActivity(s) && <p className="card-activity">{extraActivity(s)}</p>}
        {excerpt && <p className="card-excerpt">{excerpt}</p>}
        <ContextBar session={s} />
      </button>

      {s.subagents.length > 0 && <AgentStrip session={s} store={store} />}

      {s.can_approve && (
        <div className="card-approval">
          <button className="primary danger" onClick={() => store.approve(s)}>
            <CheckIcon size={14} /> {copy.actions.approve}
          </button>
          <button onClick={() => store.deny(s)}>{copy.actions.deny}</button>
        </div>
      )}

      {isWritable(s) && <QuickInput session={s} store={store} />}

      <footer className="card-foot">
        <div className="card-where">
          <BranchIcon size={13} />
          <span className="branch">{s.branch ?? copy.card.noBranch}</span>
          <span className="muted">· {deskName(s)}</span>
          {s.is_linked_worktree && <span className="tag">{copy.session.worktree}</span>}
        </div>
        <div className="card-meta">
          {[
            modelAndEffort(s.model, s.effort),
            s.usage.total_tokens > 0 && usageLabel(s.usage),
            whereItLives(s),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div className="card-actions">
          {s.alive ? (
            <button className="primary" onClick={() => store.goTo(s)} title={copy.actions.goToWindowVia(whereItLives(s))}>
              <GoIcon size={14} /> {copy.card.goTo}
            </button>
          ) : (
            <button className="primary" onClick={() => store.resume(s, "app")} title={copy.card.resumeInApp}>
              <PlayIcon size={13} /> {copy.actions.resume}
            </button>
          )}
          {!s.alive && (
            <button onClick={() => store.resume(s, "warp")} title={copy.card.resumeInWarp}>
              {copy.actions.inWarp}
            </button>
          )}
          <span className="spacer" />
          {s.attention === "finished" && (
            <button className="icon" onClick={() => store.acknowledge(s)} title={copy.actions.markSeen}>
              <CheckIcon />
            </button>
          )}
          {s.pty_id && s.alive && (
            <button className="icon" onClick={() => store.openTerminal(s.pty_id!, label)} title={copy.actions.openTerminal}>
              <TerminalIcon />
            </button>
          )}
          <button className="icon" onClick={() => store.toggleMute(s)} title={s.muted ? copy.actions.unmute : copy.actions.mute}>
            {s.muted ? <BellIcon /> : <BellOffIcon />}
          </button>
          <button
            className="icon"
            onClick={() => store.toggleArchive(s)}
            title={s.archived ? copy.actions.unarchive : copy.actions.archive}
          >
            {s.archived ? <RestoreIcon /> : <ArchiveIcon />}
          </button>
        </div>
      </footer>
    </article>
  );
}

const STRIP_MAX = 4;

/** The session's subagents, small and clickable: each opens its own preview. */
function AgentStrip({ session: s, store }: { session: SessionView; store: WarRoomStore }) {
  const shown = s.subagents.slice(0, STRIP_MAX);
  const rest = s.subagents.length - shown.length;
  return (
    <ul className="agent-strip" aria-label={copy.card.subagents}>
      {shown.map((a) => (
        <li key={a.id}>
          <button
            className="agent-chip"
            data-running={a.running}
            onClick={() => store.openSubagent(s.id, a.id)}
            title={`${agentName(a)}${a.kind ? ` (${a.kind})` : ""} · ${copy.session.subagentState(a.running)}${
              a.model ? ` · ${modelAndEffort(a.model, a.effort)}` : ""
            }`}
          >
            <RobotIcon size={12} />
            <span className="agent-name">{agentName(a)}</span>
            {a.running && a.last_tool && <span className="agent-doing">{a.last_tool}</span>}
          </button>
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button className="agent-chip more" onClick={() => store.openDetail(s.id)} title={copy.card.seeAllInPreview}>
            +{rest}
          </button>
        </li>
      )}
    </ul>
  );
}
