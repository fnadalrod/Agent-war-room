//! Antigravity's hooks: camelCase payloads (`conversationId`, `workspacePaths`, `transcriptPath`,
//! `modelName`) that don't name the event, so our hook command passes it as an argument and the
//! bridge adds it as `hook_event_name`. There is no start, end or prompt event: the first model call
//! of a turn stands for your prompt, and `Stop` ends the turn.

use awr_application::ports::{AgentProvider, HookFacts, PortError, PortResult, Translated};
use awr_domain::{ProviderKind, SessionEventKind, SessionId};
use serde_json::Value;
use std::path::PathBuf;

pub struct AntigravityProvider {
    /// `~/.gemini/antigravity/brain`, where transcripts live if the payload does not say.
    brain: PathBuf,
}

impl AntigravityProvider {
    pub fn new(brain: PathBuf) -> Self {
        Self { brain }
    }

    fn transcript_of(&self, conversation: &str) -> Option<String> {
        let safe = conversation.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
        safe.then(|| {
            self.brain.join(conversation).join(".system_generated/logs/transcript.jsonl").display().to_string()
        })
    }
}

impl AgentProvider for AntigravityProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Antigravity
    }

    fn wire_name(&self) -> &'static str {
        "antigravity"
    }

    fn translate(&self, payload: &Value) -> PortResult<Option<Translated>> {
        let field = |name: &str| payload.get(name).and_then(Value::as_str).filter(|v| !v.is_empty());
        let (Some(session), Some(event)) = (field("conversationId"), field("hook_event_name")) else {
            return Err(PortError::Failed("antigravity hook without conversationId or event".into()));
        };
        let kind = match event {
            // `invocationNum` counts model calls within the run: the first one follows your prompt.
            "PreInvocation" if payload.get("invocationNum").and_then(Value::as_u64).unwrap_or(0) <= 1 => {
                Some(SessionEventKind::PromptSubmitted)
            }
            // Later calls: still working, no new turn.
            "PreInvocation" => Some(SessionEventKind::ToolFinished { tool: "model".into(), failed: false }),
            "PostToolUse" => Some(SessionEventKind::ToolFinished {
                tool: payload.pointer("/toolCall/name").and_then(Value::as_str).unwrap_or("tool").to_owned(),
                failed: field("error").is_some(),
            }),
            "PostInvocation" => None,
            "Stop" => Some(SessionEventKind::TurnEnded),
            _ => return Ok(None),
        };
        let cwd = payload
            .get("workspacePaths")
            .and_then(Value::as_array)
            .and_then(|paths| paths.first())
            .and_then(Value::as_str)
            .unwrap_or_default();
        Ok(Some(Translated {
            session: SessionId(session.to_owned()),
            cwd: cwd.to_owned(),
            transcript_path: field("transcriptPath").map(str::to_owned).or_else(|| self.transcript_of(session)),
            kind,
            extra: Vec::new(),
            facts: HookFacts {
                model: field("modelName").filter(|m| *m != "auto").map(str::to_owned),
                ..HookFacts::default()
            },
            question: None,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Shaped like the contract in Antigravity's embedded docs, plus the event the bridge adds.
    fn hook(event: &str, extra: Value) -> Option<Translated> {
        let mut p = json!({
            "conversationId": "ec33ebf9-0cba-4100-8142-c61503f6c587", "workspacePaths": ["/code/app"],
            "artifactDirectoryPath": "/x", "modelName": "gemini-3.1-pro", "hook_event_name": event,
        });
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        AntigravityProvider::new("/home/u/.gemini/antigravity/brain".into()).translate(&p).unwrap()
    }

    #[test]
    fn a_turn_is_its_model_calls_and_its_stop() {
        let first = hook("PreInvocation", json!({ "invocationNum": 1, "initialNumSteps": 0 })).unwrap();
        assert_eq!(first.kind, Some(SessionEventKind::PromptSubmitted));
        assert_eq!(first.cwd, "/code/app");
        assert_eq!(first.facts.model.as_deref(), Some("gemini-3.1-pro"));
        assert_eq!(
            first.transcript_path.as_deref(),
            Some(
                "/home/u/.gemini/antigravity/brain/ec33ebf9-0cba-4100-8142-c61503f6c587/.system_generated/logs/transcript.jsonl"
            )
        );
        assert_eq!(
            hook("PreInvocation", json!({ "invocationNum": 4 })).unwrap().kind,
            Some(SessionEventKind::ToolFinished { tool: "model".into(), failed: false })
        );
        assert_eq!(
            hook(
                "PostToolUse",
                json!({ "stepIdx": 5, "error": "exit status 1", "toolCall": { "name": "run_command" } })
            )
            .unwrap()
            .kind,
            Some(SessionEventKind::ToolFinished { tool: "run_command".into(), failed: true })
        );
        assert_eq!(hook("PostInvocation", json!({})).unwrap().kind, None);
        let stop = json!({ "executionNum": 1, "terminationReason": "model_stop", "fullyIdle": true });
        assert_eq!(hook("Stop", stop).unwrap().kind, Some(SessionEventKind::TurnEnded));
    }

    #[test]
    fn the_given_transcript_path_wins_and_unknown_events_are_ignored() {
        let t = hook("Stop", json!({ "transcriptPath": "/w/.gemini/antigravity/transcript.jsonl" })).unwrap();
        assert_eq!(t.transcript_path.as_deref(), Some("/w/.gemini/antigravity/transcript.jsonl"));
        assert!(hook("PreToolUse", json!({})).is_none());
    }
}
