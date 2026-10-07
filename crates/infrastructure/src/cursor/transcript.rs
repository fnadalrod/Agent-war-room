//! Cursor's agent transcripts: `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`, and
//! `<id>/subagents/<sub>.jsonl` (the same layout as Claude's). Lines are `{role, message: {content:
//! [{type: text|tool_use, …}]}}` plus `{type: "turn_ended", status}`; your text comes wrapped in
//! `<user_query>`. They carry no times, model or tokens: those come from the hooks ([`HookFacts`]).
//!
//! [`HookFacts`]: awr_application::ports::HookFacts

use crate::jsonl::{Follow, cap, head_lines, tail_lines};
use crate::tools::{clip, tool_label};
use awr_application::ports::{
    AgentTranscript, SubagentDetail, TimelineItem, TimelineKind, TouchedFile, TranscriptReader, TranscriptSummary,
};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const INITIAL_TAIL_BYTES: u64 = 64 * 1024 * 1024;
const REPLY_MAX_CHARS: usize = 20_000;
const HEAD_BYTES: u64 = 512 * 1024;
const TIMELINE_TAIL_BYTES: u64 = 2 * 1024 * 1024;
/// Tools that change files, with the argument that says which.
const EDIT_TOOLS: &[&str] = &["Write", "StrReplace", "Delete", "EditNotebook"];

#[derive(Default)]
pub struct CursorTranscriptReader {
    files: Mutex<HashMap<PathBuf, (Follow, Facts)>>,
}

#[derive(Default, Clone)]
struct Facts {
    last_prompt: Option<String>,
    last_reply: Option<String>,
    last_action: Option<String>,
}

impl CursorTranscriptReader {
    pub fn new() -> Self {
        Self::default()
    }

    fn facts(&self, path: &Path) -> Option<Facts> {
        let mut files = self.files.lock().unwrap();
        let (follow, facts) = files.entry(path.to_path_buf()).or_default();
        follow
            .advance(path, INITIAL_TAIL_BYTES, facts, |facts, entry| {
                for item in items(entry) {
                    match item.kind {
                        TimelineKind::Prompt => facts.last_prompt = Some(item.text),
                        TimelineKind::Reply => facts.last_reply = Some(item.text),
                        TimelineKind::Tool => facts.last_action = Some(item.text),
                    }
                }
            })
            .ok()?;
        Some(facts.clone())
    }
}

/// `<id>/subagents/<sub>.jsonl` next to `<id>/<id>.jsonl`, if the id is safe to put in a path.
fn subagent_path(main: &Path, id: &str) -> Option<PathBuf> {
    let safe = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    safe.then(|| main.parent().map(|dir| dir.join("subagents").join(format!("{id}.jsonl"))))?
}

fn first_prompt(path: &Path) -> Option<String> {
    head_lines(path, HEAD_BYTES).ok()?.iter().flat_map(items).find(|i| i.kind == TimelineKind::Prompt).map(|i| i.text)
}

impl TranscriptReader for CursorTranscriptReader {
    fn read(&self, transcript_path: &str, subagent_ids: &[String]) -> Option<TranscriptSummary> {
        let main = Path::new(transcript_path);
        let facts = self.facts(main)?;
        let subagents = subagent_ids
            .iter()
            .map(|id| {
                let path = subagent_path(main, id);
                let sub = path.as_deref().and_then(|p| self.facts(p)).unwrap_or_default();
                SubagentDetail {
                    id: id.clone(),
                    description: path.as_deref().and_then(first_prompt).map(|p| clip(&p, 60)),
                    last_tool: sub.last_action,
                    model: None,
                    effort: None,
                }
            })
            .collect();
        Some(TranscriptSummary {
            first_prompt: first_prompt(main),
            last_prompt: facts.last_prompt,
            last_reply: facts.last_reply,
            last_action: facts.last_action,
            subagents,
            ..TranscriptSummary::default()
        })
    }

    fn recent(&self, transcript_path: &str, limit: usize) -> Vec<TimelineItem> {
        recent_items(Path::new(transcript_path), limit)
    }

    fn subagent(&self, transcript_path: &str, agent_id: &str, limit: usize) -> Option<AgentTranscript> {
        let path = subagent_path(Path::new(transcript_path), agent_id)?;
        let timeline = recent_items(&path, usize::MAX);
        let last_reply = timeline.iter().rev().find(|i| i.kind == TimelineKind::Reply).map(|i| i.text.clone());
        let skip = timeline.len().saturating_sub(limit);
        Some(AgentTranscript {
            first_prompt: first_prompt(&path),
            last_reply,
            timeline: timeline.into_iter().skip(skip).collect(),
        })
    }

    fn touched_files(&self, transcript_path: &str) -> Vec<TouchedFile> {
        let main = Path::new(transcript_path);
        let mut files = vec![main.to_path_buf()];
        if let Some(dir) = main.parent().map(|d| d.join("subagents"))
            && let Ok(entries) = std::fs::read_dir(dir)
        {
            files.extend(entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "jsonl")));
        }
        let mut touched: BTreeMap<String, TouchedFile> = BTreeMap::new();
        for file in files {
            let Ok(lines) = head_lines(&file, u64::MAX) else { continue };
            for block in lines.iter().flat_map(blocks) {
                let Some(name) = block.get("name").and_then(Value::as_str).filter(|n| EDIT_TOOLS.contains(n)) else {
                    continue;
                };
                let Some(path) = block.pointer("/input/path").and_then(Value::as_str) else { continue };
                let entry = touched.entry(path.to_owned()).or_insert_with(|| TouchedFile {
                    path: path.to_owned(),
                    edits: 0,
                    written: false,
                });
                entry.edits += 1;
                entry.written |= name == "Write";
            }
        }
        touched.into_values().collect()
    }
}

fn recent_items(path: &Path, limit: usize) -> Vec<TimelineItem> {
    let lines = if limit == usize::MAX { head_lines(path, u64::MAX) } else { tail_lines(path, TIMELINE_TAIL_BYTES) };
    let Ok(lines) = lines else { return Vec::new() };
    let items: Vec<TimelineItem> = lines.iter().flat_map(items).collect();
    let skip = items.len().saturating_sub(limit);
    items.into_iter().skip(skip).collect()
}

fn blocks(entry: &Value) -> impl Iterator<Item = &Value> {
    entry.pointer("/message/content").and_then(Value::as_array).into_iter().flatten()
}

/// What you asked, inside `<user_query>…</user_query>` (the rest is context Cursor adds).
fn user_query(text: &str) -> Option<String> {
    let inner = match (text.find("<user_query>"), text.rfind("</user_query>")) {
        (Some(start), Some(end)) if end > start => &text[start + "<user_query>".len()..end],
        _ if text.trim_start().starts_with('<') => return None,
        _ => text,
    };
    let inner = inner.trim();
    (!inner.is_empty()).then(|| cap(inner, REPLY_MAX_CHARS))
}

fn items(entry: &Value) -> Vec<TimelineItem> {
    let role = entry.get("role").and_then(Value::as_str);
    let item = |kind, text| TimelineItem { kind, text, at: None, model: None, effort: None };
    blocks(entry)
        .filter_map(|block| match (role, block.get("type").and_then(Value::as_str)) {
            (Some("user"), Some("text")) => {
                block.get("text").and_then(Value::as_str).and_then(user_query).map(|t| item(TimelineKind::Prompt, t))
            }
            (Some("assistant"), Some("text")) => block
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(|t| item(TimelineKind::Reply, cap(t, REPLY_MAX_CHARS))),
            (Some("assistant"), Some("tool_use")) => block
                .get("name")
                .and_then(Value::as_str)
                .map(|name| item(TimelineKind::Tool, tool_label(name, block.get("input")))),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn line(v: Value) -> String {
        v.to_string() + "\n"
    }
    fn user(text: &str) -> String {
        line(json!({ "role": "user", "message": { "content": [{ "type": "text", "text": text }] } }))
    }
    fn assistant(blocks: Value) -> String {
        line(json!({ "role": "assistant", "message": { "content": blocks } }))
    }

    /// Shaped like the transcripts Cursor 3.18 writes (structure only, invented content).
    fn session(dir: &Path) -> PathBuf {
        let conv = dir.join("agent-transcripts/c1");
        fs::create_dir_all(conv.join("subagents")).unwrap();
        let main = conv.join("c1.jsonl");
        fs::write(
            &main,
            user("<timestamp>Monday, Sep 7, 2026, 12:04 AM (UTC+2)</timestamp>\n<user_query>\nFix the login\n</user_query>")
                + &assistant(json!([{ "type": "text", "text": "Looking." }, { "type": "tool_use", "name": "Shell", "input": { "command": "npm test", "description": "Run tests" } }]))
                + &assistant(json!([{ "type": "tool_use", "name": "StrReplace", "input": { "path": "/code/app/login.ts", "old_string": "a", "new_string": "b" } }]))
                + &assistant(json!([{ "type": "tool_use", "name": "Task", "input": { "description": "Check styles", "subagent_type": "explore", "prompt": "x" } }]))
                + &line(json!({ "type": "turn_ended", "status": "success" }))
                + &assistant(json!([{ "type": "text", "text": "Fixed: the token was expired." }])),
        )
        .unwrap();
        fs::write(
            conv.join("subagents/s1.jsonl"),
            user("<user_query>Check styles in login.css</user_query>")
                + &assistant(json!([{ "type": "tool_use", "name": "Write", "input": { "path": "/code/app/new.css", "contents": "" } }])),
        )
        .unwrap();
        main
    }

    #[test]
    fn summarizes_prompt_reply_action_and_subagents() {
        let dir = tempfile::tempdir().unwrap();
        let main = session(dir.path());
        let s = CursorTranscriptReader::new().read(main.to_str().unwrap(), &["s1".into()]).unwrap();
        assert_eq!(s.first_prompt.as_deref(), Some("Fix the login"), "without Cursor's wrapper");
        assert_eq!(s.last_reply.as_deref(), Some("Fixed: the token was expired."));
        assert_eq!(s.last_action.as_deref(), Some("Task · Check styles"));
        assert_eq!(s.model, None, "Cursor's transcript has no model: it comes from the hooks");
        assert_eq!(s.subagents[0].description.as_deref(), Some("Check styles in login.css"));
        assert_eq!(s.subagents[0].last_tool.as_deref(), Some("Write · new.css"));
    }

    #[test]
    fn timeline_edits_and_subagent_preview() {
        let dir = tempfile::tempdir().unwrap();
        let main = session(dir.path());
        let reader = CursorTranscriptReader::new();
        let kinds: Vec<_> = reader.recent(main.to_str().unwrap(), 50).into_iter().map(|i| i.kind).collect();
        use TimelineKind::*;
        assert_eq!(kinds, [Prompt, Reply, Tool, Tool, Tool, Reply]);
        let touched: Vec<_> =
            reader.touched_files(main.to_str().unwrap()).into_iter().map(|t| (t.path, t.written)).collect();
        assert_eq!(touched, [("/code/app/login.ts".into(), false), ("/code/app/new.css".into(), true)]);
        let sub = reader.subagent(main.to_str().unwrap(), "s1", 10).unwrap();
        assert_eq!(sub.first_prompt.as_deref(), Some("Check styles in login.css"));
        assert!(reader.subagent(main.to_str().unwrap(), "../x", 10).is_none());
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// `AWR_CURSOR_TRANSCRIPT=<file> cargo test -p awr-infrastructure cursor_live -- --ignored --nocapture`
    #[test]
    #[ignore = "reads a real transcript from $AWR_CURSOR_TRANSCRIPT"]
    fn cursor_live_summarizes_a_real_transcript() {
        let Ok(path) = std::env::var("AWR_CURSOR_TRANSCRIPT") else { return };
        let reader = CursorTranscriptReader::new();
        let s = reader.read(&path, &[]).expect("readable transcript");
        let chars = |t: Option<String>| t.map(|t| t.chars().count()).unwrap_or(0);
        println!("first prompt {} · last prompt {} · last reply {} chars", chars(s.first_prompt), chars(s.last_prompt), chars(s.last_reply));
        println!("last action: {} chars", chars(s.last_action));
        println!("timeline items: {}", reader.recent(&path, 50).len());
        println!("touched files: {}", reader.touched_files(&path).len());
    }
}
