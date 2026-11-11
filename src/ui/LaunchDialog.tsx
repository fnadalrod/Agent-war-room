import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LaunchTarget } from "../application/ports";
import type { WarRoomStore } from "../application/warRoomStore";
import { providerName, type WarRoomView } from "../domain/attention";
import { copy } from "../domain/copy";
import { cleanOptions, launchChoices, launchFolders, type LaunchOptions } from "../domain/launch";
import { PlayIcon, XIcon } from "./icons";

type Props = {
  store: WarRoomStore;
  view: WarRoomView | null;
  /** Agents that can be started (`claude`, `codex`…). */
  agents: string[];
  /** Folder it opened on, if any. */
  cwd: string | null;
};

/** The last choices, per agent, so the next session starts the way the previous one did. */
type Remembered = { provider: string; target: LaunchTarget; options: Record<string, LaunchOptions> };
const KEY = "awr.launch";

function recall(): Remembered | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as Remembered | null;
  } catch {
    return null;
  }
}

function remember(value: Remembered) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Without storage it just starts from the defaults next time.
  }
}

const label = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Start an agent in any repository or folder, choosing its model, effort, permissions and first prompt. */
export function LaunchDialog({ store, view, agents, cwd }: Props) {
  const saved = useMemo(recall, []);
  const folders = useMemo(() => launchFolders(view), [view]);
  const [folder, setFolder] = useState(cwd ?? folders[0] ?? "");
  const [provider, setProvider] = useState(saved && agents.includes(saved.provider) ? saved.provider : agents[0]);
  const [target, setTarget] = useState<LaunchTarget>(saved?.target ?? "app");
  const [options, setOptions] = useState<LaunchOptions>({ ...saved?.options[provider], prompt: "" });
  const choices = launchChoices(provider, view);
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Folder given: straight to the prompt. Otherwise, pick the folder first.
    (cwd ? prompt.current : first.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      store.closeLauncher();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cwd, store]);

  const pickAgent = (next: string) => {
    setProvider(next);
    setOptions((o) => ({ ...saved?.options[next], prompt: o.prompt }));
  };
  const set = (key: keyof LaunchOptions) => (e: { target: { value: string } }) => setOptions((o) => ({ ...o, [key]: e.target.value }));

  const start = () => {
    const path = folder.trim();
    if (!path) return;
    const chosen = cleanOptions(provider, options);
    const { prompt: _, ...kept } = chosen;
    remember({ provider, target, options: { ...saved?.options, [provider]: kept } });
    store.launch(provider, path, label(path), target, chosen);
    store.closeLauncher();
  };

  return createPortal(
    <div className="reader-backdrop" onMouseDown={(e) => e.target === e.currentTarget && store.closeLauncher()}>
      <form
        className="launch-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={copy.launch.title}
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <header>
          <strong>{copy.launch.title}</strong>
          <button type="button" className="icon" onClick={() => store.closeLauncher()} aria-label={copy.launch.cancel}>
            <XIcon size={16} />
          </button>
        </header>

        <label>
          <span>{copy.launch.folder}</span>
          <input
            ref={first}
            list={`${id}-folders`}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={copy.launch.folderPlaceholder}
            spellCheck={false}
          />
          <datalist id={`${id}-folders`}>
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>

        <div className="launch-grid">
          {agents.length > 1 && (
            <label>
              <span>{copy.launch.agent}</span>
              <select value={provider} onChange={(e) => pickAgent(e.target.value)}>
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {providerName(a)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>{copy.launch.model}</span>
            <input list={`${id}-models`} value={options.model ?? ""} onChange={set("model")} placeholder={copy.launch.modelDefault} spellCheck={false} />
            <datalist id={`${id}-models`}>
              {choices.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {choices.efforts.length > 0 && (
            <label>
              <span>{copy.launch.effort}</span>
              <select value={options.effort ?? ""} onChange={set("effort")}>
                <option value="">{copy.launch.effortDefault}</option>
                {choices.efforts.map((e) => (
                  <option key={e} value={e}>
                    {copy.effort[e] ?? e}
                  </option>
                ))}
              </select>
            </label>
          )}
          {choices.modes.length > 0 && (
            <label>
              <span>{copy.launch.mode}</span>
              <select value={options.permission_mode ?? ""} onChange={set("permission_mode")}>
                <option value="">{copy.launch.modeDefault}</option>
                {choices.modes.map((m) => (
                  <option key={m} value={m}>
                    {copy.launch.modes[m] ?? m}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>{copy.launch.where}</span>
            <select value={target} onChange={(e) => setTarget(e.target.value as LaunchTarget)}>
              <option value="app">{copy.launch.inApp}</option>
              <option value="warp">{copy.launch.inWarp}</option>
            </select>
          </label>
        </div>

        <label>
          <span>{copy.launch.prompt}</span>
          <textarea
            ref={prompt}
            rows={4}
            value={options.prompt ?? ""}
            onChange={set("prompt")}
            placeholder={copy.launch.promptPlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                start();
              }
            }}
          />
        </label>

        <footer>
          <button type="button" className="ghost" onClick={() => store.closeLauncher()}>
            {copy.launch.cancel}
          </button>
          <button type="submit" className="primary" disabled={!folder.trim()}>
            <PlayIcon size={13} /> {copy.launch.start}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
