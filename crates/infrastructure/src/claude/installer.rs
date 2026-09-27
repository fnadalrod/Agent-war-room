use awr_application::ports::{IntegrationInstaller, PortError, PortResult};
use awr_application::view::IntegrationStatus;
use serde_json::{Map, Value, json};
use std::fs;
use std::path::{Path, PathBuf};

/// Hooks de Claude que alimentan la máquina de estados.
pub const HOOKED_EVENTS: &[&str] = &[
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Notification",
    "Stop",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
];

/// Identifica nuestras entradas en `settings.json`, sin tocar las de nadie más.
const MARKER: &str = "warroom-hook";
const HOOK_TIMEOUT_SECS: u64 = 5;

/// Merge no destructivo de nuestros hooks en `~/.claude/settings.json`.
pub struct ClaudeHookInstaller {
    settings_path: PathBuf,
    /// Binario recién compilado o empaquetado; se copia a `bridge_target` al instalar.
    bridge_source: Option<PathBuf>,
    /// Ruta estable a la que apuntan los hooks.
    bridge_target: PathBuf,
}

impl ClaudeHookInstaller {
    pub fn new(settings_path: PathBuf, bridge_source: Option<PathBuf>, bridge_target: PathBuf) -> Self {
        Self { settings_path, bridge_source, bridge_target }
    }

    fn command(&self) -> String {
        format!("\"{}\"", self.bridge_target.display())
    }

    fn read_settings(&self) -> PortResult<Map<String, Value>> {
        match fs::read_to_string(&self.settings_path) {
            Ok(raw) if raw.trim().is_empty() => Ok(Map::new()),
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(Value::Object(map)) => Ok(map),
                Ok(_) => Err(fail("settings.json no es un objeto JSON")),
                Err(e) => Err(fail(format!("settings.json no es JSON válido: {e}"))),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
            Err(e) => Err(fail(e)),
        }
    }

    fn write_settings(&self, settings: &Map<String, Value>) -> PortResult<()> {
        if self.settings_path.exists() {
            fs::copy(&self.settings_path, backup_path(&self.settings_path)).map_err(fail)?;
        } else if let Some(dir) = self.settings_path.parent() {
            fs::create_dir_all(dir).map_err(fail)?;
        }
        let mut body = serde_json::to_string_pretty(settings).map_err(fail)?;
        body.push('\n');
        let tmp = self.settings_path.with_extension("json.warroom-tmp");
        fs::write(&tmp, body).map_err(fail)?;
        fs::rename(&tmp, &self.settings_path).map_err(fail)
    }

    fn copy_bridge(&self) -> PortResult<()> {
        let Some(source) = self.bridge_source.as_ref().filter(|s| s.exists()) else {
            return if self.bridge_target.exists() {
                Ok(())
            } else {
                Err(fail("no se encuentra el binario warroom-hook; compílalo con `cargo build -p warroom-hook`"))
            };
        };
        if let Some(dir) = self.bridge_target.parent() {
            fs::create_dir_all(dir).map_err(fail)?;
        }
        // Copia a temporal + rename: sobrescribir el binario mientras un hook lo ejecuta daría ETXTBSY.
        let tmp = self.bridge_target.with_extension("new");
        fs::copy(source, &tmp).map_err(fail)?;
        set_executable(&tmp)?;
        fs::rename(&tmp, &self.bridge_target).map_err(fail)
    }
}

impl IntegrationInstaller for ClaudeHookInstaller {
    fn status(&self) -> PortResult<IntegrationStatus> {
        let settings = self.read_settings()?;
        let hooked_events: Vec<String> = HOOKED_EVENTS
            .iter()
            .filter(|event| event_has_ours(&settings, event))
            .map(|e| e.to_string())
            .collect();
        Ok(IntegrationStatus {
            installed: hooked_events.len() == HOOKED_EVENTS.len(),
            hooked_events,
            settings_path: self.settings_path.display().to_string(),
            bridge_path: self.bridge_target.display().to_string(),
            bridge_present: self.bridge_target.exists(),
        })
    }

    fn install(&self) -> PortResult<IntegrationStatus> {
        self.copy_bridge()?;
        let mut settings = self.read_settings()?;
        let command = self.command();
        add_hooks(&mut settings, &command);
        self.write_settings(&settings)?;
        self.status()
    }

    fn uninstall(&self) -> PortResult<IntegrationStatus> {
        let mut settings = self.read_settings()?;
        if remove_hooks(&mut settings) {
            self.write_settings(&settings)?;
        }
        self.status()
    }
}

fn add_hooks(settings: &mut Map<String, Value>, command: &str) {
    // Reinstalar reemplaza nuestras entradas (p. ej. si cambió la ruta del puente).
    remove_hooks(settings);
    let hooks = settings
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks.is_object() {
        *hooks = Value::Object(Map::new());
    }
    let hooks = hooks.as_object_mut().expect("recién asegurado como objeto");
    for event in HOOKED_EVENTS {
        let groups = hooks.entry(*event).or_insert_with(|| Value::Array(Vec::new()));
        if let Some(groups) = groups.as_array_mut() {
            groups.push(json!({
                "matcher": "",
                "hooks": [{ "type": "command", "command": command, "timeout": HOOK_TIMEOUT_SECS }]
            }));
        }
    }
}

/// Quita nuestras entradas y lo que quede vacío por ello. Devuelve si cambió algo.
fn remove_hooks(settings: &mut Map<String, Value>) -> bool {
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else {
        return false;
    };
    let mut changed = false;
    for groups in hooks.values_mut() {
        let Some(groups) = groups.as_array_mut() else { continue };
        for group in groups.iter_mut() {
            if let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                let before = list.len();
                list.retain(|h| !is_ours(h));
                changed |= list.len() != before;
            }
        }
        let before = groups.len();
        groups.retain(|g| g.get("hooks").and_then(Value::as_array).is_none_or(|l| !l.is_empty()));
        changed |= groups.len() != before;
    }
    hooks.retain(|_, groups| groups.as_array().is_none_or(|g| !g.is_empty()));
    if hooks.is_empty() {
        settings.remove("hooks");
    }
    changed
}

fn event_has_ours(settings: &Map<String, Value>, event: &str) -> bool {
    settings
        .get("hooks")
        .and_then(|h| h.get(event))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|g| g.get("hooks").and_then(Value::as_array))
        .flatten()
        .any(is_ours)
}

fn is_ours(hook: &Value) -> bool {
    hook.get("command").and_then(Value::as_str).is_some_and(|c| c.contains(MARKER))
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.warroom-bak")
}

fn set_executable(path: &Path) -> PortResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(fail)
}

fn fail(e: impl ToString) -> PortError {
    PortError::Failed(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(initial: Option<Value>) -> (tempfile::TempDir, ClaudeHookInstaller) {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        if let Some(v) = initial {
            fs::write(&settings, serde_json::to_string_pretty(&v).unwrap()).unwrap();
        }
        let source = dir.path().join("build/warroom-hook");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "#!/bin/sh\n").unwrap();
        let target = dir.path().join("bin/warroom-hook");
        let installer = ClaudeHookInstaller::new(settings, Some(source), target);
        (dir, installer)
    }

    fn read(installer: &ClaudeHookInstaller) -> Value {
        serde_json::from_str(&fs::read_to_string(&installer.settings_path).unwrap()).unwrap()
    }

    fn foreign() -> Value {
        json!({
            "model": "opus",
            "hooks": {
                "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node other.js" }] }]
            }
        })
    }

    #[test]
    fn install_keeps_foreign_hooks_and_is_idempotent() {
        let (_dir, installer) = setup(Some(foreign()));
        installer.install().unwrap();
        let status = installer.install().unwrap();
        assert!(status.installed);
        assert!(status.bridge_present);

        let settings = read(&installer);
        assert_eq!(settings["model"], "opus");
        let stop = settings["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "el ajeno + el nuestro, sin duplicar");
        assert_eq!(stop[0]["hooks"][0]["command"], "node other.js");
        assert!(backup_path(&installer.settings_path).exists());
    }

    #[test]
    fn uninstall_restores_the_original_shape() {
        let (_dir, installer) = setup(Some(foreign()));
        installer.install().unwrap();
        let status = installer.uninstall().unwrap();
        assert!(!status.installed);
        assert!(status.hooked_events.is_empty());
        assert_eq!(read(&installer), foreign());
    }

    #[test]
    fn works_without_a_settings_file_and_cleans_up_fully() {
        let (_dir, installer) = setup(None);
        installer.install().unwrap();
        installer.uninstall().unwrap();
        assert_eq!(read(&installer), json!({}));
    }

    #[test]
    fn refuses_to_touch_invalid_json() {
        let (_dir, installer) = setup(None);
        fs::write(&installer.settings_path, "{ not json").unwrap();
        assert!(installer.install().is_err());
        assert_eq!(fs::read_to_string(&installer.settings_path).unwrap(), "{ not json");
    }
}
