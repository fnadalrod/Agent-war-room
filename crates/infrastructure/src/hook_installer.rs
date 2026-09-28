//! Non-destructive install of our bridge into an agent's hook configuration. Every agent keeps hooks
//! in a JSON file; they differ in its [`HookLayout`] and in which events exist ([`HookSpec`]).

use crate::locale;
use awr_application::ports::{IntegrationInstaller, PortError, PortResult};
use awr_application::view::IntegrationStatus;
use awr_domain::ProviderKind;
use serde_json::{Map, Value, json};
use std::fs;
use std::path::{Path, PathBuf};

/// How an agent's hook file is laid out.
pub enum HookLayout {
    /// `{"hooks": {"Event": [{"matcher": "", "hooks": [{type, command, timeout}]}]}}`: Claude Code, Codex.
    Grouped,
    /// `{"version": 1, "hooks": {"event": [{command, timeout}]}}`: Cursor.
    Flat,
    /// `{"<name>": {"Event": [...]}}`, one named block per tool: Antigravity. Tool events are grouped
    /// with a matcher, the rest flat; its payloads don't name the event, so it goes as an argument.
    Named(&'static str),
}

/// Which hook events an agent gets, with their timeout in seconds, and how its file looks.
pub struct HookSpec {
    pub provider: ProviderKind,
    pub layout: HookLayout,
    pub events: &'static [(&'static str, u64)],
    /// The app can start (and resume) this agent in a terminal.
    pub launchable: bool,
}

impl HookSpec {
    pub fn event_names(&self) -> impl Iterator<Item = &'static str> {
        self.events.iter().map(|(name, _)| *name)
    }
}

/// Regular hooks: the bridge answers in milliseconds, even with the app closed.
pub const HOOK_TIMEOUT_SECS: u64 = 5;
/// `PermissionRequest` waits for the user's decision from the app; the agent shows its own dialog at
/// the same time and, if answered there, kills the hook. The bridge gives up after 590 s.
pub const PERMISSION_TIMEOUT_SECS: u64 = 600;

/// Identifies our entries in `settings.json`, without touching anyone else's.
const MARKER: &str = "warroom-hook";

/// Non-destructive merge of our hooks into an agent's hook file.
pub struct HookInstaller {
    spec: &'static HookSpec,
    settings_path: PathBuf,
    /// Freshly built or bundled binary; copied to `bridge_target` on install.
    bridge_source: Option<PathBuf>,
    /// Stable path the hooks point to.
    bridge_target: PathBuf,
}

impl HookInstaller {
    pub fn new(
        spec: &'static HookSpec,
        settings_path: PathBuf,
        bridge_source: Option<PathBuf>,
        bridge_target: PathBuf,
    ) -> Self {
        Self { spec, settings_path, bridge_source, bridge_target }
    }

    fn command(&self) -> String {
        format!("\"{}\"", self.bridge_target.display())
    }

    fn read_settings(&self) -> PortResult<Map<String, Value>> {
        match fs::read_to_string(&self.settings_path) {
            Ok(raw) if raw.trim().is_empty() => Ok(Map::new()),
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(Value::Object(map)) => Ok(map),
                Ok(_) => Err(fail(locale::settings_not_an_object())),
                Err(e) => Err(fail(locale::settings_invalid_json(e))),
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
            return if self.bridge_target.exists() { Ok(()) } else { Err(fail(locale::bridge_not_found())) };
        };
        if !is_executable_binary(source) {
            return Err(fail(locale::invalid_bridge(source.display())));
        }
        if let Some(dir) = self.bridge_target.parent() {
            fs::create_dir_all(dir).map_err(fail)?;
        }
        // Copy to a temp file + rename: overwriting the binary while a hook runs it would fail with ETXTBSY.
        let tmp = self.bridge_target.with_extension("new");
        fs::copy(source, &tmp).map_err(fail)?;
        set_executable(&tmp)?;
        fs::rename(&tmp, &self.bridge_target).map_err(fail)
    }
}

impl IntegrationInstaller for HookInstaller {
    fn status(&self) -> PortResult<IntegrationStatus> {
        let settings = self.read_settings()?;
        let hooked_events: Vec<String> =
            self.spec.event_names().filter(|event| event_has_ours(&settings, self.spec, event)).map(str::to_owned).collect();
        Ok(IntegrationStatus {
            provider: format!("{:?}", self.spec.provider).to_lowercase(),
            agent_found: self.settings_path.parent().is_some_and(Path::is_dir),
            installed: hooked_events.len() == self.spec.events.len(),
            launchable: self.spec.launchable,
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
        add_hooks(&mut settings, self.spec, &command);
        self.write_settings(&settings)?;
        self.status()
    }

    fn uninstall(&self) -> PortResult<IntegrationStatus> {
        let mut settings = self.read_settings()?;
        if remove_hooks(&mut settings, self.spec) {
            self.write_settings(&settings)?;
        }
        self.status()
    }
}

fn add_hooks(settings: &mut Map<String, Value>, spec: &HookSpec, command: &str) {
    // Reinstalling replaces our entries (e.g. if the bridge path changed).
    remove_hooks(settings, spec);
    let entry = |timeout: u64, command: &str| json!({ "type": "command", "command": command, "timeout": timeout });
    match spec.layout {
        HookLayout::Named(name) => {
            let block: Map<String, Value> = spec
                .events
                .iter()
                .map(|(event, timeout)| {
                    let hook = entry(*timeout, &format!("{command} {event}"));
                    let list = if event.ends_with("ToolUse") { json!([{ "matcher": "", "hooks": [hook] }]) } else { json!([hook]) };
                    (event.to_string(), list)
                })
                .collect();
            settings.insert(name.into(), Value::Object(block));
        }
        HookLayout::Grouped | HookLayout::Flat => {
            if matches!(spec.layout, HookLayout::Flat) {
                settings.entry("version").or_insert(json!(1));
            }
            let hooks = settings.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
            if !hooks.is_object() {
                *hooks = Value::Object(Map::new());
            }
            let hooks = hooks.as_object_mut().expect("just ensured to be an object");
            for (event, timeout) in spec.events {
                let list = hooks.entry(*event).or_insert_with(|| Value::Array(Vec::new()));
                if let Some(list) = list.as_array_mut() {
                    list.push(match spec.layout {
                        HookLayout::Flat => entry(*timeout, command),
                        _ => json!({ "matcher": "", "hooks": [entry(*timeout, command)] }),
                    });
                }
            }
        }
    }
}

/// Removes our entries and whatever is left empty because of it. Returns whether anything changed.
fn remove_hooks(settings: &mut Map<String, Value>, spec: &HookSpec) -> bool {
    if let HookLayout::Named(name) = spec.layout {
        return settings.remove(name).is_some();
    }
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else {
        return false;
    };
    let mut changed = false;
    for list in hooks.values_mut() {
        let Some(list) = list.as_array_mut() else { continue };
        for group in list.iter_mut() {
            if let Some(inner) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                let before = inner.len();
                inner.retain(|h| !is_ours(h));
                changed |= inner.len() != before;
            }
        }
        let before = list.len();
        // Flat entries of ours, and groups left empty.
        list.retain(|g| !is_ours(g) && g.get("hooks").and_then(Value::as_array).is_none_or(|l| !l.is_empty()));
        changed |= list.len() != before;
    }
    hooks.retain(|_, list| list.as_array().is_none_or(|g| !g.is_empty()));
    if hooks.is_empty() {
        settings.remove("hooks");
        // A Cursor file with nothing but its version says nothing.
        if settings.len() == 1 && settings.get("version") == Some(&json!(1)) {
            settings.remove("version");
        }
    }
    changed
}

fn event_has_ours(settings: &Map<String, Value>, spec: &HookSpec, event: &str) -> bool {
    let list = match spec.layout {
        HookLayout::Named(name) => settings.get(name).and_then(|b| b.get(event)),
        _ => settings.get("hooks").and_then(|h| h.get(event)),
    };
    list.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|g| match g.get("hooks").and_then(Value::as_array) {
            Some(inner) => inner.iter().collect::<Vec<_>>(),
            None => vec![g],
        })
        .any(is_ours)
}

fn is_ours(hook: &Value) -> bool {
    hook.get("command").and_then(Value::as_str).is_some_and(|c| c.contains(MARKER))
}

/// A real ELF: pointing the hooks at an empty or broken file would make every agent hook fail.
fn is_executable_binary(path: &Path) -> bool {
    use std::io::Read;
    let mut magic = [0u8; 4];
    fs::File::open(path).and_then(|mut f| f.read_exact(&mut magic)).is_ok() && magic == *b"\x7fELF"
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

    const SPEC: HookSpec = HookSpec {
        provider: ProviderKind::Claude,
        layout: HookLayout::Grouped,
        launchable: true,
        events: &[
            ("SessionStart", HOOK_TIMEOUT_SECS),
            ("Stop", HOOK_TIMEOUT_SECS),
            ("PermissionRequest", PERMISSION_TIMEOUT_SECS),
        ],
    };

    fn setup(initial: Option<Value>) -> (tempfile::TempDir, HookInstaller) {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        if let Some(v) = initial {
            fs::write(&settings, serde_json::to_string_pretty(&v).unwrap()).unwrap();
        }
        let source = dir.path().join("build/warroom-hook");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"\x7fELF fake").unwrap();
        let target = dir.path().join("bin/warroom-hook");
        let installer = HookInstaller::new(&SPEC, settings, Some(source), target);
        (dir, installer)
    }

    fn read(installer: &HookInstaller) -> Value {
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
        assert_eq!(stop.len(), 2, "the foreign one + ours, no duplicates");
        assert_eq!(stop[0]["hooks"][0]["command"], "node other.js");
        assert!(backup_path(&installer.settings_path).exists());
        assert_eq!(settings["hooks"]["PermissionRequest"][0]["hooks"][0]["timeout"], 600);
        assert_eq!(settings["hooks"]["Stop"][1]["hooks"][0]["timeout"], 5);
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
    fn refuses_to_install_something_that_is_not_a_binary() {
        let (dir, installer) = setup(None);
        fs::write(dir.path().join("build/warroom-hook"), "").unwrap();
        assert!(installer.install().is_err());
        assert!(!installer.settings_path.exists(), "does not touch settings.json");
    }

    #[test]
    fn refuses_to_touch_invalid_json() {
        let (_dir, installer) = setup(None);
        fs::write(&installer.settings_path, "{ not json").unwrap();
        assert!(installer.install().is_err());
        assert_eq!(fs::read_to_string(&installer.settings_path).unwrap(), "{ not json");
    }

    fn installer_for(spec: &'static HookSpec, initial: Option<Value>) -> (tempfile::TempDir, HookInstaller) {
        let (dir, base) = setup(initial);
        let installer = HookInstaller::new(spec, base.settings_path.clone(), base.bridge_source.clone(), base.bridge_target.clone());
        (dir, installer)
    }

    #[test]
    fn cursor_gets_flat_entries_with_a_version_and_leaves_no_trace() {
        static FLAT: HookSpec = HookSpec {
            provider: ProviderKind::Cursor,
            layout: HookLayout::Flat,
            launchable: true,
            events: &[("sessionStart", 5), ("stop", 5)],
        };
        let mine = json!({ "version": 1, "hooks": { "stop": [{ "command": "./audit.sh" }] } });
        let (_dir, installer) = installer_for(&FLAT, Some(mine.clone()));
        assert!(installer.install().unwrap().installed);
        let settings = read(&installer);
        assert_eq!(settings["hooks"]["stop"].as_array().unwrap().len(), 2);
        assert!(settings["hooks"]["sessionStart"][0]["command"].as_str().unwrap().contains("warroom-hook"));
        installer.uninstall().unwrap();
        assert_eq!(read(&installer), mine);

        let (_dir, fresh) = installer_for(&FLAT, None);
        fresh.install().unwrap();
        fresh.uninstall().unwrap();
        assert_eq!(read(&fresh), json!({}));
    }

    #[test]
    fn antigravity_gets_one_named_block_with_the_event_as_argument() {
        static NAMED: HookSpec = HookSpec {
            provider: ProviderKind::Antigravity,
            layout: HookLayout::Named("agent-war-room"),
            launchable: false,
            events: &[("PostToolUse", 5), ("Stop", 5)],
        };
        let mine = json!({ "lint": { "PostToolUse": [{ "matcher": "run_command", "hooks": [{ "command": "./lint.sh" }] }] } });
        let (_dir, installer) = installer_for(&NAMED, Some(mine.clone()));
        let status = installer.install().unwrap();
        assert!(status.installed && !status.launchable);
        let block = &read(&installer)["agent-war-room"];
        assert!(block["PostToolUse"][0]["hooks"][0]["command"].as_str().unwrap().ends_with("warroom-hook\" PostToolUse"));
        assert!(block["Stop"][0]["command"].as_str().unwrap().ends_with(" Stop"), "flat for non-tool events");
        installer.uninstall().unwrap();
        assert_eq!(read(&installer), mine);
    }

}
