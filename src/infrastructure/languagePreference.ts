import { invoke } from "@tauri-apps/api/core";
import { supported } from "../domain/i18n";

const KEY = "awr.language";

function savedLanguage(): string | null {
  try {
    return supported(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function insideTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Resolves the language before translated modules load. English is the final fallback. */
export async function initialLanguage(): Promise<string> {
  if (!insideTauri()) {
    return supported(new URLSearchParams(location.search).get("lang")) ?? savedLanguage() ?? navigator.language;
  }
  const saved = savedLanguage();
  if (saved) return invoke<string>("set_ui_language", { language: saved }).catch(() => saved);
  return invoke<string>("ui_language").catch(() => "en");
}

/** Saves a choice, synchronises the Rust core, then reloads so all static copy changes together. */
export async function selectLanguage(locale: string): Promise<void> {
  const selected = supported(locale) ?? "en";
  if (insideTauri()) await invoke<string>("set_ui_language", { language: selected });
  localStorage.setItem(KEY, selected);
  if (insideTauri()) {
    location.reload();
  } else {
    const url = new URL(location.href);
    url.searchParams.set("lang", selected);
    location.assign(url);
  }
}
