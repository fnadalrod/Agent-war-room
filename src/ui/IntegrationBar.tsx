import { useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import { isConnected, providerName, type IntegrationStatus } from "../domain/attention";
import { copy } from "../domain/copy";

type Props = { integrations: IntegrationStatus[]; busy: boolean; store: WarRoomStore; autostart?: boolean | null };

/** The ones worth a banner: installed on this machine but not connected (Claude if none is found). */
function pending(integrations: IntegrationStatus[]): IntegrationStatus[] {
  const found = integrations.filter((i) => i.agent_found);
  const candidates = found.length ? found : integrations.filter((i) => i.provider === "claude");
  return candidates.filter((i) => !isConnected(i));
}

/** Big banner per agent, only while it is not connected yet. */
export function IntegrationBar({ integrations, busy, store }: Props) {
  return (
    <>
      {pending(integrations).map((status) => {
        const agent = providerName(status.provider);
        return (
          <div className="banner" key={status.provider}>
            <div>
              <strong>
                {status.hooked_events.length > 0
                  ? copy.integration.incomplete(agent)
                  : copy.integration.notConnected(agent)}
              </strong>
              <p>
                {copy.integration.installNote.beforePath} <code>{status.settings_path}</code>{" "}
                {copy.integration.installNote.beforeBackup} <code>.warroom-bak</code>
                {copy.integration.installNote.end}
                {copy.integration.notes[status.provider] && <> {copy.integration.notes[status.provider]}</>}
              </p>
            </div>
            <button className="primary" disabled={busy} onClick={() => store.install(status.provider)}>
              {copy.integration.connect(agent)}
            </button>
          </div>
        );
      })}
    </>
  );
}

/** Discreet header indicator per connected agent. The login toggle lives in the first one. */
export function IntegrationBadges({ integrations, busy, store, autostart }: Props) {
  const connected = integrations.filter(isConnected);
  return (
    <>
      {connected.map((status, i) => (
        <IntegrationBadge
          key={status.provider}
          status={status}
          busy={busy}
          store={store}
          autostart={i === 0 ? autostart : null}
        />
      ))}
    </>
  );
}

type BadgeProps = { status: IntegrationStatus; busy: boolean; store: WarRoomStore; autostart?: boolean | null };

function IntegrationBadge({ status, busy, store, autostart }: BadgeProps) {
  const [open, setOpen] = useState(false);
  const agent = providerName(status.provider);
  return (
    <div className="integration-badge">
      <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title={copy.integration.title(agent)}>
        <span className="dot" data-attention="working" /> {agent}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={copy.integration.title(agent)}>
          <p>
            {copy.integration.hooksIn} <code>{status.settings_path}</code>
          </p>
          <p>
            {copy.integration.bridge} <code>{status.bridge_path}</code>
          </p>
          {autostart != null && (
            <label className="toggle">
              <input type="checkbox" checked={autostart} disabled={busy} onChange={(e) => store.setAutostart(e.target.checked)} />
              {copy.integration.autostart}
            </label>
          )}
          <div className="row">
            <button disabled={busy} onClick={() => store.install(status.provider)}>
              {copy.integration.reinstall}
            </button>
            <button disabled={busy} onClick={() => store.uninstall(status.provider)}>
              {copy.integration.disconnect}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
