import { useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import type { IntegrationStatus } from "../domain/attention";

type Props = { status: IntegrationStatus | null; busy: boolean; store: WarRoomStore; autostart?: boolean | null };

export function isConnected(status: IntegrationStatus | null): boolean {
  return status != null && status.installed && status.bridge_present;
}

/** Aviso grande solo mientras falta conectar Claude Code. */
export function IntegrationBar({ status, busy, store }: Props) {
  if (!status || isConnected(status)) return null;
  return (
    <div className="banner">
      <div>
        <strong>
          {status.hooked_events.length > 0
            ? "La integración con Claude Code está incompleta"
            : "Claude Code aún no avisa a la war room"}
        </strong>
        <p>
          Se añadirán hooks a <code>{status.settings_path}</code> sin tocar los que ya tengas (queda una copia{" "}
          <code>.warroom-bak</code>). Solo las sesiones que arranquen después quedan conectadas.
        </p>
      </div>
      <button className="primary" disabled={busy} onClick={() => store.install()}>
        Conectar Claude Code
      </button>
    </div>
  );
}

/** Indicador discreto en la cabecera una vez conectada. */
export function IntegrationBadge({ status, busy, store, autostart }: Props) {
  const [open, setOpen] = useState(false);
  if (!isConnected(status)) return null;
  return (
    <div className="integration-badge">
      <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title="Integración con Claude Code">
        <span className="dot" data-attention="working" /> Claude Code
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Integración con Claude Code">
          <p>
            Hooks en <code>{status!.settings_path}</code>
          </p>
          <p>
            Puente: <code>{status!.bridge_path}</code>
          </p>
          {autostart != null && (
            <label className="toggle">
              <input type="checkbox" checked={autostart} disabled={busy} onChange={(e) => store.setAutostart(e.target.checked)} />
              Abrir al iniciar sesión (en la bandeja)
            </label>
          )}
          <div className="row">
            <button disabled={busy} onClick={() => store.install()}>
              Reinstalar
            </button>
            <button disabled={busy} onClick={() => store.uninstall()}>
              Desconectar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
