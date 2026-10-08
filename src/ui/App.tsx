import { lazy, Suspense, useCallback, useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import { agentName, deskName, money, tokenCount, type WarRoomView } from "../domain/attention";
import type { WarRoomState } from "../application/warRoomStore";
import { applyFilter, archivedCount, countBy, launchableAgents, mixesAgents } from "../domain/attention";
import { copy } from "../domain/copy";
import { AnswerReader } from "./AnswerReader";
import { AttentionQueue } from "./AttentionQueue";
import { DetailPanel } from "./DetailPanel";
import { DrinkingBird } from "./DrinkingBird";
import { FilterBar } from "./FilterBar";
import { GoIcon } from "./icons";
import { AgentsMenu, IntegrationBar } from "./IntegrationBar";
import { WarRoomScene } from "./pixel/WarRoomScene";
import { RoomPanel } from "./RoomPanel";
import { ShortcutHelp } from "./ShortcutHelp";
import { SettingsMenu } from "./SettingsMenu";
import { useShortcuts } from "./useShortcuts";
import { useNow, usePreference, useWarRoom } from "./useStore";

// xterm is heavy: load it only when a terminal is opened.
const TerminalPanel = lazy(() => import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })));

const VIEWS = ["classic", "pixel"] as const;

type Props = { store: WarRoomStore; language: string; onLanguageChange: (language: string) => Promise<void> };

export function App({ store, language, onLanguageChange }: Props) {
  const state = useWarRoom(store);
  const now = useNow();
  const [showArchived, setShowArchived] = useState(false);
  const [mode, setMode] = usePreference("awr.view", "classic", VIEWS);
  const fullView = state.view;
  // What is shown goes through the filter; the header counters always count the whole room.
  const view = fullView ? applyFilter(fullView, state.filter) : null;
  const mixed = fullView ? mixesAgents(fullView) : false;
  const detailFallback =
    state.detail && view ? (view.rooms.flatMap((r) => r.sessions).find((x) => x.id === state.detail!.id) ?? null) : null;
  const aggregate = fullView?.aggregate ?? "offline";
  const [help, setHelp] = useState(false);
  const toggleHelp = useCallback(() => setHelp((h) => !h), []);
  useShortcuts(store, { view, showArchived, onHelp: toggleHelp });
  const reader = fullView ? readerContent(state, fullView) : null;

  return (
    <div className="app" data-view={mode} data-terminal={state.terminal != null} data-detail={state.detail != null}>
      <header className="topbar">
        <div className="brand">
          <span className="lamp" data-attention={aggregate} />
          <h1>{copy.appName}</h1>
        </div>

        {fullView && (
          <div className="counters" aria-label={copy.topbar.summary}>
            {(["needs_you", "finished", "working"] as const).map((a) => (
              <span key={a} className="counter" data-attention={a} data-zero={countBy(fullView, a) === 0}>
                <b>{countBy(fullView, a)}</b> {copy.attention[a]}
              </span>
            ))}
          </div>
        )}

        <div className="topbar-tools">
          {fullView && fullView.today.total_tokens > 0 && (
            <span className="today" title={copy.topbar.todayTitle}>
              {copy.topbar.today(tokenCount(fullView.today.total_tokens), money(fullView.today.cost_usd))}
            </span>
          )}
          <button className="primary next" onClick={() => store.goNext()} title={copy.topbar.nextTitle}>
            <GoIcon size={14} /> {copy.topbar.next}
          </button>
          {view && countBy(view, "finished") > 0 && (
            <button className="ghost" onClick={() => store.acknowledgeAll()}>
              {copy.topbar.allSeen}
            </button>
          )}
          <div className="segmented" role="group" aria-label={copy.topbar.view}>
            <button aria-pressed={mode === "classic"} onClick={() => setMode("classic")}>
              {copy.topbar.classic}
            </button>
            <button aria-pressed={mode === "pixel"} onClick={() => setMode("pixel")}>
              {copy.topbar.warRoom}
            </button>
          </div>
          {view && (
            <label className="toggle">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              {copy.topbar.archived} <span className="muted">{archivedCount(view)}</span>
            </label>
          )}
          <DrinkingBird
            active={state.autoApprove ?? false}
            count={fullView?.auto_approved ?? 0}
            disabled={state.autoApprove == null || state.busy}
            onToggle={() => store.setAutoApprove(!state.autoApprove)}
          />
          <AgentsMenu integrations={state.integrations} busy={state.busy} store={store} autostart={state.autostart} />
          <SettingsMenu language={language} busy={state.busy} onLanguageChange={onLanguageChange} />
          <button className="icon help" onClick={toggleHelp} title={copy.shortcuts.button} aria-label={copy.shortcuts.button}>
            ?
          </button>
        </div>
      </header>

      <div className="content">
        {state.error && (
          <div className="error" role="alert">
            <span>{state.error}</span>
            <button className="ghost" onClick={() => store.dismissError()}>
              {copy.app.close}
            </button>
          </div>
        )}

        <IntegrationBar integrations={state.integrations} busy={state.busy} store={store} />

        {fullView && view && <FilterBar view={fullView} shown={view} filter={state.filter} store={store} />}

        {view && mode === "classic" && <AttentionQueue view={view} store={store} now={now} />}

        {view && mode === "pixel" && (
          <WarRoomScene
            view={view}
            store={store}
            showArchived={showArchived}
            selectedId={state.detail?.id ?? null}
            selectedAgent={state.detail?.agent?.id ?? null}
            onShowRepo={(repoId) => {
              store.showOnlyRepo(repoId);
              setMode("classic");
            }}
          />
        )}

        <main className="rooms" hidden={mode === "pixel"}>
          {view?.rooms
            .filter((room) => showArchived || room.sessions.some((s) => !s.archived))
            .map((room) => (
              <RoomPanel
                key={room.repo_id}
                room={room}
                store={store}
                now={now}
                showArchived={showArchived}
                agents={launchableAgents(state.integrations)}
                showProvider={mixed}
              />
            ))}
          {view && fullView && view.rooms.length === 0 && fullView.rooms.length > 0 && (
            <div className="empty">
              <p>{copy.app.noMatch}</p>
              <button className="ghost" onClick={() => store.clearFilter()}>
                {copy.app.clearFilters}
              </button>
            </div>
          )}
          {fullView && fullView.rooms.length === 0 && (
            <div className="empty">
              <p>{copy.app.emptyRoom}</p>
              <p className="muted">{copy.app.emptyRoomHint}</p>
            </div>
          )}
        </main>
      </div>

      {state.toast && (
        <div className="toast" data-tone={state.toast.tone} role="status">
          {state.toast.text}
        </div>
      )}

      {state.detail && <DetailPanel detail={state.detail} fallback={detailFallback} store={store} now={now} />}

      {reader && (
        <AnswerReader
          heading={reader.heading}
          title={reader.title}
          text={reader.text}
          onLink={(url) => store.openExternal(url)}
          onClose={() => store.closeReader()}
        />
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}

      {state.terminal && (
        <Suspense fallback={null}>
          <TerminalPanel key={state.terminal.id} terminal={state.terminal} store={store} />
        </Suspense>
      )}
    </div>
  );
}

/** What the open reader shows: a session's final answer, or its subagent's (once its preview loaded). */
function readerContent(state: WarRoomState, view: WarRoomView): { heading: string; title: string; text: string } | null {
  const open = state.reading;
  if (!open) return null;
  const s = view.rooms.flatMap((r) => r.sessions).find((x) => x.id === open.id);
  if (!s) return null;
  if (open.agent == null) return s.last_reply ? { heading: copy.detail.finalAnswer, title: s.title ?? deskName(s), text: s.last_reply } : null;
  const sub = state.detail?.id === open.id && state.detail.agent?.id === open.agent ? state.detail.agent.data : null;
  if (!sub?.last_reply) return null;
  const agent = sub.agent ?? s.subagents.find((a) => a.id === open.agent);
  return {
    heading: agent?.running ? copy.subagent.lastReply : copy.subagent.result,
    title: agent ? agentName(agent) : copy.subagent.title,
    text: sub.last_reply,
  };
}
