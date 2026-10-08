//! Translations. Every user-visible string lives in `locales/<lang>.json` (shared with the front);
//! code only names keys. Rust keys are namespaced by who shows them: `core.*` (application),
//! `desktop.*` (infrastructure), `shell.*` (Tauri), `bridge.*` (hook bridge); `ui.*` is the front's.
//!
//! Placeholders are `{name}`; plurals are two keys, `<key>_one` and `<key>_other`. The language starts
//! from the environment (`AWR_LANG`, then `LC_ALL`, `LC_MESSAGES`, `LANG`), can be changed at runtime,
//! and falls back to English, key by key.

use std::collections::HashMap;
use std::fmt::Display;
use std::sync::{OnceLock, RwLock};

/// Languages with a catalog. English is the reference: every other catalog has exactly its keys.
pub const LANGUAGES: &[(&str, &str)] =
    &[("en", include_str!("../../../locales/en.json")), ("es", include_str!("../../../locales/es.json"))];
const FALLBACK: &str = "en";

type Catalog = HashMap<String, String>;

fn catalogs() -> &'static HashMap<&'static str, Catalog> {
    static CATALOGS: OnceLock<HashMap<&'static str, Catalog>> = OnceLock::new();
    CATALOGS.get_or_init(|| LANGUAGES.iter().map(|(code, json)| (*code, parse(json))).collect())
}

/// Flattens nested objects into dotted keys: `{"a":{"b":"x"}}` → `a.b = x`.
pub fn parse(json: &str) -> Catalog {
    fn walk(prefix: &str, value: &serde_json::Value, out: &mut Catalog) {
        match value {
            serde_json::Value::Object(map) => {
                for (k, v) in map {
                    let key = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
                    walk(&key, v, out);
                }
            }
            serde_json::Value::String(s) => {
                out.insert(prefix.to_string(), s.clone());
            }
            _ => {}
        }
    }
    let value: serde_json::Value = serde_json::from_str(json).expect("locale catalogs are valid JSON");
    let mut out = Catalog::new();
    walk("", &value, &mut out);
    out
}

/// The supported language for a locale string such as `es_ES.UTF-8` or `en-US`.
pub fn supported(locale: &str) -> Option<&'static str> {
    let code = locale.split(['_', '-', '.', '@']).next()?.to_ascii_lowercase();
    LANGUAGES.iter().map(|(c, _)| *c).find(|c| *c == code)
}

fn detected_language() -> &'static str {
    ["AWR_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|var| std::env::var(var).ok())
        .find(|v| !v.is_empty())
        .and_then(|v| supported(&v))
        .unwrap_or(FALLBACK)
}

fn selected_language() -> &'static RwLock<&'static str> {
    static LANGUAGE: OnceLock<RwLock<&'static str>> = OnceLock::new();
    LANGUAGE.get_or_init(|| RwLock::new(detected_language()))
}

/// The language in use, initially resolved from the environment.
pub fn language() -> &'static str {
    *selected_language().read().unwrap()
}

/// Selects a supported language at runtime. Unsupported values fall back to English.
pub fn set_language(locale: &str) -> &'static str {
    let language = supported(locale).unwrap_or(FALLBACK);
    *selected_language().write().unwrap() = language;
    language
}

fn lookup(lang: &str, key: &str) -> Option<&'static str> {
    catalogs().get(lang)?.get(key).map(String::as_str)
}

/// The text for `key`; falls back to English, then to the key itself (tests keep that from shipping).
pub fn t(key: &str) -> &'static str {
    lookup(language(), key).or_else(|| lookup(FALLBACK, key)).unwrap_or_else(|| Box::leak(key.into()))
}

/// The text for `key` with its `{name}` placeholders filled in.
pub fn tf(key: &str, args: &[(&str, &dyn Display)]) -> String {
    fill(t(key), args)
}

/// `<key>_one` or `<key>_other` depending on `n`, with `{n}` and the other placeholders filled in.
pub fn tn(key: &str, n: i64, args: &[(&str, &dyn Display)]) -> String {
    let form = if n == 1 { "one" } else { "other" };
    let mut all: Vec<(&str, &dyn Display)> = vec![("n", &n)];
    all.extend_from_slice(args);
    fill(t(&format!("{key}_{form}")), &all)
}

fn fill(template: &str, args: &[(&str, &dyn Display)]) -> String {
    let mut out = template.to_string();
    for (name, value) in args {
        out = out.replace(&format!("{{{name}}}"), &value.to_string());
    }
    out
}

/// Placeholder names in a template, sorted: `"{a} of {b}"` → `["a", "b"]`.
pub fn placeholders(template: &str) -> Vec<String> {
    let mut names: Vec<String> = template
        .split('{')
        .skip(1)
        .filter_map(|rest| rest.split_once('}').map(|(name, _)| name.to_string()))
        .filter(|name| !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .collect();
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn resolves_locale_strings() {
        assert_eq!(supported("es_ES.UTF-8"), Some("es"));
        assert_eq!(supported("en-US"), Some("en"));
        assert_eq!(supported("fr_FR.UTF-8"), None);
        assert_eq!(supported("C"), None);
    }

    #[test]
    fn a_runtime_selection_uses_english_for_unknown_languages() {
        let previous = language();
        assert_eq!(set_language("es-ES"), "es");
        assert_eq!(set_language("fr-FR"), "en");
        set_language(previous);
    }

    #[test]
    fn fills_placeholders_and_plurals() {
        assert_eq!(fill("{a} of {b}", &[("a", &1), ("b", &"x")]), "1 of x");
        assert_eq!(placeholders("{n} files · +{add} −{del} {n}"), ["add", "del", "n"]);
        let en = parse(LANGUAGES[0].1);
        assert_eq!(en["ui.detail.files_one"], "{n} file");
    }

    #[test]
    fn every_catalog_has_the_same_keys_and_placeholders_as_english() {
        let en = parse(LANGUAGES[0].1);
        for (code, json) in &LANGUAGES[1..] {
            let other = parse(json);
            let missing: Vec<_> = en.keys().filter(|k| !other.contains_key(*k)).collect();
            let extra: Vec<_> = other.keys().filter(|k| !en.contains_key(*k)).collect();
            assert!(missing.is_empty() && extra.is_empty(), "{code}: missing {missing:?}, extra {extra:?}");
            for (key, text) in &en {
                assert_eq!(placeholders(text), placeholders(&other[key]), "{code}: placeholders of {key}");
            }
        }
    }

    fn sources(dir: &Path, exts: &[&str], out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = entry.file_name();
            if path.is_dir() {
                if !matches!(name.to_str(), Some("target" | "node_modules" | "generated" | "dist" | "gen")) {
                    sources(&path, exts, out);
                }
            } else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| exts.contains(&e)) {
                out.push(path);
            }
        }
    }

    /// Every key the code names (`t("…")`, `tf("…"`, `tn("…"` in Rust and the front) exists in English,
    /// and every English key is used somewhere: no dead or missing strings.
    #[test]
    fn keys_used_in_code_exist_and_every_key_is_used() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let en = parse(LANGUAGES[0].1);
        let mut files = Vec::new();
        for dir in ["crates", "src-tauri/src", "src"] {
            sources(&root.join(dir), &["rs", "ts", "tsx"], &mut files);
        }
        let mut used = std::collections::HashSet::new();
        let mut missing = Vec::new();
        for file in &files {
            let text = std::fs::read_to_string(file).unwrap();
            for call in ["t(\"", "tf(\"", "tn(\""] {
                for (i, _) in text.match_indices(call) {
                    let before = text[..i].chars().last();
                    if before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
                        continue; // `format(` and friends
                    }
                    let rest = &text[i + call.len()..];
                    let Some(end) = rest.find('"') else { continue };
                    let key = &rest[..end];
                    if key.is_empty()
                        || !key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
                    {
                        continue; // not a key (prose in a doc comment, say)
                    }
                    // The front names `ui.*` keys without the namespace.
                    let key =
                        if file.extension().is_some_and(|e| e != "rs") { format!("ui.{key}") } else { key.into() };
                    let keys =
                        if call == "tn(\"" { vec![format!("{key}_one"), format!("{key}_other")] } else { vec![key] };
                    for key in keys {
                        if !en.contains_key(&key) {
                            missing.push(format!("{}: {key}", file.display()));
                        }
                        used.insert(key);
                    }
                }
            }
        }
        assert!(missing.is_empty(), "keys missing from locales/en.json: {missing:#?}");
        let mut unused: Vec<_> = en.keys().filter(|k| !used.contains(*k)).collect();
        unused.sort();
        assert!(unused.is_empty(), "keys in locales/en.json that no code uses: {unused:#?}");
    }
}
