//! Cursor's hooks (`~/.cursor/hooks.json`): their own camelCase events and snake_case fields, not the
//! Claude protocol. Every payload carries `session_id` (= `conversation_id`), `workspace_roots`,
//! `transcript_path` and usually `model`; `afterAgentResponse` also brings the response's tokens,
//! which Cursor's transcript lacks, so they travel as [`HookFacts`].

use awr_application::ports::{AgentProvider, HookFacts, PortError, PortResult, Translated, Usage};
use awr_domain::{EndReason, ProviderKind, SessionEventKind, SessionId};
use serde_json::Value;

pub struct CursorProvider;

impl AgentProvider for CursorProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Cursor
    }

    fn wire_name(&self) -> &'static str {
        "cursor"
    }

    fn translate(&self, payload: &Value) -> PortResult<Option<Translated>> {
        let field = |name: &str| payload.get(name).and_then(Value::as_str).filter(|v| !v.is_empty());
        let number = |name: &str| payload.get(name).and_then(Value::as_u64);
        let (Some(session), Some(event)) =
            (field("session_id").or_else(|| field("conversation_id")), field("hook_event_name"))
        else {
            return Err(PortError::Failed("cursor hook without session_id or hook_event_name".into()));
        };
        // Tool calls made inside a subagent: they would open a session of their own.
        if field("parent_tool_call_id").is_some() {
            return Ok(None);
        }
        let tool = || field("tool_name").unwrap_or("tool").to_owned();
        let kind = match event {
            "sessionStart" => Some(SessionEventKind::Started),
            "beforeSubmitPrompt" => Some(SessionEventKind::PromptSubmitted),
            "preToolUse" => Some(SessionEventKind::ToolStarted { tool: tool() }),
            "postToolUse" => Some(SessionEventKind::ToolFinished { tool: tool(), failed: false }),
            "postToolUseFailure" if payload.get("is_interrupt").and_then(Value::as_bool) == Some(true) => {
                Some(SessionEventKind::Interrupted)
            }
            "postToolUseFailure" => Some(SessionEventKind::ToolFinished { tool: tool(), failed: true }),
            // Only brings model and tokens.
            "afterAgentResponse" => None,
            "stop" if field("status") == Some("aborted") => Some(SessionEventKind::Interrupted),
            "stop" => Some(SessionEventKind::TurnEnded),
            "subagentStart" => Some(SessionEventKind::SubagentStarted {
                id: field("subagent_id").unwrap_or("unknown").to_owned(),
                kind: field("subagent_type").map(str::to_owned),
            }),
            "subagentStop" => {
                Some(SessionEventKind::SubagentStopped { id: field("subagent_id").unwrap_or("unknown").to_owned() })
            }
            "preCompact" => Some(SessionEventKind::CompactionStarted),
            "sessionEnd" => Some(SessionEventKind::Ended {
                reason: EndReason::Exited(field("reason").unwrap_or("other").to_owned()),
            }),
            _ => return Ok(None),
        };

        let usage = (event == "afterAgentResponse" && number("input_tokens").is_some()).then(|| Usage {
            input_tokens: number("input_tokens").unwrap_or(0),
            output_tokens: number("output_tokens").unwrap_or(0),
            cache_read_tokens: number("cache_read_tokens").unwrap_or(0),
            cache_write_tokens: number("cache_write_tokens").unwrap_or(0),
            // Cursor bills its own way; no per-token price to estimate.
            cost_micros: 0,
            unpriced_messages: 1,
        });
        let facts = HookFacts {
            model: field("model").filter(|m| *m != "default" && *m != "auto").map(str::to_owned),
            usage,
            context_tokens: (event == "preCompact").then(|| number("context_tokens")).flatten(),
            context_window: (event == "preCompact").then(|| number("context_window_size")).flatten(),
        };
        let cwd = payload
            .get("workspace_roots")
            .and_then(Value::as_array)
            .and_then(|roots| roots.first())
            .and_then(Value::as_str)
            .unwrap_or_default();

        Ok(Some(Translated {
            session: SessionId(session.to_owned()),
            cwd: cwd.to_owned(),
            transcript_path: field("transcript_path").map(str::to_owned),
            kind,
            extra: Vec::new(),
            facts,
            question: None,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A payload shaped as Cursor's hook contract (`hooks_pb`: `*RequestQuery` + the common fields).
    fn hook(event: &str, extra: Value) -> Value {
        let mut p = json!({
            "conversation_id": "c1", "session_id": "c1", "generation_id": "g1", "hook_event_name": event,
            "cursor_version": "3.18.9", "workspace_roots": ["/code/app"], "user_email": null,
            "transcript_path": "/home/u/.cursor/projects/code-app/agent-transcripts/c1/c1.jsonl",
            "model": "claude-4.6-sonnet",
        });
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        p
    }

    fn translate(event: &str, extra: Value) -> Option<Translated> {
        CursorProvider.translate(&hook(event, extra)).unwrap()
    }

    #[test]
    fn a_cursor_turn_maps_to_the_same_states() {
        let kinds: Vec<_> = [
            ("sessionStart", json!({})),
            ("beforeSubmitPrompt", json!({ "prompt": "fix it", "attachments": [] })),
            ("preToolUse", json!({ "tool_name": "Shell", "tool_input": { "command": "ls" }, "tool_use_id": "t" })),
            ("postToolUse", json!({ "tool_name": "Shell", "tool_output": "", "duration_ms": 3, "tool_use_id": "t" })),
            ("stop", json!({ "status": "completed", "loop_count": 0 })),
            ("sessionEnd", json!({ "reason": "user_close" })),
        ]
        .into_iter()
        .map(|(e, x)| translate(e, x).unwrap().kind.unwrap())
        .collect();
        assert_eq!(
            kinds,
            [
                SessionEventKind::Started,
                SessionEventKind::PromptSubmitted,
                SessionEventKind::ToolStarted { tool: "Shell".into() },
                SessionEventKind::ToolFinished { tool: "Shell".into(), failed: false },
                SessionEventKind::TurnEnded,
                SessionEventKind::Ended { reason: EndReason::Exited("user_close".into()) },
            ]
        );
        let t = translate("stop", json!({ "status": "completed" })).unwrap();
        assert_eq!(t.cwd, "/code/app");
        assert!(t.transcript_path.unwrap().ends_with("agent-transcripts/c1/c1.jsonl"));
    }

    #[test]
    fn stopping_it_yourself_is_an_interruption() {
        assert_eq!(
            translate("stop", json!({ "status": "aborted" })).unwrap().kind,
            Some(SessionEventKind::Interrupted)
        );
        let interrupted =
            json!({ "tool_name": "Shell", "error_message": "", "failure_type": "x", "is_interrupt": true });
        assert_eq!(translate("postToolUseFailure", interrupted).unwrap().kind, Some(SessionEventKind::Interrupted));
    }

    #[test]
    fn responses_bring_model_and_tokens_without_changing_state() {
        let t = translate(
            "afterAgentResponse",
            json!({ "text": "done", "input_tokens": 1200, "output_tokens": 80, "cache_read_tokens": 30000, "cache_write_tokens": 500 }),
        )
        .unwrap();
        assert_eq!(t.kind, None);
        assert_eq!(t.facts.model.as_deref(), Some("claude-4.6-sonnet"));
        let usage = t.facts.usage.unwrap();
        assert_eq!((usage.input_tokens, usage.cache_read_tokens, usage.unpriced_messages), (1200, 30000, 1));
        let compact = translate(
            "preCompact",
            json!({ "trigger": "auto", "context_tokens": 180000, "context_window_size": 200000 }),
        );
        assert_eq!(compact.unwrap().facts.context_window, Some(200_000));
    }

    #[test]
    fn subagents_and_their_tools() {
        assert_eq!(
            translate("subagentStart", json!({ "subagent_id": "s1", "subagent_type": "explore", "task": "find", "parent_conversation_id": "c1" }))
                .unwrap()
                .kind,
            Some(SessionEventKind::SubagentStarted { id: "s1".into(), kind: Some("explore".into()) })
        );
        let inner = json!({ "tool_name": "Read", "tool_use_id": "t", "parent_tool_call_id": "task-1" });
        assert!(translate("preToolUse", inner).is_none(), "not a session of its own");
    }
}
