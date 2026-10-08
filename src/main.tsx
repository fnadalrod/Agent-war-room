// Entry point: picks the language first, because `copy` reads its strings when it loads; then loads
// the app. The saved choice is also sent to the Rust core before React starts.
import { setLanguage } from "./domain/i18n";
import { initialLanguage } from "./infrastructure/languagePreference";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./ui/styles.css";

void initialLanguage().then((locale) => {
  document.documentElement.lang = setLanguage(locale);
  return import("./bootstrap");
});
