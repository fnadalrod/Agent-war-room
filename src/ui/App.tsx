import { lazy, Suspense, useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import { ATTENTION_LABEL, archivedCount, countBy } from "../domain/attention";
import { IntegrationBar } from "./IntegrationBar";
import { RoomPanel } from "./RoomPanel";

// xterm pesa: solo se carga al abrir un terminal.
const TerminalPanel = lazy(() => import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
import { useNow, useWarRoom } from "./useStore";

export function App({ store }: { store: WarRoomStore }) {
  const state = useWarRoom(store);
  const now = useNow();
  const [showArchived, setShowArchived] = useState(false);
  const view = state.view;

  return (
    <div className="app" data-aggregate={view?.aggregate ?? "offline"} data-terminal={state.terminal != null}>
      <header className="topbar">
        <div className="brand">
          <span className="lamp" data-attention={view?.aggregate ?? "offline"} />
          <h1>Agent War Room</h1>
        </div>
        {view && (
          <div className="counters">
            {(["needs_you", "finished", "working"] as const).map((a) => (
              <span key={a} className="counter" data-attention={a}>
                <b>{countBy(view, a)}</b> {ATTENTION_LABEL[a]}
              </span>
            ))}
            {countBy(view, "finished") > 0 && (
              <button onClick={() => store.acknowledgeAll()}>Todo visto</button>
            )}
            <label className="toggle">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Archivadas ({archivedCount(view)})
            </label>
          </div>
        )}
      </header>

      {state.error && (
        <div className="error" role="alert">
          {state.error}
          <button onClick={() => store.dismissError()}>Cerrar</button>
        </div>
      )}

      {state.toast && (
        <div className="toast" data-tone={state.toast.tone} role="status">
          {state.toast.text}
        </div>
      )}

      <IntegrationBar status={state.integration} busy={state.busy} store={store} />

      <main className="rooms">
        {view?.rooms
          .filter((room) => showArchived || room.sessions.some((s) => !s.archived))
          .map((room) => (
            <RoomPanel key={room.repo_id} room={room} store={store} now={now} showArchived={showArchived} />
          ))}
        {view && view.rooms.length === 0 && (
          <p className="empty">
            Sala vacía. Cuando un agente arranque o haga algo, aparecerá aquí su pantalla.
          </p>
        )}
      </main>

      {state.terminal && (
        <Suspense fallback={null}>
          <TerminalPanel key={state.terminal.id} terminal={state.terminal} store={store} />
        </Suspense>
      )}
    </div>
  );
}
