//! Claude Code's dialect of the hook protocol (see `crate::hooks`).

use crate::hooks::{Dialect, translate};
use awr_application::ports::{AgentProvider, PortResult, Translated};
use awr_domain::ProviderKind;
use serde_json::Value;

/// Claude Code's built-in commands: they start with `/` but are not skills.
const BUILTIN_COMMANDS: &[&str] = &[
    "add-dir",
    "agents",
    "auto-mode-setup",
    "bashes",
    "bug",
    "clear",
    "compact",
    "config",
    "context",
    "continue",
    "cost",
    "doctor",
    "effort",
    "exit",
    "export",
    "fast",
    "feedback",
    "help",
    "hooks",
    "ide",
    "init",
    "install-github-app",
    "login",
    "logout",
    "mcp",
    "memory",
    "model",
    "output-style",
    "permissions",
    "plugin",
    "plugins",
    "pr-comments",
    "privacy-settings",
    "quit",
    "release-notes",
    "remote-control",
    "resume",
    "rewind",
    "skills",
    "status",
    "statusline",
    "tasks",
    "terminal-setup",
    "theme",
    "todos",
    "upgrade",
    "usage",
    "vim",
];

pub const CLAUDE: Dialect = Dialect {
    kind: ProviderKind::Claude,
    wire_name: "claude",
    skill_prefix: '/',
    builtin_commands: BUILTIN_COMMANDS,
    // `PreToolUse` of these means Claude is asking the user something.
    question_tools: &["AskUserQuestion", "ExitPlanMode"],
    skill_tool: Some("Skill"),
};

pub struct ClaudeProvider;

impl AgentProvider for ClaudeProvider {
    fn kind(&self) -> ProviderKind {
        CLAUDE.kind
    }

    fn wire_name(&self) -> &'static str {
        CLAUDE.wire_name
    }

    fn translate(&self, payload: &Value) -> PortResult<Option<Translated>> {
        translate(&CLAUDE, payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use awr_domain::{EndReason, SessionEventKind, SessionId, SkillInvoker, SkillSource, WaitReason};
    use serde_json::json;

    fn translate(payload: Value) -> Option<SessionEventKind> {
        ClaudeProvider.translate(&payload).unwrap().and_then(|t| t.kind)
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
        assert_eq!(t.kind, Some(SessionEventKind::TurnEnded));
    }

    #[test]
    fn questions_are_distinguished_from_regular_tools() {
        assert_eq!(
            translate(hook("PreToolUse", json!({ "tool_name": "AskUserQuestion" }))),
            Some(SessionEventKind::AwaitingYou {
                reason: WaitReason::Question,
                tool: Some("AskUserQuestion".into()),
                detail: None
            })
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
            vec![SessionEventKind::SkillInvoked {
                name: "close-task".into(),
                by: SkillInvoker::Agent,
                source: SkillSource::Builtin
            }]
        );
        assert_eq!(
            extra(hook("UserPromptSubmit", json!({ "prompt": "/teacher-content lesson 3" }))),
            vec![SessionEventKind::SkillInvoked {
                name: "teacher-content".into(),
                by: SkillInvoker::User,
                source: SkillSource::Builtin
            }]
        );
        assert_eq!(
            extra(hook("UserPromptSubmit", json!({ "prompt": "/anthropic-skills:docx report" }))),
            vec![SessionEventKind::SkillInvoked {
                name: "anthropic-skills:docx".into(),
                by: SkillInvoker::User,
                source: SkillSource::Builtin
            }]
        );
        assert!(extra(hook("UserPromptSubmit", json!({ "prompt": "/model opus" }))).is_empty(), "built-in command");
        assert!(extra(hook("UserPromptSubmit", json!({ "prompt": "use /tmp" }))).is_empty());
        assert!(extra(hook("UserPromptSubmit", json!({ "prompt": "/../../etc" }))).is_empty());
    }

    #[test]
    fn permission_requests_say_what_they_want_to_run() {
        assert_eq!(
            translate(hook(
                "PermissionRequest",
                json!({ "tool_name": "Bash", "tool_input": { "command": "touch x.txt", "description": "Create" } })
            )),
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
