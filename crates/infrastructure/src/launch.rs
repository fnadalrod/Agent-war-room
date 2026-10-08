//! Launching agents (new or resumed) and typing into live sessions.

use crate::desktop::{open_url, tmux};
use crate::locale;
use crate::pty::{PtyManager, PtySpec};
use awr_application::ports::{
    AgentLauncher, LaunchOutcome, LaunchRequest, LaunchTarget, PortError, PortResult, SessionInput,
};
use awr_domain::{ProviderKind, TerminalHost};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

/// Tab configs we generate for Warp are deleted after this long.
const WARP_CONFIG_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const WARP_CONFIG_PREFIX: &str = "awr-";

pub struct DesktopLauncher {
    pty: Arc<PtyManager>,
    /// `~/.local/share/warp-terminal/tab_configs`.
    warp_tab_configs: PathBuf,
}

impl DesktopLauncher {
    pub fn new(pty: Arc<PtyManager>, warp_tab_configs: PathBuf) -> Self {
        Self { pty, warp_tab_configs }
    }

    fn launch_in_warp(&self, request: &LaunchRequest, command: &str) -> PortResult<LaunchOutcome> {
        let stem = self.write_warp_config(request, &command_with_language(command))?;
        open_url(&format!("warp://tab_config/{stem}"));
        Ok(LaunchOutcome::External { via: "warp".into() })
    }

    /// Writes the tab config and returns its name (what `warp://tab_config/` opens).
    fn write_warp_config(&self, request: &LaunchRequest, command: &str) -> PortResult<String> {
        std::fs::create_dir_all(&self.warp_tab_configs).map_err(fail)?;
        self.sweep_old_warp_configs();
        let stem = format!(
            "{WARP_CONFIG_PREFIX}{}",
            request
                .resume
                .as_ref()
                .map(|id| id.0[..8.min(id.0.len())].to_owned())
                .unwrap_or_else(|| slug(&request.label))
        );
        let toml = format!(
            "name = {name}\ntitle = {title}\ncolor = \"blue\"\n\n[[panes]]\nid = \"main\"\ntype = \"terminal\"\ndirectory = {dir}\ncommands = [{command}]\nis_focused = true\n",
            name = toml_string(&locale::warp_tab_name(&request.label)),
            title = toml_string(&request.label),
            dir = toml_string(&request.cwd),
            command = toml_string(command),
        );
        std::fs::write(self.warp_tab_configs.join(format!("{stem}.toml")), toml).map_err(fail)?;
        Ok(stem)
    }

    fn sweep_old_warp_configs(&self) {
        let Ok(entries) = std::fs::read_dir(&self.warp_tab_configs) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| SystemTime::now().duration_since(t).ok())
                .is_some_and(|age| age > WARP_CONFIG_TTL);
            if name.starts_with(WARP_CONFIG_PREFIX) && name.ends_with(".toml") && stale {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

impl AgentLauncher for DesktopLauncher {
    fn launch(&self, request: &LaunchRequest) -> PortResult<LaunchOutcome> {
        let command = agent_command(request)?;
        match request.target {
            LaunchTarget::Warp => self.launch_in_warp(request, &command),
            LaunchTarget::App => {
                let (program, args) = shell_running(&command);
                let pty_id = self
                    .pty
                    .spawn(PtySpec {
                        program,
                        args,
                        cwd: request.cwd.clone(),
                        label: request.label.clone(),
                        env: agent_environment(),
                        env_remove: inherited_agent_markers(),
                    })
                    .map_err(PortError::Failed)?;
                Ok(LaunchOutcome::AppTerminal { pty_id })
            }
        }
    }
}

/// The program and arguments that run `command` in the user's shell.
#[cfg(unix)]
fn shell_running(command: &str) -> (String, Vec<String>) {
    // Login shell: when launched from the desktop, PATH does not include ~/.local/bin.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    (shell, vec!["-l".into(), "-c".into(), format!("exec {command}")])
}

/// `cmd` finds the agent on PATH whether it is an `.exe` or an npm `.cmd` shim.
#[cfg(windows)]
fn shell_running(command: &str) -> (String, Vec<String>) {
    let cmd = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
    (cmd, vec!["/D".into(), "/C".into(), command.into()])
}

/// If the app was started from a Claude session, it inherits markers (`CLAUDE_CODE_CHILD_SESSION`…)
/// that would make the new agent believe it is a subprocess and, among other things, not save a
/// transcript. Every agent launched from the war room is an independent session.
pub fn inherited_agent_markers() -> Vec<String> {
    std::env::vars()
        .map(|(k, _)| k)
        .filter(|k| {
            k == "CLAUDECODE"
                || k == "CLAUDE_PID"
                || k == "CLAUDE_EFFORT"
                || k == "AI_AGENT"
                || k.starts_with("CLAUDE_CODE_")
        })
        .collect()
}

/// The shell line that starts (or resumes) the requested agent.
fn agent_command(request: &LaunchRequest) -> PortResult<String> {
    let (program, resume) = match request.provider {
        ProviderKind::Claude => ("claude", "claude --resume"),
        ProviderKind::Codex => ("codex", "codex resume"),
        ProviderKind::Cursor => ("cursor-agent", "cursor-agent --resume"),
        // Only runs inside its own app.
        ProviderKind::Antigravity => return Err(PortError::Failed(locale::agent_not_launchable("Antigravity"))),
    };
    match &request.resume {
        None => Ok(program.into()),
        // The id ends up in a shell line: only its alphabet is allowed.
        Some(id) if !id.0.is_empty() && id.0.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => {
            Ok(format!("{resume} {}", id.0))
        }
        Some(id) => Err(PortError::Failed(locale::invalid_session_id(id))),
    }
}

fn agent_environment() -> Vec<(String, String)> {
    vec![("AWR_LANG".into(), awr_i18n::language().into())]
}

/// Warp starts the command itself, so unlike an app PTY its environment must be part of the shell line.
#[cfg(not(windows))]
fn command_with_language(command: &str) -> String {
    format!("AWR_LANG={} {command}", awr_i18n::language())
}

#[cfg(windows)]
fn command_with_language(command: &str) -> String {
    format!(r#"cmd.exe /D /C "set AWR_LANG={}&& {command}""#, awr_i18n::language())
}

/// Types into sessions living in an app terminal or in tmux. The rest only support "go to".
pub struct TerminalInput {
    pty: Arc<PtyManager>,
}

impl TerminalInput {
    pub fn new(pty: Arc<PtyManager>) -> Self {
        Self { pty }
    }
}

impl SessionInput for TerminalInput {
    fn send(&self, host: &TerminalHost, text: &str) -> PortResult<()> {
        if let Some(pty) = &host.pty_id {
            self.pty.write(pty, text.as_bytes()).map_err(PortError::Failed)?;
            // Sent separately: pasted together with the text, Enter would be taken as a line break.
            std::thread::sleep(Duration::from_millis(60));
            return self.pty.write(pty, b"\r").map_err(PortError::Failed);
        }
        if let Some(pane) = &host.tmux_pane {
            return tmux::send_text(host.tmux_socket.as_deref(), pane, text, true).map_err(PortError::Failed);
        }
        Err(PortError::Failed(locale::external_terminal_no_input().into()))
    }
}

fn toml_string(s: &str) -> String {
    let escaped: String = s
        .chars()
        .flat_map(|c| match c {
            '"' => vec!['\\', '"'],
            '\\' => vec!['\\', '\\'],
            '\n' => vec!['\\', 'n'],
            c => vec![c],
        })
        .collect();
    format!("\"{escaped}\"")
}

fn slug(label: &str) -> String {
    let s: String = label.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-").chars().take(40).collect()
}

fn fail(e: impl ToString) -> PortError {
    PortError::Failed(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use awr_domain::SessionId;

    fn request(resume: Option<&str>, target: LaunchTarget) -> LaunchRequest {
        LaunchRequest {
            provider: ProviderKind::Claude,
            cwd: "/code/My \"app\"".into(),
            resume: resume.map(|r| SessionId(r.into())),
            target,
            label: "Fix the login".into(),
        }
    }

    #[test]
    fn resume_ids_are_validated_before_reaching_a_shell() {
        assert_eq!(agent_command(&request(None, LaunchTarget::App)).unwrap(), "claude");
        assert_eq!(
            agent_command(&request(Some("d96c47e0-0e79"), LaunchTarget::App)).unwrap(),
            "claude --resume d96c47e0-0e79"
        );
        assert!(agent_command(&request(Some("x; rm -rf ~"), LaunchTarget::App)).is_err());
        let codex = |resume| LaunchRequest { provider: ProviderKind::Codex, ..request(resume, LaunchTarget::App) };
        assert_eq!(agent_command(&codex(None)).unwrap(), "codex");
        assert_eq!(agent_command(&codex(Some("01a0e7a2-87d7"))).unwrap(), "codex resume 01a0e7a2-87d7");
    }

    #[test]
    fn warp_gets_a_tab_config_that_runs_the_command_in_the_session_folder() {
        let dir = tempfile::tempdir().unwrap();
        let launcher = DesktopLauncher::new(PtyManager::new(Arc::new(|_| {})), dir.path().join("tab_configs"));
        let req = request(Some("d96c47e0-0e79-4c98"), LaunchTarget::Warp);

        let command = command_with_language(&agent_command(&req).unwrap());
        let stem = launcher.write_warp_config(&req, &command).unwrap();
        assert_eq!(stem, "awr-d96c47e0");
        let toml = std::fs::read_to_string(dir.path().join("tab_configs/awr-d96c47e0.toml")).unwrap();
        assert!(toml.contains(r#"name = "War Room · Fix the login""#));
        assert!(toml.contains(r#"directory = "/code/My \"app\"""#));
        assert!(toml.contains(&format!("AWR_LANG={}", awr_i18n::language())));
        assert!(toml.contains("claude --resume d96c47e0-0e79-4c98"));

        let new = request(None, LaunchTarget::Warp);
        assert_eq!(launcher.write_warp_config(&new, "claude").unwrap(), "awr-fix-the-login");
    }

    #[test]
    fn launched_agents_receive_the_selected_language() {
        let language = awr_i18n::language();
        assert_eq!(agent_environment(), vec![("AWR_LANG".into(), language.into())]);
        let warp = command_with_language("codex");
        assert!(warp.contains(&format!("AWR_LANG={language}")));
        assert!(warp.contains("codex"));
    }

    #[test]
    fn external_terminals_cannot_be_typed_into() {
        let input = TerminalInput::new(PtyManager::new(Arc::new(|_| {})));
        assert!(input.send(&TerminalHost::default(), "hello").is_err());
    }
}
