//! Incremental reading of Claude Code's JSONL transcripts.
//!
//! `<project>/<session>.jsonl` is the main conversation; subagents live in
//! `<project>/<session>/subagents/agent-<id>.jsonl` with an `agent-<id>.meta.json` next to it.

use super::pricing;
use crate::jsonl::{Follow, cap, head_lines, local_day, parse_iso_ms, tail_lines};
use crate::tools::tool_label;
use awr_application::ports::{
    AgentTranscript, SubagentDetail, TimelineItem, TimelineKind, TouchedFile, TranscriptReader, TranscriptSummary,
    Usage,
};
use chrono::{Local, NaiveDate};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The first read covers the whole transcript so token totals are complete; only absurdly large
/// ones start this far from the end (the title and last prompt repeat often, so the tail suffices).
const INITIAL_TAIL_BYTES: u64 = 64 * 1024 * 1024;
/// Safety cap for a reply; it is kept as is (Markdown, line breaks).
const REPLY_MAX_CHARS: usize = 20_000;
/// Head of the file searched for the session's first prompt.
const HEAD_BYTES: u64 = 512 * 1024;
/// Tail read for the conversation preview.
const TIMELINE_TAIL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Default)]
pub struct ClaudeTranscriptReader {
    files: Mutex<HashMap<PathBuf, Tail>>,
    descriptions: Mutex<HashMap<PathBuf, Option<String>>>,
    first_prompts: Mutex<HashMap<PathBuf, String>>,
}

#[derive(Default)]
struct Tail {
    follow: Follow,
    state: State,
}

#[derive(Default, Clone)]
struct State {
    facts: Facts,
    /// API message ids already counted: each message is written as several lines (one per content
    /// block), all repeating the same usage.
    seen_messages: HashSet<String>,
}

#[derive(Default, Clone)]
struct Facts {
    ai_title: Option<String>,
    custom_title: Option<String>,
    last_prompt: Option<String>,
    last_reply: Option<String>,
    last_action: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    context_tokens: Option<u64>,
    usage: Usage,
    /// Usage per local calendar day, for "today".
    daily: BTreeMap<NaiveDate, Usage>,
}

impl ClaudeTranscriptReader {
    pub fn new() -> Self {
        Self::default()
    }

    fn facts(&self, path: &Path) -> Option<Facts> {
        let mut files = self.files.lock().unwrap();
        let tail = files.entry(path.to_path_buf()).or_default();
        advance(path, tail).ok()?;
        Some(tail.state.facts.clone())
    }

    /// The session's first prompt. Searched for in the head only once: it never changes.
    fn first_prompt(&self, path: &Path) -> Option<String> {
        if let Some(known) = self.first_prompts.lock().unwrap().get(path) {
            return Some(known.clone());
        }
        let prompt = head_lines(path, HEAD_BYTES)
            .ok()?
            .iter()
            .flat_map(|e| timeline_items(e, false))
            .find(|i| i.kind == TimelineKind::Prompt)?
            .text;
        self.first_prompts.lock().unwrap().insert(path.to_path_buf(), prompt.clone());
        Some(prompt)
    }

    fn description(&self, meta: &Path) -> Option<String> {
        let mut cache = self.descriptions.lock().unwrap();
        if let Some(known) = cache.get(meta) {
            return known.clone();
        }
        let description = std::fs::read_to_string(meta)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|v| v.get("description")?.as_str().map(str::to_owned));
        // Only hits are cached: the meta file may appear after SubagentStart.
        if description.is_some() {
            cache.insert(meta.to_path_buf(), description.clone());
        }
        description
    }
}

impl TranscriptReader for ClaudeTranscriptReader {
    fn read(&self, transcript_path: &str, subagent_ids: &[String]) -> Option<TranscriptSummary> {
        let main = Path::new(transcript_path);
        let facts = self.facts(main)?;
        let subagent_dir = main.with_extension("").join("subagents");
        let subagents = subagent_ids
            .iter()
            .map(|id| {
                let facts = self.facts(&subagent_dir.join(format!("agent-{id}.jsonl"))).unwrap_or_default();
                SubagentDetail {
                    id: id.clone(),
                    description: self.description(&subagent_dir.join(format!("agent-{id}.meta.json"))),
                    last_tool: facts.last_action,
                    model: facts.model,
                    effort: facts.effort,
                }
            })
            .collect();

        let today = Local::now().date_naive();
        let mut usage = facts.usage;
        let mut usage_today = facts.daily.get(&today).copied().unwrap_or_default();
        // Every subagent file, not only the ones still listed: finished ones also cost.
        for sub in subagent_transcripts(&subagent_dir) {
            if let Some(f) = self.facts(&sub) {
                usage.add(&f.usage);
                usage_today.add(&f.daily.get(&today).copied().unwrap_or_default());
            }
        }

        Some(TranscriptSummary {
            context_window: facts.model.as_deref().and_then(pricing::context_window),
            usage,
            usage_today,
            title: facts.custom_title.or(facts.ai_title),
            first_prompt: self.first_prompt(main),
            last_prompt: facts.last_prompt,
            last_reply: facts.last_reply,
            last_action: facts.last_action,
            model: facts.model,
            effort: facts.effort,
            context_tokens: facts.context_tokens,
            subagents,
        })
    }

    fn recent(&self, transcript_path: &str, limit: usize) -> Vec<TimelineItem> {
        let Ok(lines) = tail_lines(Path::new(transcript_path), TIMELINE_TAIL_BYTES) else {
            return Vec::new();
        };
        let mut items: Vec<TimelineItem> = lines.iter().flat_map(|e| timeline_items(e, false)).collect();
        let skip = items.len().saturating_sub(limit);
        items.drain(..skip);
        items
    }

    fn touched_files(&self, transcript_path: &str) -> Vec<TouchedFile> {
        let main = Path::new(transcript_path);
        let mut files = vec![main.to_path_buf()];
        files.extend(subagent_transcripts(&main.with_extension("").join("subagents")));
        let mut touched: BTreeMap<String, TouchedFile> = BTreeMap::new();
        for file in files {
            let Ok(lines) = head_lines(&file, u64::MAX) else { continue };
            for entry in lines.iter().filter(|e| e.get("type").and_then(Value::as_str) == Some("assistant")) {
                for block in entry.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
                    let Some(name) = block.get("name").and_then(Value::as_str) else { continue };
                    if !matches!(name, "Edit" | "MultiEdit" | "Write" | "NotebookEdit") {
                        continue;
                    }
                    let input = block.get("input");
                    let path = ["file_path", "notebook_path"]
                        .iter()
                        .find_map(|k| input.and_then(|i| i.get(*k)).and_then(Value::as_str));
                    let Some(path) = path else { continue };
                    let entry = touched.entry(path.to_owned()).or_insert_with(|| TouchedFile {
                        path: path.to_owned(),
                        edits: 0,
                        written: false,
                    });
                    entry.edits += 1;
                    entry.written |= name == "Write";
                }
            }
        }
        touched.into_values().collect()
    }

    fn subagent(&self, transcript_path: &str, agent_id: &str, limit: usize) -> Option<AgentTranscript> {
        // The id ends up in a path: only its alphabet, no `..` or `/`.
        if agent_id.is_empty() || !agent_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return None;
        }
        let path =
            Path::new(transcript_path).with_extension("").join("subagents").join(format!("agent-{agent_id}.jsonl"));
        let first_prompt = head_lines(&path, HEAD_BYTES)
            .ok()?
            .iter()
            .flat_map(|e| timeline_items(e, true))
            .find(|i| i.kind == TimelineKind::Prompt)
            .map(|i| i.text);
        let mut timeline: Vec<TimelineItem> =
            tail_lines(&path, TIMELINE_TAIL_BYTES).ok()?.iter().flat_map(|e| timeline_items(e, true)).collect();
        let last_reply = timeline.iter().rev().find(|i| i.kind == TimelineKind::Reply).map(|i| i.text.clone());
        let skip = timeline.len().saturating_sub(limit);
        timeline.drain(..skip);
        Some(AgentTranscript { first_prompt, last_reply, timeline })
    }
}

/// `agent-*.jsonl` files in a session's `subagents/` directory.
fn subagent_transcripts(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            name.starts_with("agent-") && name.ends_with(".jsonl")
        })
        .collect();
    files.sort();
    files
}

/// Adds an API message's usage and estimated cost once, however many lines repeat it.
fn count_usage(facts: &mut Facts, seen: &mut HashSet<String>, entry: &Value) {
    let Some(usage) = entry.pointer("/message/usage") else { return };
    if let Some(id) = entry.pointer("/message/id").and_then(Value::as_str)
        && !seen.insert(id.to_owned())
    {
        return;
    }
    let n = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
    let (write_5m, write_1h) = match usage.get("cache_creation") {
        Some(split) => (
            split.get("ephemeral_5m_input_tokens").and_then(Value::as_u64).unwrap_or(0),
            split.get("ephemeral_1h_input_tokens").and_then(Value::as_u64).unwrap_or(0),
        ),
        None => (n("cache_creation_input_tokens"), 0),
    };
    let mut message = Usage {
        input_tokens: n("input_tokens"),
        output_tokens: n("output_tokens"),
        cache_read_tokens: n("cache_read_input_tokens"),
        cache_write_tokens: write_5m + write_1h,
        ..Usage::default()
    };
    // $/MTok × tokens = millionths of a dollar.
    match model_of(entry).or_else(|| facts.model.clone()).as_deref().and_then(pricing::price) {
        Some(p) => {
            let micros = message.input_tokens as f64 * p.input
                + message.output_tokens as f64 * p.output
                + message.cache_read_tokens as f64 * p.cache_read
                + write_5m as f64 * p.cache_write_5m()
                + write_1h as f64 * p.cache_write_1h();
            message.cost_micros = micros.round() as u64;
        }
        None => message.unpriced_messages = 1,
    }
    facts.usage.add(&message);
    let day = entry.get("timestamp").and_then(Value::as_str).and_then(parse_iso_ms).and_then(local_day);
    if let Some(day) = day {
        facts.daily.entry(day).or_default().add(&message);
    }
}

/// `sidechain`: reading a subagent's transcript, whose entries are all marked as such. In the
/// main one they are dropped (each subagent has its own file).
fn timeline_items(entry: &Value, sidechain: bool) -> Vec<TimelineItem> {
    if (!sidechain && entry.get("isSidechain").and_then(Value::as_bool) == Some(true))
        || entry.get("isMeta").and_then(Value::as_bool) == Some(true)
    {
        return Vec::new();
    }
    let at = entry.get("timestamp").and_then(Value::as_str).and_then(parse_iso_ms);
    let item = |kind, text: String| TimelineItem { kind, text, at, model: None, effort: None };
    let by_agent =
        |kind, text: String| TimelineItem { kind, text, at, model: model_of(entry), effort: effort_of(entry) };
    match entry.get("type").and_then(Value::as_str) {
        Some("user") => match entry.pointer("/message/content") {
            Some(Value::String(prompt)) if !prompt.starts_with('<') && !prompt.trim().is_empty() => {
                vec![item(TimelineKind::Prompt, cap(prompt.trim(), REPLY_MAX_CHARS))]
            }
            Some(Value::Array(blocks)) => blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .filter(|t| !t.starts_with('<') && !t.trim().is_empty())
                .map(|t| item(TimelineKind::Prompt, cap(t.trim(), REPLY_MAX_CHARS)))
                .collect(),
            _ => Vec::new(),
        },
        Some("assistant") => entry
            .pointer("/message/content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|block| match block.get("type").and_then(Value::as_str) {
                Some("text") => block
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|t| !t.is_empty())
                    .map(|t| by_agent(TimelineKind::Reply, cap(t, REPLY_MAX_CHARS))),
                Some("tool_use") => block
                    .get("name")
                    .and_then(Value::as_str)
                    .map(|name| by_agent(TimelineKind::Tool, tool_label(name, block.get("input")))),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Reads the new complete lines and absorbs them.
fn advance(path: &Path, tail: &mut Tail) -> std::io::Result<()> {
    tail.follow.advance(path, INITIAL_TAIL_BYTES, &mut tail.state, |state, entry| {
        absorb(&mut state.facts, &mut state.seen_messages, entry)
    })
}

fn absorb(facts: &mut Facts, seen: &mut HashSet<String>, entry: &Value) {
    let text = |key: &str| entry.get(key).and_then(Value::as_str).map(str::to_owned);
    match entry.get("type").and_then(Value::as_str) {
        Some("ai-title") => facts.ai_title = text("aiTitle").or(facts.ai_title.take()),
        Some("custom-title") => facts.custom_title = text("customTitle").or(facts.custom_title.take()),
        Some("last-prompt") => facts.last_prompt = text("lastPrompt").or(facts.last_prompt.take()),
        Some("user") => {
            // Fallback when there is no `last-prompt`: the last message typed by a person.
            if let Some(prompt) = entry.pointer("/message/content").and_then(Value::as_str)
                && !prompt.starts_with('<')
            {
                facts.last_prompt = Some(prompt.to_owned());
            }
        }
        Some("assistant") => {
            absorb_assistant(facts, entry);
            count_usage(facts, seen, entry);
        }
        _ => {}
    }
}

/// The message's real model (synthetic ones come as `<synthetic>`).
fn model_of(entry: &Value) -> Option<String> {
    entry.pointer("/message/model").and_then(Value::as_str).filter(|m| !m.starts_with('<')).map(str::to_owned)
}

fn effort_of(entry: &Value) -> Option<String> {
    entry.get("effort").and_then(Value::as_str).filter(|e| !e.is_empty()).map(str::to_owned)
}

fn absorb_assistant(facts: &mut Facts, entry: &Value) {
    let Some(message) = entry.get("message") else { return };
    if let Some(model) = model_of(entry) {
        facts.model = Some(model);
    }
    if let Some(effort) = effort_of(entry) {
        facts.effort = Some(effort);
    }
    if let Some(usage) = message.get("usage") {
        let n = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
        let total = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
        if total > 0 {
            facts.context_tokens = Some(total);
        }
    }
    for block in message.get("content").and_then(Value::as_array).into_iter().flatten() {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(t) = block.get("text").and_then(Value::as_str).map(str::trim)
                    && !t.is_empty()
                {
                    facts.last_reply = Some(cap(t, REPLY_MAX_CHARS));
                }
            }
            Some("tool_use") => {
                if let Some(name) = block.get("name").and_then(Value::as_str) {
                    facts.last_action = Some(tool_label(name, block.get("input")));
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    fn line(v: Value) -> String {
        format!("{v}\n")
    }

    fn assistant(content: Value) -> String {
        line(json!({
            "type": "assistant",
            "effort": "high",
            "message": {
                "model": "claude-opus-5-5",
                "content": content,
                "usage": { "input_tokens": 2, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 500, "output_tokens": 9 }
            }
        }))
    }

    fn append(path: &Path, text: &str) {
        std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap().write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn summarizes_title_prompt_reply_action_and_context() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "Fix login" })));
        append(&path, &line(json!({ "type": "user", "message": { "role": "user", "content": "fix the login" } })));
        append(
            &path,
            &assistant(
                json!([{ "type": "text", "text": "Let me look.\n\nFirst" }, { "type": "tool_use", "name": "Read", "input": { "file_path": "/src/auth/login.rs" } }]),
            ),
        );

        let reader = ClaudeTranscriptReader::new();
        let s = reader.read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("Fix login"));
        assert_eq!(s.last_prompt.as_deref(), Some("fix the login"));
        assert_eq!(s.last_reply.as_deref(), Some("Let me look.\n\nFirst"), "keeps the Markdown");
        assert_eq!(s.last_action.as_deref(), Some("Read · login.rs"));
        assert_eq!(s.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(s.effort.as_deref(), Some("high"));
        assert_eq!(s.context_tokens, Some(1502));
    }

    #[test]
    fn reads_incrementally_and_ignores_half_written_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(
            &path,
            &assistant(json!([{ "type": "tool_use", "name": "Bash", "input": { "command": "cargo test" } }])),
        );
        let reader = ClaudeTranscriptReader::new();
        assert_eq!(reader.read(path.to_str().unwrap(), &[]).unwrap().last_action.as_deref(), Some("Bash · cargo test"));

        append(&path, "{\"type\":\"custom-title\",\"customTitle\":\"My");
        let s = reader.read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title, None, "half-written line: not yet");

        append(&path, " session\"}\n");
        let s = reader.read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("My session"));
        assert_eq!(s.last_action.as_deref(), Some("Bash · cargo test"), "keeps what was read before");
    }

    #[test]
    fn custom_title_wins_over_ai_title() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(&path, &line(json!({ "type": "custom-title", "customTitle": "Mine" })));
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "From the AI" })));
        let s = ClaudeTranscriptReader::new().read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("Mine"));
    }

    #[test]
    fn subagents_get_description_and_current_tool() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "x" })));
        let subs = dir.path().join("s/subagents");
        std::fs::create_dir_all(&subs).unwrap();
        std::fs::write(
            subs.join("agent-a1.meta.json"),
            r#"{"agentType":"Explore","description":"Find usages of login"}"#,
        )
        .unwrap();
        append(
            &subs.join("agent-a1.jsonl"),
            &assistant(json!([{ "type": "tool_use", "name": "Grep", "input": { "pattern": "fn login" } }])),
        );

        let s = ClaudeTranscriptReader::new().read(path.to_str().unwrap(), &["a1".into(), "a2".into()]).unwrap();
        assert_eq!(s.subagents[0].description.as_deref(), Some("Find usages of login"));
        assert_eq!(s.subagents[0].last_tool.as_deref(), Some("Grep · fn login"));
        assert_eq!(s.subagents[0].model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(s.subagents[1], SubagentDetail { id: "a2".into(), ..Default::default() });
    }

    #[test]
    fn long_transcripts_start_from_the_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let filler = line(json!({ "type": "user", "message": { "content": "x".repeat(1000) } }));
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "Old" })));
        append(&path, &filler.repeat(700));
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "Recent" })));
        let s = ClaudeTranscriptReader::new().read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("Recent"));
    }

    #[test]
    fn recent_timeline_has_prompts_replies_and_tools_in_order_without_noise() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(
            &path,
            &line(
                json!({ "type": "user", "timestamp": "2026-09-27T22:44:39.232Z", "message": { "content": "fix the **login**" } }),
            ),
        );
        append(
            &path,
            &line(json!({ "type": "user", "message": { "content": "<command-name>/clear</command-name>" } })),
        );
        append(&path, &line(json!({ "type": "user", "isMeta": true, "message": { "content": "meta" } })));
        append(
            &path,
            &assistant(json!([{ "type": "tool_use", "name": "Read", "input": { "file_path": "/a/login.rs" } }])),
        );
        append(
            &path,
            &line(json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "..." }] } })),
        );
        append(
            &path,
            &line(
                json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "from a subagent" }] } }),
            ),
        );
        append(&path, &assistant(json!([{ "type": "text", "text": "## Done\n\n- one\n- two" }])));

        let items = ClaudeTranscriptReader::new().recent(path.to_str().unwrap(), 10);
        let kinds: Vec<_> = items.iter().map(|i| (i.kind, i.text.as_str())).collect();
        assert_eq!(
            kinds,
            vec![
                (TimelineKind::Prompt, "fix the **login**"),
                (TimelineKind::Tool, "Read · login.rs"),
                (TimelineKind::Reply, "## Done\n\n- one\n- two"),
            ]
        );
        assert_eq!(items[0].at, Some(1_790_549_079_232));
        assert_eq!(
            (items[0].model.as_deref(), items[2].model.as_deref()),
            (None, Some("claude-opus-5-5")),
            "only the agent's items"
        );
        assert_eq!(items[2].effort.as_deref(), Some("high"));

        let last = ClaudeTranscriptReader::new().recent(path.to_str().unwrap(), 1);
        assert_eq!(last.len(), 1);
        assert_eq!(last[0].kind, TimelineKind::Reply);
    }

    #[test]
    fn remembers_the_first_prompt_even_when_the_transcript_is_long() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(&path, &line(json!({ "type": "user", "message": { "content": "<command-name>/init</command-name>" } })));
        append(&path, &line(json!({ "type": "user", "message": { "content": "Migrate the login to OAuth" } })));
        let filler = line(json!({ "type": "user", "message": { "content": "x".repeat(1000) } }));
        append(&path, &filler.repeat(700));
        let s = ClaudeTranscriptReader::new().read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.first_prompt.as_deref(), Some("Migrate the login to OAuth"));
    }

    #[test]
    fn reads_what_a_subagent_was_asked_and_did() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "x" })));
        let subs = dir.path().join("s/subagents");
        std::fs::create_dir_all(&subs).unwrap();
        let sub = subs.join("agent-a1.jsonl");
        append(
            &sub,
            &line(json!({ "type": "user", "isSidechain": true, "message": { "content": "Find the usages of login" } })),
        );
        append(
            &sub,
            &line(
                json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "tool_use", "name": "Grep", "input": { "pattern": "login" } }] } }),
            ),
        );
        append(
            &sub,
            &line(
                json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "There are **3** usages." }] } }),
            ),
        );

        let reader = ClaudeTranscriptReader::new();
        let t = reader.subagent(path.to_str().unwrap(), "a1", 10).unwrap();
        assert_eq!(t.first_prompt.as_deref(), Some("Find the usages of login"));
        assert_eq!(t.last_reply.as_deref(), Some("There are **3** usages."));
        assert_eq!(t.timeline.len(), 3);

        assert!(reader.subagent(path.to_str().unwrap(), "../../etc/passwd", 10).is_none());
        assert!(reader.subagent(path.to_str().unwrap(), "nobody", 10).is_none());
    }

    #[test]
    fn counts_each_api_message_once_and_prices_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let block = |text: &str| {
            line(json!({
                "type": "assistant",
                "timestamp": "2026-09-27T10:00:00.000Z",
                "message": {
                    "id": "msg_1",
                    "model": "claude-opus-5-5",
                    "content": [{ "type": "text", "text": text }],
                    "usage": {
                        "input_tokens": 1_000,
                        "output_tokens": 1_000_000,
                        "cache_read_input_tokens": 1_000_000,
                        "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 1_000_000 }
                    }
                }
            }))
        };
        // Same message written as three lines (one per content block).
        append(&path, &block("a"));
        append(&path, &block("b"));
        append(&path, &block("c"));
        let subs = dir.path().join("s/subagents");
        std::fs::create_dir_all(&subs).unwrap();
        append(
            &subs.join("agent-old.jsonl"),
            &line(json!({
                "type": "assistant",
                "message": { "id": "msg_sub", "model": "claude-haiku-4-5", "content": [], "usage": { "input_tokens": 1_000_000, "output_tokens": 0 } }
            })),
        );

        let s = ClaudeTranscriptReader::new().read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.usage.output_tokens, 1_000_000, "counted once");
        assert_eq!(s.usage.input_tokens, 1_001_000, "includes finished subagents not listed");
        // opus-5-5: 1k×$4 + 1M out×$20 + 1M read×$0.20 + 1M 1h-write×$8 = $28.204; haiku 1M in = $1.
        assert_eq!(s.usage.cost_micros, 29_204_000);
        assert_eq!(s.context_window, Some(1_000_000));
    }

    #[test]
    fn lists_files_edited_by_the_session_and_its_subagents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let tool = |name: &str, file: &str| {
            line(
                json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": name, "input": { "file_path": file } }] } }),
            )
        };
        append(&path, &tool("Edit", "/r/a.rs"));
        append(&path, &tool("Edit", "/r/a.rs"));
        append(&path, &tool("Read", "/r/ignored.rs"));
        let subs = dir.path().join("s/subagents");
        std::fs::create_dir_all(&subs).unwrap();
        append(&subs.join("agent-x.jsonl"), &tool("Write", "/r/new.md"));

        let files = ClaudeTranscriptReader::new().touched_files(path.to_str().unwrap());
        let got: Vec<_> = files.iter().map(|f| (f.path.as_str(), f.edits, f.written)).collect();
        assert_eq!(got, vec![("/r/a.rs", 2, false), ("/r/new.md", 1, true)]);
    }

    #[test]
    fn missing_transcript_reads_as_none() {
        assert!(ClaudeTranscriptReader::new().read("/does/not/exist.jsonl", &[]).is_none());
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// Manual: `AWR_TRANSCRIPT=/path/session.jsonl AWR_SUBAGENTS=id1,id2 cargo test -p awr-infrastructure
    /// transcript_live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn transcript_live_summarizes_a_real_session() {
        let path = std::env::var("AWR_TRANSCRIPT").expect("AWR_TRANSCRIPT");
        let subagents: Vec<String> =
            std::env::var("AWR_SUBAGENTS").map(|s| s.split(',').map(str::to_owned).collect()).unwrap_or_default();
        let started = std::time::Instant::now();
        let reader = ClaudeTranscriptReader::new();
        let summary = reader.read(&path, &subagents).expect("readable transcript");
        let first = started.elapsed();
        let started = std::time::Instant::now();
        reader.read(&path, &subagents);
        println!("{summary:#?}\nfirst read {first:?}, incremental {:?}", started.elapsed());
    }
}
