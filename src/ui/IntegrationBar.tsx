import { useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import type { IntegrationStatus } from "../domain/attention";
import { copy } from "../domain/copy";

type Props = { status: IntegrationStatus | null; busy: boolean; store: WarRoomStore; autostart?: boolean | null };

export function isConnected(status: IntegrationStatus | null): boolean {
  return status != null && status.installed && status.bridge_present;
}

/** Big banner, only while Claude Code is not connected yet. */
export function IntegrationBar({ status, busy, store }: Props) {
  if (!status || isConnected(status)) return null;
  return (
    <div className="banner">
      <div>
        <strong>
          {status.hooked_events.length > 0
            ? copy.integration.incomplete
            : copy.integration.notConnected}
        </strong>
        <p>
          {copy.integration.installNote.beforePath} <code>{status.settings_path}</code>{" "}
          {copy.integration.installNote.beforeBackup} <code>.warroom-bak</code>
          {copy.integration.installNote.end}
        </p>
      </div>
      <button className="primary" disabled={busy} onClick={() => store.install()}>
        {copy.integration.connect}
      </button>
    </div>
  );
}

/** Discreet header indicator once connected. */
export function IntegrationBadge({ status, busy, store, autostart }: Props) {
  const [open, setOpen] = useState(false);
  if (!isConnected(status)) return null;
  return (
    <div className="integration-badge">
      <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title={copy.integration.title}>
        <span className="dot" data-attention="working" /> {copy.integration.badge}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={copy.integration.title}>
          <p>
            {copy.integration.hooksIn} <code>{status!.settings_path}</code>
          </p>
          <p>
            {copy.integration.bridge} <code>{status!.bridge_path}</code>
          </p>
          {autostart != null && (
            <label className="toggle">
              <input type="checkbox" checked={autostart} disabled={busy} onChange={(e) => store.setAutostart(e.target.checked)} />
              {copy.integration.autostart}
            </label>
          )}
          <div className="row">
            <button disabled={busy} onClick={() => store.install()}>
              {copy.integration.reinstall}
            </button>
            <button disabled={busy} onClick={() => store.uninstall()}>
              {copy.integration.disconnect}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
