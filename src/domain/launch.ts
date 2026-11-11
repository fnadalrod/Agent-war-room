// What you can pick when starting a session, per agent. Values are the agents' own CLI names; the
// labels live in the catalogs.
import { roomHome, type WarRoomView } from "./attention";

/** Sent to the core with a launch; empty fields mean the agent's own defaults. */
export type LaunchOptions = { model?: string; effort?: string; permission_mode?: string; prompt?: string };

export type LaunchChoices = {
  /** Suggested models (any other name can be typed). */
  models: string[];
  /** Effort levels the agent accepts; empty: it has none. */
  efforts: string[];
  /** Permission modes; empty: it has none. */
  modes: string[];
};

const CHOICES: Record<string, LaunchChoices> = {
  claude: {
    models: ["fable", "opus", "sonnet", "haiku"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    modes: ["plan", "acceptEdits", "auto", "bypassPermissions"],
  },
  codex: { models: [], efforts: ["minimal", "low", "medium", "high", "xhigh"], modes: [] },
  cursor: { models: [], efforts: [], modes: [] },
};

/** The agent's choices, plus every model already seen in the room for that agent. */
export function launchChoices(provider: string, view: WarRoomView | null): LaunchChoices {
  const base = CHOICES[provider] ?? { models: [], efforts: [], modes: [] };
  const seen = (view?.rooms ?? [])
    .flatMap((r) => r.sessions)
    .filter((s) => s.provider === provider && s.model)
    .map((s) => s.model!);
  return { ...base, models: [...new Set([...base.models, ...seen])] };
}

/** Folders to start in: each repo's main worktree and every other folder a session ran in, A–Z. */
export function launchFolders(view: WarRoomView | null): string[] {
  const homes = (view?.rooms ?? []).flatMap((r) => [roomHome(r), ...r.sessions.map((s) => s.worktree_path)]);
  return [...new Set(homes.filter((h): h is string => !!h))].sort((a, b) => a.localeCompare(b));
}

/** A model or effort name the launcher accepts (it refuses anything else rather than quoting it). */
const PLAIN = /^[A-Za-z0-9._:\-[\]/=]+$/;

/** Resuming keeps the session's model and effort, so it goes on as it was. */
export function resumeOptions(s: { provider: string; model: string | null; effort: string | null }): LaunchOptions {
  const plain = (v: string | null) => (v && PLAIN.test(v) ? v : undefined);
  return cleanOptions(s.provider, { model: plain(s.model), effort: plain(s.effort) });
}

/** Only what was actually chosen, trimmed; options the agent does not have are dropped. */
export function cleanOptions(provider: string, options: LaunchOptions): LaunchOptions {
  const choices = CHOICES[provider] ?? { models: [], efforts: [], modes: [] };
  const value = (v: string | undefined) => v?.trim() || undefined;
  const out: LaunchOptions = {
    model: value(options.model),
    effort: choices.efforts.length ? value(options.effort) : undefined,
    permission_mode: choices.modes.length ? value(options.permission_mode) : undefined,
    prompt: value(options.prompt),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as LaunchOptions;
}
