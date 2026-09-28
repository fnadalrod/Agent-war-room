//! The hook protocol Claude Code introduced and Codex adopted: same event names (`SessionStart`,
//! `PreToolUse`, `PermissionRequest`, `Stop`…) and the same payload fields (`session_id`, `cwd`,
//! `transcript_path`, `tool_name`, `tool_input`, `agent_id`…). One translation serves every agent
//! that speaks it; a [`Dialect`] carries what differs.

use crate::tools::{clip, tool_argument};
use awr_application::ports::{PortError, PortResult, Translated};
use awr_domain::{EndReason, ProviderKind, SessionEventKind, SessionId, SkillInvoker, SkillSource, WaitReason};
use serde_json::Value;

/// What one agent does differently within the shared hook protocol.
pub struct Dialect {
    pub kind: ProviderKind,
    /// Name it arrives with in the bridge envelope.
    pub wire_name: &'static str,
    /// How you invoke a skill from the prompt: `/name` (Claude), `$name` (Codex).
    pub skill_prefix: char,
    /// Commands with that prefix that are not skills.
    pub builtin_commands: &'static [&'static str],
    /// Tools whose `PreToolUse` means the agent is asking you something.
    pub question_tools: &'static [&'static str],
    /// Tool the agent uses to load a skill, with the skill's name in `tool_input.skill`.
    pub skill_tool: Option<&'static str>,
}

impl Dialect {
    /// `<prefix>name args` → `name`, if it looks like a skill rather than a built-in command.
    fn prompt_skill(&self, prompt: &str) -> Option<String> {
        let name = prompt.trim_start().strip_prefix(self.skill_prefix)?.split_whitespace().next()?;
        let valid =
            !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'));
        (valid && !self.builtin_commands.contains(&name)).then(|| name.to_owned())
    }
}

/// Translates one hook payload into domain events.
pub fn translate(dialect: &Dialect, payload: &Value) -> PortResult<Option<Translated>> {
    let field = |name: &str| payload.get(name).and_then(Value::as_str);
    let (Some(session), Some(event)) = (field("session_id"), field("hook_event_name")) else {
        return Err(PortError::Failed(format!("{} hook without session_id or hook_event_name", dialect.wire_name)));
    };
    let tool = field("tool_name").map(str::to_owned);
    // Tool hooks fired from a subagent carry `agent_id`.
    let subagent = field("agent_id").map(str::to_owned);

    let mut extra = Vec::new();
    let skill = |name: String, by| SessionEventKind::SkillInvoked { name, by, source: SkillSource::Builtin };
    let kind = match event {
        "SessionStart" => SessionEventKind::Started,
        "UserPromptSubmit" => {
            if let Some(name) = field("prompt").and_then(|p| dialect.prompt_skill(p)) {
                extra.push(skill(name, SkillInvoker::User));
            }
            SessionEventKind::PromptSubmitted
        }
        "PreToolUse" => match tool {
            Some(t) if dialect.question_tools.contains(&t.as_str()) => {
                SessionEventKind::AwaitingYou { reason: WaitReason::Question, tool: Some(t), detail: None }
            }
            Some(t) => {
                if Some(t.as_str()) == dialect.skill_tool
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
            // For Bash the command says more than its description.
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
        "Interrupt" => SessionEventKind::Interrupted,
        "SubagentStart" => SessionEventKind::SubagentStarted {
            id: field("agent_id").unwrap_or("unknown").to_owned(),
            kind: field("agent_type").map(str::to_owned),
        },
        "SubagentStop" => SessionEventKind::SubagentStopped { id: field("agent_id").unwrap_or("unknown").to_owned() },
        "PreCompact" => SessionEventKind::CompactionStarted,
        "SessionEnd" => {
            SessionEventKind::Ended { reason: EndReason::Exited(field("reason").unwrap_or("other").to_owned()) }
        }
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

/// Claude's `Notification`: recent versions send `notification_type`; older ones only the message.
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
        "permission_prompt" => {
            Some(SessionEventKind::AwaitingYou { reason: WaitReason::Permission, tool: None, detail: None })
        }
        "elicitation_dialog" => {
            Some(SessionEventKind::AwaitingYou { reason: WaitReason::Question, tool: None, detail: None })
        }
        "idle_prompt" => Some(SessionEventKind::IdlePrompt),
        _ => None,
    }
}
