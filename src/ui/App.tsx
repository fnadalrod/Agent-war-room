import { lazy, Suspense, useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import { applyFilter, ATTENTION_LABEL, archivedCount, countBy } from "../domain/attention";
import { AttentionQueue } from "./AttentionQueue";
import { DetailPanel } from "./DetailPanel";
import { FilterBar } from "./FilterBar";
import { IntegrationBadge, IntegrationBar } from "./IntegrationBar";
import { WarRoomScene } from "./pixel/WarRoomScene";
import { RoomPanel } from "./RoomPanel";
import { useNow, usePreference, useWarRoom } from "./useStore";

// xterm pesa: solo se carga al abrir un terminal.
const TerminalPanel = lazy(() => import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })));

const VIEWS = ["classic", "pixel"] as const;

export function App({ store }: { store: WarRoomStore }) {
  const state = useWarRoom(store);
  const now = useNow();
  const [showArchived, setShowArchived] = useState(false);
  const [mode, setMode] = usePreference("awr.view", "classic", VIEWS);
  const fullView = state.view;
  // Lo que se ve pasa por el filtro; la cabecera y la bandeja cuentan siempre la sala entera.
  const view = fullView ? applyFilter(fullView, state.filter) : null;
  const detailFallback =
    state.detail && view ? (view.rooms.flatMap((r) => r.sessions).find((x) => x.id === state.detail!.id) ?? null) : null;
  const aggregate = fullView?.aggregate ?? "offline";

  return (
    <div className="app" data-terminal={state.terminal != null} data-detail={state.detail != null}>
      <header className="topbar">
        <div className="brand">
          <span className="lamp" data-attention={aggregate} />
          <h1>Agent War Room</h1>
        </div>

        {fullView && (
          <div className="counters" aria-label="Resumen">
            {(["needs_you", "finished", "working"] as const).map((a) => (
              <span key={a} className="counter" data-attention={a} data-zero={countBy(fullView, a) === 0}>
                <b>{countBy(fullView, a)}</b> {ATTENTION_LABEL[a]}
              </span>
            ))}
          </div>
        )}

        <div className="topbar-tools">
          {view && countBy(view, "finished") > 0 && (
            <button className="ghost" onClick={() => store.acknowledgeAll()}>
              Todo visto
            </button>
          )}
          <div className="segmented" role="group" aria-label="Vista">
            <button aria-pressed={mode === "classic"} onClick={() => setMode("classic")}>
              Clásica
            </button>
            <button aria-pressed={mode === "pixel"} onClick={() => setMode("pixel")}>
              War Room
            </button>
          </div>
          {view && (
            <label className="toggle">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Archivadas <span className="muted">{archivedCount(view)}</span>
            </label>
          )}
          <IntegrationBadge status={state.integration} busy={state.busy} store={store} autostart={state.autostart} />
        </div>
      </header>

      <div className="content">
        {state.error && (
          <div className="error" role="alert">
            <span>{state.error}</span>
            <button className="ghost" onClick={() => store.dismissError()}>
              Cerrar
            </button>
          </div>
        )}

        <IntegrationBar status={state.integration} busy={state.busy} store={store} />

        {fullView && view && <FilterBar view={fullView} shown={view} filter={state.filter} store={store} />}

        {view && mode === "classic" && <AttentionQueue view={view} store={store} now={now} />}

        {view && mode === "pixel" && (
          <WarRoomScene
            view={view}
            store={store}
            showArchived={showArchived}
            selectedId={state.detail?.id ?? null}
            selectedAgent={state.detail?.agent?.id ?? null}
          />
        )}

        <main className="rooms" hidden={mode === "pixel"}>
          {view?.rooms
            .filter((room) => showArchived || room.sessions.some((s) => !s.archived))
            .map((room) => (
              <RoomPanel key={room.repo_id} room={room} store={store} now={now} showArchived={showArchived} />
            ))}
          {view && fullView && view.rooms.length === 0 && fullView.rooms.length > 0 && (
            <div className="empty">
              <p>Nada coincide con el filtro.</p>
              <button className="ghost" onClick={() => store.clearFilter()}>
                Quitar filtros
              </button>
            </div>
          )}
          {fullView && fullView.rooms.length === 0 && (
            <div className="empty">
              <p>Sala vacía.</p>
              <p className="muted">Cuando un agente arranque o haga algo, aparecerá aquí su tarjeta.</p>
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

      {state.terminal && (
        <Suspense fallback={null}>
          <TerminalPanel key={state.terminal.id} terminal={state.terminal} store={store} />
        </Suspense>
      )}
    </div>
  );
}
