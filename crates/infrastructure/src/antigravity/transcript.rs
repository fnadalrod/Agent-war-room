//! Antigravity's step transcripts (`transcript.jsonl`, one step per line): `USER_INPUT` (your text,
//! inside `<USER_REQUEST>`), `PLANNER_RESPONSE` (the agent's text and its `tool_calls`), tool steps
//! (`RUN_COMMAND`, `VIEW_FILE`…), each with `created_at`. Tool arguments are PascalCase
//! (`CommandLine`, `AbsolutePath`, `TargetFile`, `Query`). No model or tokens (the model comes from
//! the hooks) and no subagent files.

use crate::jsonl::{Follow, cap, head_lines, parse_iso_ms, tail_lines};
use crate::tools::tool_label;
use awr_application::ports::{
    AgentTranscript, TimelineItem, TimelineKind, TouchedFile, TranscriptReader, TranscriptSummary,
};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const INITIAL_TAIL_BYTES: u64 = 64 * 1024 * 1024;
const REPLY_MAX_CHARS: usize = 20_000;
const HEAD_BYTES: u64 = 512 * 1024;
const TIMELINE_TAIL_BYTES: u64 = 2 * 1024 * 1024;
/// Tools that write files, and whether they write it whole.
const EDIT_TOOLS: &[(&str, bool)] =
    &[("write_to_file", true), ("replace_file_content", false), ("multi_replace_file_content", false)];

#[derive(Default)]
pub struct AntigravityTranscriptReader {
    files: Mutex<HashMap<PathBuf, (Follow, Facts)>>,
}

#[derive(Default, Clone)]
struct Facts {
    last_prompt: Option<String>,
    last_reply: Option<String>,
    last_action: Option<String>,
}

impl AntigravityTranscriptReader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl TranscriptReader for AntigravityTranscriptReader {
    fn read(&self, transcript_path: &str, _subagent_ids: &[String]) -> Option<TranscriptSummary> {
        let path = Path::new(transcript_path);
        let facts = {
            let mut files = self.files.lock().unwrap();
            let (follow, facts) = files.entry(path.to_path_buf()).or_default();
            follow
                .advance(path, INITIAL_TAIL_BYTES, facts, |facts, step| {
                    for item in items(step) {
                        match item.kind {
                            TimelineKind::Prompt => facts.last_prompt = Some(item.text),
                            TimelineKind::Reply => facts.last_reply = Some(item.text),
                            TimelineKind::Tool => facts.last_action = Some(item.text),
                        }
                    }
                })
                .ok()?;
            facts.clone()
        };
        let first_prompt = head_lines(path, HEAD_BYTES)
            .ok()?
            .iter()
            .flat_map(items)
            .find(|i| i.kind == TimelineKind::Prompt)
            .map(|i| i.text);
        Some(TranscriptSummary {
            first_prompt,
            last_prompt: facts.last_prompt,
            last_reply: facts.last_reply,
            last_action: facts.last_action,
            ..TranscriptSummary::default()
        })
    }

    fn recent(&self, transcript_path: &str, limit: usize) -> Vec<TimelineItem> {
        let Ok(steps) = tail_lines(Path::new(transcript_path), TIMELINE_TAIL_BYTES) else { return Vec::new() };
        let items: Vec<TimelineItem> = steps.iter().flat_map(items).collect();
        let skip = items.len().saturating_sub(limit);
        items.into_iter().skip(skip).collect()
    }

    fn subagent(&self, _: &str, _: &str, _: usize) -> Option<AgentTranscript> {
        None
    }

    fn touched_files(&self, transcript_path: &str) -> Vec<TouchedFile> {
        let Ok(steps) = head_lines(Path::new(transcript_path), u64::MAX) else { return Vec::new() };
        let mut touched: BTreeMap<String, TouchedFile> = BTreeMap::new();
        for call in steps.iter().flat_map(tool_calls) {
            let Some(name) = call.get("name").and_then(Value::as_str) else { continue };
            let Some((_, whole)) = EDIT_TOOLS.iter().find(|(tool, _)| *tool == name) else { continue };
            let args = call.get("args");
            let Some(path) = ["TargetFile", "AbsolutePath"].iter().find_map(|k| args?.get(*k)?.as_str()) else {
                continue;
            };
            let entry = touched.entry(path.to_owned()).or_insert_with(|| TouchedFile {
                path: path.to_owned(),
                edits: 0,
                written: false,
            });
            entry.edits += 1;
            entry.written |= *whole;
        }
        touched.into_values().collect()
    }
}

fn tool_calls(step: &Value) -> impl Iterator<Item = &Value> {
    step.get("tool_calls").and_then(Value::as_array).into_iter().flatten()
}

/// What you asked, inside `<USER_REQUEST>…</USER_REQUEST>`.
fn user_request(text: &str) -> Option<String> {
    let inner = match (text.find("<USER_REQUEST>"), text.rfind("</USER_REQUEST>")) {
        (Some(start), Some(end)) if end > start => &text[start + "<USER_REQUEST>".len()..end],
        _ => text,
    };
    let inner = inner.trim();
    (!inner.is_empty()).then(|| cap(inner, REPLY_MAX_CHARS))
}

/// Antigravity's PascalCase arguments under the names `tool_label` knows.
fn label(call: &Value) -> Option<String> {
    let name = call.get("name")?.as_str()?;
    let args = call.get("args");
    let arg = |k: &str| args.and_then(|a| a.get(k)).cloned();
    let mut known = Map::new();
    for (theirs, ours) in [
        ("CommandLine", "command"),
        ("TargetFile", "file_path"),
        ("AbsolutePath", "file_path"),
        ("Query", "pattern"),
        ("Url", "url"),
    ] {
        if let Some(v) = arg(theirs) {
            known.entry(ours).or_insert(v);
        }
    }
    Some(tool_label(name, Some(&Value::Object(known))))
}

fn items(step: &Value) -> Vec<TimelineItem> {
    let at = step.get("created_at").and_then(Value::as_str).and_then(parse_iso_ms);
    let item = |kind, text| TimelineItem { kind, text, at, model: None, effort: None };
    let content = step.get("content").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty());
    match step.get("type").and_then(Value::as_str) {
        Some("USER_INPUT") => {
            content.and_then(user_request).map(|t| item(TimelineKind::Prompt, t)).into_iter().collect()
        }
        Some("PLANNER_RESPONSE") => content
            .map(|t| item(TimelineKind::Reply, cap(t, REPLY_MAX_CHARS)))
            .into_iter()
            .chain(tool_calls(step).filter_map(label).map(|l| item(TimelineKind::Tool, l)))
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Shaped like the transcripts Antigravity 2.13 writes (structure only, invented content).
    fn transcript(dir: &Path) -> PathBuf {
        let steps = [
            json!({ "step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "status": "DONE", "created_at": "2026-09-13T22:03:52Z", "content": "<USER_REQUEST>\nFix the login\n</USER_REQUEST>" }),
            json!({ "step_index": 1, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE", "created_at": "2026-09-13T22:03:53Z", "content": "", "thinking": "…", "tool_calls": [{ "name": "run_command", "args": { "CommandLine": "npm test", "Cwd": "/code/app", "toolSummary": "Run tests" } }] }),
            json!({ "step_index": 2, "source": "MODEL", "type": "RUN_COMMAND", "status": "DONE", "created_at": "2026-09-13T22:03:59Z", "content": "ok", "exit_code": 0 }),
            json!({ "step_index": 3, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE", "created_at": "2026-09-13T22:04:10Z", "content": "", "tool_calls": [{ "name": "replace_file_content", "args": { "TargetFile": "/code/app/login.ts", "Instruction": "x" } }, { "name": "write_to_file", "args": { "TargetFile": "/code/app/new.ts", "CodeContent": "" } }] }),
            json!({ "step_index": 4, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE", "created_at": "2026-09-13T22:04:30Z", "content": "Fixed the expired token." }),
        ];
        let path = dir.join("transcript.jsonl");
        std::fs::write(&path, steps.iter().map(|s| s.to_string() + "\n").collect::<String>()).unwrap();
        path
    }

    #[test]
    fn summarizes_and_lists_the_timeline_and_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path());
        let reader = AntigravityTranscriptReader::new();
        let s = reader.read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.first_prompt.as_deref(), Some("Fix the login"));
        assert_eq!(s.last_reply.as_deref(), Some("Fixed the expired token."));
        assert_eq!(s.last_action.as_deref(), Some("write_to_file · new.ts"));

        let timeline = reader.recent(path.to_str().unwrap(), 50);
        let texts: Vec<_> = timeline.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(
            texts,
            [
                "Fix the login",
                "run_command · npm test",
                "replace_file_content · login.ts",
                "write_to_file · new.ts",
                "Fixed the expired token."
            ]
        );
        assert!(timeline[0].at.is_some());

        let touched: Vec<_> =
            reader.touched_files(path.to_str().unwrap()).into_iter().map(|t| (t.path, t.written)).collect();
        assert_eq!(touched, [("/code/app/login.ts".into(), false), ("/code/app/new.ts".into(), true)]);
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// `AWR_ANTIGRAVITY_TRANSCRIPT=<file> cargo test -p awr-infrastructure antigravity_live -- --ignored --nocapture`
    #[test]
    #[ignore = "reads a real transcript from $AWR_ANTIGRAVITY_TRANSCRIPT"]
    fn antigravity_live_summarizes_a_real_transcript() {
        let Ok(path) = std::env::var("AWR_ANTIGRAVITY_TRANSCRIPT") else { return };
        let reader = AntigravityTranscriptReader::new();
        let s = reader.read(&path, &[]).expect("readable transcript");
        let chars = |t: Option<String>| t.map(|t| t.chars().count()).unwrap_or(0);
        println!("first prompt {} · last prompt {} · last reply {} chars", chars(s.first_prompt), chars(s.last_prompt), chars(s.last_reply));
        println!("last action: {} chars", chars(s.last_action));
        println!("timeline items: {}", reader.recent(&path, 50).len());
        println!("touched files: {}", reader.touched_files(&path).len());
    }
}
