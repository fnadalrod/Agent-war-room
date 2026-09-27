import type { WarRoomStore } from "../application/warRoomStore";
import type { IntegrationStatus } from "../domain/attention";

type Props = { status: IntegrationStatus | null; busy: boolean; store: WarRoomStore };

export function IntegrationBar({ status, busy, store }: Props) {
  if (!status) return null;

  if (status.installed && status.bridge_present) {
    return (
      <details className="integration ok">
        <summary>Conectada a Claude Code</summary>
        <p>
          Hooks en <code>{status.settings_path}</code> → <code>{status.bridge_path}</code>
        </p>
        <button disabled={busy} onClick={() => store.install()}>Reinstalar</button>
        <button disabled={busy} onClick={() => store.uninstall()}>Desconectar</button>
      </details>
    );
  }

  return (
    <div className="integration pending">
      <p>
        {status.hooked_events.length > 0
          ? "La integración con Claude Code está incompleta."
          : "Claude Code aún no avisa a la war room."}{" "}
        Se añadirán hooks a <code>{status.settings_path}</code> sin tocar los que ya tengas (se guarda una copia
        <code>.warroom-bak</code>). Solo las sesiones que arranquen después quedan conectadas.
      </p>
      <button disabled={busy} onClick={() => store.install()}>Conectar Claude Code</button>
    </div>
  );
}
