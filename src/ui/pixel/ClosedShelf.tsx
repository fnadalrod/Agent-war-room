import type { WarRoomStore } from "../../application/warRoomStore";
import { closedSessions, deskName, modelAndEffort, providerName, type WarRoomView } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { ArchiveIcon, EyeIcon, PlayIcon } from "../icons";
import { since, useNow } from "../useStore";

type Props = { view: WarRoomView; store: WarRoomStore };

/**
 * The War Room's memory: every closed session that was not dismissed, by repo, most recent first,
 * ready to be resumed where it left off (with its model and effort).
 */
export function ClosedShelf({ view, store }: Props) {
  const now = useNow();
  const groups = closedSessions(view);
  if (groups.length === 0) return <p className="closed-empty">{copy.pixel.closedEmpty}</p>;
  return (
    <div className="closed-shelf" aria-label={copy.pixel.closedTitle}>
      {groups.map(({ room, sessions }) => (
        <section key={room.repo_id}>
          <h3>
            {room.repo_name} <span className="muted">{sessions.length}</span>
          </h3>
          <ul>
            {sessions.map((s) => (
              <li key={s.id} data-provider={s.provider}>
                <div className="closed-what">
                  <strong title={s.first_prompt ?? undefined}>{s.title ?? deskName(s)}</strong>
                  <span className="muted">
                    {[providerName(s.provider), s.branch, modelAndEffort(s.model, s.effort), copy.pixel.closedAt(since(s.status_since, now))]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="closed-actions">
                  <button className="primary" onClick={() => store.resume(s, "app")} title={copy.card.resumeInApp}>
                    <PlayIcon size={12} /> {copy.actions.resume}
                  </button>
                  <button onClick={() => store.resume(s, "warp")} title={copy.card.resumeInWarp}>
                    {copy.actions.inWarp}
                  </button>
                  <button className="icon" onClick={() => store.openDetail(s.id)} title={copy.actions.openPreview} aria-label={copy.actions.openPreview}>
                    <EyeIcon size={14} />
                  </button>
                  <button className="icon" onClick={() => store.toggleArchive(s)} title={copy.actions.archive} aria-label={copy.actions.archive}>
                    <ArchiveIcon size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
