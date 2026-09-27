//! Cómo resumir en una línea lo que hace o pide una herramienta de Claude.

use serde_json::Value;
use std::path::Path;

const ARG_MAX_CHARS: usize = 60;

/// Argumento principal de una llamada a herramienta: el comando, el fichero, el patrón…
pub fn tool_argument(input: Option<&Value>) -> Option<String> {
    const KEYS: &[&str] = &[
        "description", "file_path", "notebook_path", "path", "pattern", "command", "url", "query", "skill", "prompt",
    ];
    let input = input?;
    let (key, value) = KEYS.iter().find_map(|k| Some((*k, input.get(*k)?.as_str()?)))?;
    Some(if key.ends_with("path") {
        Path::new(value)
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_else(|| value.to_owned())
    } else {
        clip(value, ARG_MAX_CHARS)
    })
}

/// "Bash · cargo test", "Read · view.rs", "Agent · Revisar el login"…
pub fn tool_label(name: &str, input: Option<&Value>) -> String {
    match tool_argument(input) {
        Some(arg) => format!("{name} · {arg}"),
        None => name.to_owned(),
    }
}

/// Aplana espacios y recorta por caracteres (no bytes) con elipsis.
pub fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        flat
    } else {
        format!("{}…", flat.chars().take(max - 1).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prefers_the_description_then_paths_as_file_names() {
        assert_eq!(tool_label("Bash", Some(&json!({ "command": "ls -la", "description": "Listar" }))), "Bash · Listar");
        assert_eq!(tool_label("Edit", Some(&json!({ "file_path": "/a/b/c.rs" }))), "Edit · c.rs");
        assert_eq!(tool_label("TodoWrite", Some(&json!({ "todos": [] }))), "TodoWrite");
    }
}
