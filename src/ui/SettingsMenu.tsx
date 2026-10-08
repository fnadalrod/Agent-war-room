import { useState } from "react";
import { copy } from "../domain/copy";
import { GearIcon } from "./icons";

type Props = {
  language: string;
  busy: boolean;
  onLanguageChange: (language: string) => Promise<void>;
};

/** App preferences. Changing language reloads once so every precomputed string changes together. */
export function SettingsMenu({ language, busy, onLanguageChange }: Props) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  return (
    <div className="settings-menu">
      <button
        className="icon"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={copy.settings.title}
        aria-label={copy.settings.title}
      >
        <GearIcon />
      </button>
      {open && (
        <div className="popover settings-popover" role="dialog" aria-label={copy.settings.title}>
          <strong>{copy.settings.title}</strong>
          <label>
            <span>{copy.settings.language}</span>
            <select
              value={language}
              disabled={busy || changing}
              onChange={(event) => {
                setChanging(true);
                void onLanguageChange(event.target.value).catch(() => setChanging(false));
              }}
            >
              <option value="en">{copy.settings.english}</option>
              <option value="es">{copy.settings.spanish}</option>
            </select>
          </label>
          <p className="muted small">{copy.settings.languageHint}</p>
        </div>
      )}
    </div>
  );
}
