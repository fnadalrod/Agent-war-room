//! Codex's dialect of the hook protocol (see `crate::hooks`): the same events and fields as Claude
//! Code, plus `Interrupt`; no `Notification`.

use crate::hooks::{Dialect, translate};
use awr_application::ports::{AgentProvider, PortResult, Translated};
use awr_domain::ProviderKind;
use serde_json::Value;

pub const CODEX: Dialect = Dialect {
    kind: ProviderKind::Codex,
    wire_name: "codex",
    // Codex mentions skills as `$name`; its `/` commands never reach the hooks as prompts.
    skill_prefix: '$',
    builtin_commands: &[],
    question_tools: &["request_user_input"],
    skill_tool: None,
};

pub struct CodexProvider;

impl AgentProvider for CodexProvider {
    fn kind(&self) -> ProviderKind {
        CODEX.kind
    }

    fn wire_name(&self) -> &'static str {
        CODEX.wire_name
    }

    fn translate(&self, payload: &Value) -> PortResult<Option<Translated>> {
        translate(&CODEX, payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use awr_domain::{EndReason, SessionEventKind, SessionId, SkillInvoker, SkillSource, WaitReason};
    use serde_json::json;

    /// Hooks captured from Codex 0.154 running a command that needed approval.
    const CAPTURED: &str = include_str!("fixtures/hooks.jsonl");

    fn kinds() -> Vec<SessionEventKind> {
        CAPTURED
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .filter_map(|p| CodexProvider.translate(&p).unwrap().and_then(|t| t.kind))
            .collect()
    }

    #[test]
    fn a_real_codex_session_reads_like_a_claude_one() {
        let bash = || "Bash".to_string();
        assert_eq!(
            kinds(),
            vec![
                SessionEventKind::Started,
                SessionEventKind::PromptSubmitted,
                SessionEventKind::ToolStarted { tool: bash() },
                SessionEventKind::ToolFinished { tool: bash(), failed: false },
                SessionEventKind::ToolStarted { tool: bash() },
                SessionEventKind::AwaitingYou {
                    reason: WaitReason::Permission,
                    tool: Some(bash()),
                    detail: Some("curl -sI https://example.com | head -1".into()),
                },
                SessionEventKind::ToolFinished { tool: bash(), failed: false },
                SessionEventKind::TurnEnded,
                SessionEventKind::Ended { reason: EndReason::Exited("other".into()) },
            ]
        );
    }

    #[test]
    fn keeps_session_cwd_and_rollout_path() {
        let first: Value = serde_json::from_str(CAPTURED.lines().next().unwrap()).unwrap();
        let t = CodexProvider.translate(&first).unwrap().unwrap();
        assert_eq!(t.session, SessionId("01a0e7a2-87d7-7aa3-8a8a-d5c66bd78dda".into()));
        assert_eq!(t.cwd, "/code/app");
        assert!(t.transcript_path.unwrap().starts_with("/home/u/.codex/sessions/2026/09/28/rollout-"));
    }

    #[test]
    fn interrupting_and_dollar_skills() {
        let hook = |event: &str, extra: Value| {
            let mut p = json!({ "session_id": "s", "cwd": "/c", "hook_event_name": event });
            p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            CodexProvider.translate(&p).unwrap().unwrap()
        };
        assert_eq!(hook("Interrupt", json!({ "turn_id": "t" })).kind, Some(SessionEventKind::Interrupted));
        assert_eq!(
            hook("UserPromptSubmit", json!({ "prompt": "$close-task now" })).extra,
            vec![SessionEventKind::SkillInvoked {
                name: "close-task".into(),
                by: SkillInvoker::User,
                source: SkillSource::Builtin
            }]
        );
        assert!(hook("UserPromptSubmit", json!({ "prompt": "costs $5" })).extra.is_empty());
    }
}
