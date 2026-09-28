use awr_application::ports::{AgentProvider, PortError, PortResult, Translated};
use awr_domain::{EndReason, ProviderKind, SessionEventKind, SessionId, SkillInvoker, SkillSource, WaitReason};
use super::tools::{clip, tool_argument};
use serde_json::Value;

/// Comandos internos de Claude Code: empiezan por `/` pero no son skills.
const BUILTIN_COMMANDS: &[&str] = &[
    "add-dir", "agents", "auto-mode-setup", "bashes", "bug", "clear", "compact", "config", "context",
    "continue", "cost", "doctor", "effort", "exit", "export", "fast", "feedback", "help", "hooks", "ide",
    "init", "install-github-app", "login", "logout", "mcp", "memory", "model", "output-style",
    "permissions", "plugin", "plugins", "pr-comments", "privacy-settings", "quit", "release-notes",
    "remote-control", "resume", "rewind", "skills", "status", "statusline", "tasks", "terminal-setup",
    "theme", "todos", "upgrade", "usage", "vim",
];

/// `/nombre args` → `nombre`, si parece una skill y no un comando interno.
fn slash_skill(prompt: &str) -> Option<String> {
    let name = prompt.trim_start().strip_prefix('/')?.split_whitespace().next()?;
    let valid = !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'));
    (valid && !BUILTIN_COMMANDS.contains(&name)).then(|| name.to_owned())
}

/// Herramientas cuyo `PreToolUse` significa que Claude te está preguntando algo.
const QUESTION_TOOLS: &[&str] = &["AskUserQuestion", "ExitPlanMode"];

pub struct ClaudeProvider;

impl AgentProvider for ClaudeProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Claude
    }

    fn wire_name(&self) -> &'static str {
        "claude"
    }

    fn translate(&self, payload: &Value) -> PortResult<Option<Translated>> {
        let field = |name: &str| payload.get(name).and_then(Value::as_str);
        let (Some(session), Some(event)) = (field("session_id"), field("hook_event_name")) else {
            return Err(PortError::Failed("hook de Claude sin session_id o hook_event_name".into()));
        };
        let tool = field("tool_name").map(str::to_owned);
        // Los hooks de herramientas desde un subagente llevan `agent_id`.
        let subagent = field("agent_id").map(str::to_owned);

        let mut extra = Vec::new();
        let skill = |name: String, by| SessionEventKind::SkillInvoked { name, by, source: SkillSource::Builtin };
        let kind = match event {
            "SessionStart" => SessionEventKind::Started,
            "UserPromptSubmit" => {
                if let Some(name) = field("prompt").and_then(slash_skill) {
                    extra.push(skill(name, SkillInvoker::User));
                }
                SessionEventKind::PromptSubmitted
            }
            "PreToolUse" => match tool {
                Some(t) if QUESTION_TOOLS.contains(&t.as_str()) => {
                    SessionEventKind::AwaitingYou { reason: WaitReason::Question, tool: Some(t), detail: None }
                }
                Some(t) => {
                    if t == "Skill"
                        && let Some(name) = payload.pointer("/tool_input/skill").and_then(Value::as_str)
                    {
                        extra.push(skill(name.to_owned(), SkillInvoker::Agent));
                    }
                    match subagent {
                        Some(id) => SessionEventKind::SubagentTool { id, tool: t },
                        None => SessionEventKind::ToolStarted { tool: t },
                    }
                }
                None => return Ok(None),
            },
            "PostToolUse" | "PostToolUseFailure" => match (tool, subagent) {
                (Some(t), None) => SessionEventKind::ToolFinished { tool: t, failed: event == "PostToolUseFailure" },
                _ => return Ok(None),
            },
            "PermissionRequest" => SessionEventKind::AwaitingYou {
                reason: WaitReason::Permission,
                tool,
                // Para Bash el comando dice más que su descripción.
                detail: payload
                    .pointer("/tool_input/command")
                    .and_then(Value::as_str)
                    .map(|c| clip(c, 80))
                    .or_else(|| tool_argument(payload.get("tool_input"))),
            },
            "Notification" => match notification_kind(field("notification_type"), field("message")) {
                Some(kind) => kind,
                None => return Ok(None),
            },
            "Stop" => SessionEventKind::TurnEnded,
            "SubagentStart" => SessionEventKind::SubagentStarted {
                id: field("agent_id").unwrap_or("unknown").to_owned(),
                kind: field("agent_type").map(str::to_owned),
            },
            "SubagentStop" => SessionEventKind::SubagentStopped {
                id: field("agent_id").unwrap_or("unknown").to_owned(),
            },
            "PreCompact" => SessionEventKind::CompactionStarted,
            "SessionEnd" => SessionEventKind::Ended {
                reason: EndReason::Exited(field("reason").unwrap_or("other").to_owned()),
            },
            _ => return Ok(None),
        };

        Ok(Some(Translated {
            session: SessionId(session.to_owned()),
            cwd: field("cwd").unwrap_or_default().to_owned(),
            transcript_path: field("transcript_path").map(str::to_owned),
            kind,
            extra,
        }))
    }
}

/// Versiones recientes mandan `notification_type`; las antiguas solo el mensaje.
fn notification_kind(kind: Option<&str>, message: Option<&str>) -> Option<SessionEventKind> {
    let kind = kind.map(str::to_owned).or_else(|| {
        let message = message?.to_lowercase();
        if message.contains("permission") {
            Some("permission_prompt".into())
        } else if message.contains("waiting for your input") {
            Some("idle_prompt".into())
        } else {
            None
        }
    })?;
    match kind.as_str() {
        "permission_prompt" => Some(SessionEventKind::AwaitingYou { reason: WaitReason::Permission, tool: None, detail: None }),
        "elicitation_dialog" => Some(SessionEventKind::AwaitingYou { reason: WaitReason::Question, tool: None, detail: None }),
        "idle_prompt" => Some(SessionEventKind::IdlePrompt),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn translate(payload: Value) -> Option<SessionEventKind> {
        ClaudeProvider.translate(&payload).unwrap().map(|t| t.kind)
    }

    fn hook(event: &str, extra: Value) -> Value {
        let mut base = json!({
            "session_id": "abc",
            "transcript_path": "/home/u/.claude/projects/x/abc.jsonl",
            "cwd": "/code/app",
            "hook_event_name": event,
        });
        base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        base
    }

    #[test]
    fn keeps_session_cwd_and_transcript() {
        let t = ClaudeProvider.translate(&hook("Stop", json!({}))).unwrap().unwrap();
        assert_eq!(t.session, SessionId("abc".into()));
        assert_eq!(t.cwd, "/code/app");
        assert_eq!(t.transcript_path.as_deref(), Some("/home/u/.claude/projects/x/abc.jsonl"));
        assert_eq!(t.kind, SessionEventKind::TurnEnded);
    }

    #[test]
    fn questions_are_distinguished_from_regular_tools() {
        assert_eq!(
            translate(hook("PreToolUse", json!({ "tool_name": "AskUserQuestion" }))),
            Some(SessionEventKind::AwaitingYou { reason: WaitReason::Question, tool: Some("AskUserQuestion".into()), detail: None })
        );
        assert_eq!(
            translate(hook("PreToolUse", json!({ "tool_name": "Bash" }))),
            Some(SessionEventKind::ToolStarted { tool: "Bash".into() })
        );
    }

    #[test]
    fn tools_used_by_subagents_are_attributed_to_them() {
        assert_eq!(
            translate(hook("PreToolUse", json!({ "tool_name": "Grep", "agent_id": "a1", "agent_type": "Explore" }))),
            Some(SessionEventKind::SubagentTool { id: "a1".into(), tool: "Grep".into() })
        );
        assert_eq!(translate(hook("PostToolUse", json!({ "tool_name": "Grep", "agent_id": "a1" }))), None);
    }

    fn extra(payload: Value) -> Vec<SessionEventKind> {
        ClaudeProvider.translate(&payload).unwrap().map(|t| t.extra).unwrap_or_default()
    }

    #[test]
    fn skills_launched_by_the_agent_or_by_you_are_recognised() {
        assert_eq!(
            extra(hook("PreToolUse", json!({ "tool_name": "Skill", "tool_input": { "skill": "close-task" } }))),
            vec![SessionEventKind::SkillInvoked { name: "close-task".into(), by: SkillInvoker::Agent, source: SkillSource::Builtin }]
        );
        assert_eq!(
            extra(hook("UserPromptSubmit", json!({ "prompt": "/teacher-content tema 3" }))),
            vec![SessionEventKind::SkillInvoked { name: "teacher-content".into(), by: SkillInvoker::User, source: SkillSource::Builtin }]
        );
        assert_eq!(
            extra(hook("UserPromptSubmit", json!({ "prompt": "/anthropic-skills:docx informe" }))),
            vec![SessionEventKind::SkillInvoked { name: "anthropic-skills:docx".into(), by: SkillInvoker::User, source: SkillSource::Builtin }]
        );
        assert!(extra(hook("UserPromptSubmit", json!({ "prompt": "/model opus" }))).is_empty(), "comando interno");
        assert!(extra(hook("UserPromptSubmit", json!({ "prompt": "usa /tmp" }))).is_empty());
        assert!(extra(hook("UserPromptSubmit", json!({ "prompt": "/../../etc" }))).is_empty());
    }

    #[test]
    fn permission_requests_say_what_they_want_to_run() {
        assert_eq!(
            translate(hook("PermissionRequest", json!({ "tool_name": "Bash", "tool_input": { "command": "touch x.txt", "description": "Crear" } }))),
            Some(SessionEventKind::AwaitingYou {
                reason: WaitReason::Permission,
                tool: Some("Bash".into()),
                detail: Some("touch x.txt".into())
            })
        );
    }

    #[test]
    fn notifications_by_type_or_by_legacy_message() {
        assert_eq!(
            translate(hook("Notification", json!({ "notification_type": "idle_prompt" }))),
            Some(SessionEventKind::IdlePrompt)
        );
        assert_eq!(
            translate(hook("Notification", json!({ "message": "Claude needs your permission to use Bash" }))),
            Some(SessionEventKind::AwaitingYou { reason: WaitReason::Permission, tool: None, detail: None })
        );
        assert_eq!(translate(hook("Notification", json!({ "notification_type": "auth_success" }))), None);
    }

    #[test]
    fn subagents_and_end() {
        assert_eq!(
            translate(hook("SubagentStart", json!({ "agent_id": "a1", "agent_type": "Explore" }))),
            Some(SessionEventKind::SubagentStarted { id: "a1".into(), kind: Some("Explore".into()) })
        );
        assert_eq!(
            translate(hook("SessionEnd", json!({ "reason": "prompt_input_exit" }))),
            Some(SessionEventKind::Ended { reason: EndReason::Exited("prompt_input_exit".into()) })
        );
    }

    #[test]
    fn unknown_events_are_ignored_and_garbage_rejected() {
        assert_eq!(translate(hook("TeammateIdle", json!({}))), None);
        assert!(ClaudeProvider.translate(&json!({ "foo": 1 })).is_err());
    }
}
