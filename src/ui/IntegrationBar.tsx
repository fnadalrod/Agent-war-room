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

type Health = "connected" | "incomplete" | "off" | "missing";

function health(status: IntegrationStatus): Health {
  if (isConnected(status)) return "connected";
  if (status.hooked_events.length > 0) return "incomplete";
  return status.agent_found ? "off" : "missing";
}

/** One header button for every agent: a dot each, and a menu to connect or disconnect them. */
export function AgentsMenu({ integrations, busy, store, autostart }: Props) {
  const [open, setOpen] = useState(false);
  if (integrations.length === 0) return null;
  const shown = integrations.filter((i) => i.agent_found || health(i) !== "missing");
  return (
    <div className="agents-menu">
      <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title={copy.topbar.agentsTitle}>
        <span className="agent-dots">
          {shown.map((i) => (
            <span key={i.provider} className="agent-dot" data-provider={i.provider} data-health={health(i)} />
          ))}
        </span>
        {copy.topbar.agents}
      </button>
      {open && (
        <div className="popover agents-popover" role="dialog" aria-label={copy.topbar.agentsTitle}>
          {integrations.map((status) => {
            const state = health(status);
            return (
              <div className="agents-row" key={status.provider} data-health={state}>
                <span className="agent-dot" data-provider={status.provider} data-health={state} />
                <div className="agents-info">
                  <strong>{providerName(status.provider)}</strong>
                  <span className="muted small">
                    {copy.integration.states[state]}
                    {state !== "missing" && (
                      <>
                        {" · "}
                        <code>{status.settings_path}</code>
                      </>
                    )}
                  </span>
                </div>
                {state === "connected" ? (
                  <span className="row">
                    <button disabled={busy} onClick={() => store.install(status.provider)}>
                      {copy.integration.reinstall}
                    </button>
                    <button disabled={busy} onClick={() => store.uninstall(status.provider)}>
                      {copy.integration.disconnect}
                    </button>
                  </span>
                ) : state !== "missing" ? (
                  <button className="primary" disabled={busy} onClick={() => store.install(status.provider)}>
                    {copy.integration.connect(providerName(status.provider))}
                  </button>
                ) : null}
              </div>
            );
          })}
          {integrations.some(isConnected) && (
            <p className="muted small">
              {copy.integration.bridge} <code>{integrations[0].bridge_path}</code>
            </p>
          )}
          {autostart != null && (
            <label className="toggle">
              <input type="checkbox" checked={autostart} disabled={busy} onChange={(e) => store.setAutostart(e.target.checked)} />
              {copy.integration.autostart}
            </label>
          )}
        </div>
      )}
    </div>
  );
}
