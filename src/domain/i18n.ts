/**
 * Translations for the front. The text lives in `locales/<lang>.json` (shared with the Rust core,
 * which uses the other namespaces); the front reads the `ui` namespace and names keys relative to it.
 *
 * Placeholders are `{name}`; plurals are two keys, `<key>_one` and `<key>_other`. Set the language
 * before anything reads `copy` (main.tsx does it before loading the app); missing keys fall back to
 * English.
 */
import en from "../../locales/en.json";
import es from "../../locales/es.json";

type Ui = (typeof en)["ui"];
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every `ui.*` key, relative to `ui`: `"detail.close"`. */
export type Key = Leaves<Ui>;
/** Keys with plural forms, without the suffix: `"detail.files"` for `files_one`/`files_other`. */
type PluralBase<K> = K extends `${infer Base}_one` ? Base : never;
export type PluralKey = PluralBase<Key>;
type Vars = Record<string, string | number>;

const catalogs: Record<string, unknown> = { en: en.ui, es: es.ui };
const statuses: Record<string, Record<string, string>> = { en: en.core.status, es: es.core.status };
export const LANGUAGES = Object.keys(catalogs);
let current = "en";

/** `es_ES`, `es-419`, `en-US`… → a supported language, or null. */
export function supported(locale: string | null | undefined): string | null {
  const code = locale?.split(/[-_.@]/)[0]?.toLowerCase();
  return code && code in catalogs ? code : null;
}

export function setLanguage(locale: string | null | undefined): string {
  current = supported(locale) ?? "en";
  return current;
}

export function language(): string {
  return current;
}

function lookup(lang: string, key: string): string | undefined {
  let node: unknown = catalogs[lang];
  for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === "string" ? node : undefined;
}

function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The text for `key`, with its placeholders filled in. */
export function t(key: Key, vars: Vars = {}): string {
  return fill(lookup(current, key) ?? lookup("en", key) ?? key, vars);
}

/** The singular or plural form of `key` for `n`; `{n}` is filled in too. */
export function tn(key: PluralKey, n: number, vars: Vars = {}): string {
  return t(`${key}_${n === 1 ? "one" : "other"}` as Key, { n, ...vars });
}

/** A session status label as the core words it (`core.status.*`), for adapters that fake the core. */
export function coreStatus(key: keyof (typeof en)["core"]["status"]): string {
  return statuses[current]?.[key] ?? en.core.status[key];
}
