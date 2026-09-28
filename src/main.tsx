// Entry point: picks the language first, because `copy` reads its strings when it loads; then loads
// the app. Inside Tauri the core decides (same language as notifications and the tray); in the
// browser demo it is `?lang=` or the browser's.
import { invoke } from "@tauri-apps/api/core";
import { setLanguage } from "./domain/i18n";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./ui/styles.css";

async function pickLanguage(): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) return invoke<string>("ui_language").catch(() => null);
  return new URLSearchParams(location.search).get("lang") ?? navigator.language;
}

void pickLanguage().then((locale) => {
  document.documentElement.lang = setLanguage(locale);
  return import("./bootstrap");
});
