import type { OpenDetail, WarRoomStore } from "../application/warRoomStore";
import { copy } from "../domain/copy";
import { XIcon } from "./icons";
import { since } from "./useStore";

type Props = { detail: OpenDetail; store: WarRoomStore; now: number };

/** "What did it change": only loaded when asked for (it runs git and scans every transcript). */
export function ChangesSection({ detail, store, now }: Props) {
  const changes = detail.changes;
  return (
    <section>
      <h3>{copy.detail.changes}</h3>
      {changes == null ? (
        <>
          <p className="muted small">{copy.detail.changesHint}</p>
          <button className="load-changes" onClick={() => store.loadChanges()}>
            {copy.detail.showChanges}
          </button>
        </>
      ) : changes.data == null ? (
        <p className="muted">{copy.detail.loading}</p>
      ) : (
        <div className="changes">
          <h4>{copy.detail.commits(changes.data.commits.length)}</h4>
          {changes.data.commits.length === 0 ? (
            <p className="muted small">{copy.detail.noCommits}</p>
          ) : (
            <ul className="commit-list">
              {changes.data.commits.map((c) => (
                <li key={c.hash}>
                  <button className="commit" onClick={() => store.openDiff(c.hash, c.short)} title={c.hash}>
                    <code>{c.short}</code>
                    <span className="commit-subject">{c.subject}</span>
                    <span className="muted">{since(c.at, now)}</span>
                    <span className="commit-stats">
                      {copy.detail.commitStats(c.files_changed, c.insertions, c.deletions)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h4>{copy.detail.files(changes.data.files.length)}</h4>
          {changes.data.files.length === 0 ? (
            <p className="muted small">{copy.detail.noFiles}</p>
          ) : (
            <ul className="file-list">
              {changes.data.files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code>
                  <span className="muted">{copy.detail.edits(f.edits)}</span>
                  {f.written && <span className="tag">{copy.detail.written}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** A commit's `git show`, over the preview. */
export function DiffView({ detail, store }: { detail: OpenDetail; store: WarRoomStore }) {
  const diff = detail.diff;
  if (!diff) return null;
  return (
    <div className="diff-overlay" role="dialog" aria-label={copy.detail.diffTitle(diff.short)}>
      <header>
        <strong>{copy.detail.diffTitle(diff.short)}</strong>
        <span className="spacer" />
        <button className="icon" onClick={() => store.closeDiff()} aria-label={copy.detail.closeShort}>
          <XIcon />
        </button>
      </header>
      {diff.text == null ? (
        <p className="muted pad">{copy.detail.loading}</p>
      ) : (
        <pre className="diff">
          {diff.text.split("\n").map((line, i) => (
            <span key={i} data-line={lineKind(line)}>
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

function lineKind(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git")) return "file";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}
