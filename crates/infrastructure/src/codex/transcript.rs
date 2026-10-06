//! Incremental reading of Codex's rollout transcripts.
//!
//! `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`, one `{timestamp, type, payload}`
//! per line. The readable story is in `event_msg`/`item_completed` items (`UserMessage`,
//! `AgentMessage`, `CommandExecution`, `FileChange`, `McpToolCall`, `SubAgentActivity`); model and
//! effort in `turn_context`; tokens in `token_usage_record` (one per API response) and the context in
//! `token_count`. Each subagent is another thread with its own rollout; titles live in
//! `<CODEX_HOME>/session_index.jsonl`.

use crate::jsonl::{Follow, cap, head_lines, local_day, parse_iso_ms, tail_lines};
use crate::tools::{clip, tool_label};
use awr_application::ports::{
    AgentTranscript, SubagentDetail, TimelineItem, TimelineKind, TouchedFile, TranscriptReader, TranscriptSummary,
    Usage,
};
use chrono::{Local, NaiveDate};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// See the Claude reader: complete totals, except for absurdly large files.
const INITIAL_TAIL_BYTES: u64 = 64 * 1024 * 1024;
const REPLY_MAX_CHARS: usize = 20_000;
const HEAD_BYTES: u64 = 512 * 1024;
const TIMELINE_TAIL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Default)]
pub struct CodexTranscriptReader {
    files: Mutex<HashMap<PathBuf, (Follow, Facts)>>,
    /// Thread titles per `session_index.jsonl`, followed incrementally too.
    titles: Mutex<HashMap<PathBuf, (Follow, Titles)>>,
    first_prompts: Mutex<HashMap<PathBuf, String>>,
    /// Subagent thread id → its rollout, once found.
    rollouts: Mutex<HashMap<String, PathBuf>>,
}

/// Thread id → its latest name.
type Titles = HashMap<String, String>;

#[derive(Default, Clone)]
struct Facts {
    automatic_permission_review: bool,
    last_prompt: Option<String>,
    last_reply: Option<String>,
    last_action: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    context_tokens: Option<u64>,
    context_window: Option<u64>,
    usage: Usage,
    daily: BTreeMap<NaiveDate, Usage>,
    /// API responses already counted.
    seen_responses: HashSet<String>,
    /// Subagent threads this one spawned, with their name (`/root/trace_flow` → `trace_flow`).
    subagents: BTreeMap<String, Option<String>>,
}

impl CodexTranscriptReader {
    pub fn new() -> Self {
        Self::default()
    }

    fn facts(&self, path: &Path) -> Option<Facts> {
        let mut files = self.files.lock().unwrap();
        let (follow, facts) = files.entry(path.to_path_buf()).or_default();
        follow.advance(path, INITIAL_TAIL_BYTES, facts, absorb).ok()?;
        Some(facts.clone())
    }

    fn title(&self, rollout: &Path) -> Option<String> {
        let index = codex_home(rollout)?.join("session_index.jsonl");
        let id = thread_id(rollout)?;
        let mut titles = self.titles.lock().unwrap();
        let (follow, names) = titles.entry(index.clone()).or_default();
        follow
            .advance(&index, u64::MAX, names, |names, entry| {
                if let (Some(id), Some(name)) =
                    (entry.get("id").and_then(Value::as_str), entry.get("thread_name").and_then(Value::as_str))
                {
                    names.insert(id.to_owned(), name.to_owned());
                }
            })
            .ok()?;
        names.get(id).cloned()
    }

    /// The first thing you asked. Searched for in the head only once: it never changes.
    fn first_prompt(&self, path: &Path) -> Option<String> {
        if let Some(known) = self.first_prompts.lock().unwrap().get(path) {
            return Some(known.clone());
        }
        let prompt = head_lines(path, HEAD_BYTES)
            .ok()?
            .iter()
            .flat_map(|e| timeline_items(e, &mut Turn::default()))
            .find(|i| i.kind == TimelineKind::Prompt)?
            .text;
        self.first_prompts.lock().unwrap().insert(path.to_path_buf(), prompt.clone());
        Some(prompt)
    }

    /// The rollout of a subagent thread: next to its parent's, or anywhere under `sessions/`.
    fn rollout_of(&self, parent: &Path, thread: &str) -> Option<PathBuf> {
        if !is_thread_id(thread) {
            return None;
        }
        if let Some(known) = self.rollouts.lock().unwrap().get(thread) {
            return Some(known.clone());
        }
        let suffix = format!("-{thread}.jsonl");
        let found = parent
            .parent()
            .and_then(|dir| find_file(dir, &suffix))
            .or_else(|| codex_home(parent).and_then(|home| find_file_deep(&home.join("sessions"), &suffix, 3)))?;
        self.rollouts.lock().unwrap().insert(thread.to_owned(), found.clone());
        Some(found)
    }
}

impl TranscriptReader for CodexTranscriptReader {
    fn read(&self, transcript_path: &str, subagent_ids: &[String]) -> Option<TranscriptSummary> {
        let main = Path::new(transcript_path);
        let facts = self.facts(main)?;
        let today = Local::now().date_naive();
        let mut usage = facts.usage;
        let mut usage_today = facts.daily.get(&today).copied().unwrap_or_default();

        let mut threads: BTreeSet<&str> = facts.subagents.keys().map(String::as_str).collect();
        threads.extend(subagent_ids.iter().map(String::as_str));
        let mut subagents = Vec::new();
        for thread in threads {
            let Some(path) = self.rollout_of(main, thread) else { continue };
            let Some(sub) = self.facts(&path) else { continue };
            usage.add(&sub.usage);
            usage_today.add(&sub.daily.get(&today).copied().unwrap_or_default());
            if subagent_ids.iter().any(|id| id == thread) {
                subagents.push(SubagentDetail {
                    id: thread.to_owned(),
                    description: facts
                        .subagents
                        .get(thread)
                        .cloned()
                        .flatten()
                        .or_else(|| self.first_prompt(&path).map(|p| clip(&p, 60))),
                    last_tool: sub.last_action,
                    model: sub.model,
                    effort: sub.effort,
                });
            }
        }

        Some(TranscriptSummary {
            automatic_permission_review: facts.automatic_permission_review,
            running_commands: 0,
            title: self.title(main),
            first_prompt: self.first_prompt(main),
            last_prompt: facts.last_prompt,
            last_reply: facts.last_reply,
            last_action: facts.last_action,
            model: facts.model,
            effort: facts.effort,
            context_tokens: facts.context_tokens,
            context_window: facts.context_window,
            subagents,
            usage,
            usage_today,
        })
    }

    fn recent(&self, transcript_path: &str, limit: usize) -> Vec<TimelineItem> {
        recent_items(Path::new(transcript_path), limit)
    }

    fn subagent(&self, transcript_path: &str, agent_id: &str, limit: usize) -> Option<AgentTranscript> {
        let path = self.rollout_of(Path::new(transcript_path), agent_id)?;
        let timeline = recent_items(&path, usize::MAX);
        let last_reply = timeline.iter().rev().find(|i| i.kind == TimelineKind::Reply).map(|i| i.text.clone());
        let skip = timeline.len().saturating_sub(limit);
        Some(AgentTranscript {
            first_prompt: self.first_prompt(&path),
            last_reply,
            timeline: timeline.into_iter().skip(skip).collect(),
        })
    }

    fn touched_files(&self, transcript_path: &str) -> Vec<TouchedFile> {
        let main = Path::new(transcript_path);
        let mut files = vec![main.to_path_buf()];
        if let Some(facts) = self.facts(main) {
            files.extend(facts.subagents.keys().filter_map(|t| self.rollout_of(main, t)));
        }
        let mut touched: BTreeMap<String, TouchedFile> = BTreeMap::new();
        for file in files {
            let Ok(lines) = head_lines(&file, u64::MAX) else { continue };
            for item in lines.iter().filter_map(completed_item) {
                if item.get("type").and_then(Value::as_str) != Some("FileChange") {
                    continue;
                }
                for (path, change) in item.get("changes").and_then(Value::as_object).into_iter().flatten() {
                    let entry = touched.entry(path.clone()).or_insert_with(|| TouchedFile {
                        path: path.clone(),
                        edits: 0,
                        written: false,
                    });
                    entry.edits += 1;
                    entry.written |= change.get("type").and_then(Value::as_str) == Some("add");
                }
            }
        }
        touched.into_values().collect()
    }
}

/// `…/<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-….jsonl` → `<CODEX_HOME>`.
fn codex_home(rollout: &Path) -> Option<PathBuf> {
    rollout.ancestors().find(|a| a.file_name().is_some_and(|n| n == "sessions"))?.parent().map(Path::to_path_buf)
}

/// `rollout-2026-09-28T12-49-43-<uuid>.jsonl` → `<uuid>` (the last five dash-separated groups).
fn thread_id(rollout: &Path) -> Option<&str> {
    let stem = rollout.file_stem()?.to_str()?;
    let cut = stem.len().checked_sub(36)?;
    let id = stem.get(cut..)?;
    is_thread_id(id).then_some(id)
}

/// Thread ids are UUIDs; anything else never reaches a path.
fn is_thread_id(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn find_file(dir: &Path, suffix: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| p.to_str().is_some_and(|s| s.ends_with(suffix)))
}

/// Newest directories first (`YYYY/MM/DD`), `depth` levels down.
fn find_file_deep(dir: &Path, suffix: &str, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return find_file(dir, suffix);
    }
    let mut dirs: Vec<PathBuf> =
        std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort_unstable_by(|a, b| b.cmp(a));
    dirs.iter().find_map(|d| find_file_deep(d, suffix, depth - 1))
}

/// The item of an `item_completed` event (Codex writes it as an object; tolerate a JSON string).
fn completed_item(entry: &Value) -> Option<Value> {
    let payload = entry.get("payload")?;
    if entry.get("type").and_then(Value::as_str) != Some("event_msg")
        || payload.get("type").and_then(Value::as_str) != Some("item_completed")
    {
        return None;
    }
    match payload.get("item")? {
        Value::String(raw) => serde_json::from_str(raw).ok(),
        item => Some(item.clone()),
    }
}

/// Text blocks of a message item, joined; `None` if empty or only injected context (`<…>`).
fn message_text(item: &Value) -> Option<String> {
    let text = item
        .get("content")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|c| c.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|t| !t.is_empty() && !t.starts_with('<'))
        .collect::<Vec<_>>()
        .join("\n\n");
    (!text.is_empty()).then(|| cap(&text, REPLY_MAX_CHARS))
}

/// "Bash · cargo test", "Edit · view.rs", "mcp · browser.navigate": the same labels as Claude's.
fn action_label(item: &Value) -> Option<String> {
    match item.get("type").and_then(Value::as_str)? {
        "CommandExecution" => {
            // `["/bin/bash", "-lc", "cargo test"]`: the script is the last argument.
            let command = item.get("command").and_then(Value::as_array)?.last()?.as_str()?;
            Some(tool_label("Bash", Some(&json!({ "command": command }))))
        }
        "FileChange" => {
            let path = item.get("changes").and_then(Value::as_object)?.keys().next()?;
            Some(tool_label("Edit", Some(&json!({ "file_path": path }))))
        }
        "McpToolCall" => {
            let (server, tool) = (item.get("server")?.as_str()?, item.get("tool")?.as_str()?);
            Some(format!("{server} · {tool}"))
        }
        _ => None,
    }
}

/// Model and effort in force, from the last `turn_context`.
#[derive(Default)]
struct Turn {
    model: Option<String>,
    effort: Option<String>,
}

impl Turn {
    fn absorb(&mut self, entry: &Value) {
        if entry.get("type").and_then(Value::as_str) == Some("turn_context") {
            let text = |k: &str| entry.pointer(&format!("/payload/{k}")).and_then(Value::as_str).map(str::to_owned);
            self.model = text("model").or(self.model.take());
            self.effort = text("effort").or(self.effort.take());
        }
    }
}

fn timeline_items(entry: &Value, turn: &mut Turn) -> Option<TimelineItem> {
    turn.absorb(entry);
    let item = completed_item(entry)?;
    let at = entry.get("timestamp").and_then(Value::as_str).and_then(parse_iso_ms);
    let by_agent = |kind, text| TimelineItem { kind, text, at, model: turn.model.clone(), effort: turn.effort.clone() };
    match item.get("type").and_then(Value::as_str)? {
        "UserMessage" => {
            Some(TimelineItem { kind: TimelineKind::Prompt, text: message_text(&item)?, at, model: None, effort: None })
        }
        "AgentMessage" => Some(by_agent(TimelineKind::Reply, message_text(&item)?)),
        _ => Some(by_agent(TimelineKind::Tool, action_label(&item)?)),
    }
}

fn recent_items(path: &Path, limit: usize) -> Vec<TimelineItem> {
    let Ok(lines) = tail_lines(path, TIMELINE_TAIL_BYTES) else { return Vec::new() };
    let mut turn = Turn::default();
    let items: Vec<TimelineItem> = lines.iter().filter_map(|e| timeline_items(e, &mut turn)).collect();
    let skip = items.len().saturating_sub(limit);
    items.into_iter().skip(skip).collect()
}

fn absorb(facts: &mut Facts, entry: &Value) {
    let payload = entry.get("payload");
    let number = |pointer: &str| payload.and_then(|p| p.pointer(pointer)).and_then(Value::as_u64);
    match entry.get("type").and_then(Value::as_str) {
        Some("turn_context") => {
            facts.automatic_permission_review =
                payload.and_then(|p| p.get("approvals_reviewer")).and_then(Value::as_str) == Some("auto_review");
            let mut turn = Turn { model: facts.model.take(), effort: facts.effort.take() };
            turn.absorb(entry);
            (facts.model, facts.effort) = (turn.model, turn.effort);
        }
        Some("token_usage_record") => count_usage(facts, entry),
        Some("event_msg") => match payload.and_then(|p| p.get("type")).and_then(Value::as_str) {
            Some("task_started") => facts.context_window = number("/model_context_window").or(facts.context_window),
            Some("token_count") => {
                facts.context_tokens = number("/info/last_token_usage/input_tokens").or(facts.context_tokens);
                facts.context_window = number("/info/model_context_window").or(facts.context_window);
            }
            Some("item_completed") => absorb_item(facts, entry),
            _ => {}
        },
        _ => {}
    }
}

fn absorb_item(facts: &mut Facts, entry: &Value) {
    let Some(item) = completed_item(entry) else { return };
    match item.get("type").and_then(Value::as_str) {
        Some("UserMessage") => facts.last_prompt = message_text(&item).or(facts.last_prompt.take()),
        Some("AgentMessage") => facts.last_reply = message_text(&item).or(facts.last_reply.take()),
        Some("SubAgentActivity") => {
            if let Some(thread) = item.get("agent_thread_id").and_then(Value::as_str) {
                let name = item
                    .get("agent_path")
                    .and_then(Value::as_str)
                    .and_then(|p| p.rsplit('/').next())
                    .filter(|n| !n.is_empty())
                    .map(|n| n.replace('_', " "));
                let known = facts.subagents.entry(thread.to_owned()).or_default();
                if name.is_some() {
                    *known = name;
                }
            }
        }
        _ => {
            if let Some(label) = action_label(&item) {
                facts.last_action = Some(label);
            }
        }
    }
}

/// One API response's tokens, once. OpenAI counts cached input inside `input_tokens` and reasoning
/// inside `output_tokens`. Codex's own models have no public per-token price here, so they count as
/// unpriced (the UI says the cost is partial) rather than inventing one.
fn count_usage(facts: &mut Facts, entry: &Value) {
    let Some(payload) = entry.get("payload") else { return };
    if let Some(id) = payload.get("response_id").and_then(Value::as_str)
        && !facts.seen_responses.insert(id.to_owned())
    {
        return;
    }
    let Some(usage) = payload.get("usage") else { return };
    let n = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
    let (cached, written) = (n("cached_input_tokens"), n("cache_write_input_tokens"));
    let message = Usage {
        input_tokens: n("input_tokens").saturating_sub(cached + written),
        output_tokens: n("output_tokens"),
        cache_read_tokens: cached,
        cache_write_tokens: written,
        cost_micros: 0,
        unpriced_messages: 1,
    };
    facts.usage.add(&message);
    if let Some(day) = entry.get("timestamp").and_then(Value::as_str).and_then(parse_iso_ms).and_then(local_day) {
        facts.daily.entry(day).or_default().add(&message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A rollout captured from Codex 0.154 (instructions stripped, paths anonymised).
    const CAPTURED: &str = include_str!("fixtures/rollout.jsonl");
    const THREAD: &str = "01a0e7a2-87d7-7aa3-8a8a-d5c66bd78dda";

    /// `<home>/sessions/2026/09/28/rollout-…-<thread>.jsonl` with `lines`, plus a title index.
    fn home_with(thread: &str, lines: &str) -> (tempfile::TempDir, PathBuf) {
        let home = tempfile::tempdir().unwrap();
        let day = home.path().join("sessions/2026/09/28");
        fs::create_dir_all(&day).unwrap();
        let path = day.join(format!("rollout-2026-09-28T12-49-43-{thread}.jsonl"));
        fs::write(&path, lines).unwrap();
        fs::write(
            home.path().join("session_index.jsonl"),
            format!("{{\"id\":\"{thread}\",\"thread_name\":\"Old name\"}}\n{{\"id\":\"{thread}\",\"thread_name\":\"Check example.com\"}}\n"),
        )
        .unwrap();
        (home, path)
    }

    #[test]
    fn automatic_reviewer_is_scoped_to_the_latest_turn_context() {
        let mut facts = Facts::default();
        for (reviewer, expected) in
            [(Some("auto_review"), true), (Some("user"), false), (Some("auto_review"), true), (None, false)]
        {
            let mut payload = json!({"approval_policy":"on-request"});
            if let Some(reviewer) = reviewer {
                payload["approvals_reviewer"] = json!(reviewer);
            }
            absorb(&mut facts, &json!({"type":"turn_context", "payload":payload}));
            assert_eq!(facts.automatic_permission_review, expected);
        }
    }

    #[test]
    fn summarizes_a_real_rollout() {
        let (_home, path) = home_with(THREAD, CAPTURED);
        let s = CodexTranscriptReader::new().read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("Check example.com"), "the latest name in the index");
        assert!(s.first_prompt.unwrap().starts_with("Run exactly this shell command"));
        assert_eq!(s.last_reply.as_deref(), Some("The command returned no status line."));
        assert_eq!(s.last_action.as_deref(), Some("Bash · curl -sI https://example.com | head -1"));
        assert_eq!(s.model.as_deref(), Some("gpt-6-astra"));
        assert_eq!(s.context_window, Some(258_400));
        assert_eq!(s.context_tokens, Some(15_276), "input of the last response, cache included");
        // Three responses: 15026 + 15134 + 15276 input, of which 11904 + 14848 + 14976 cached.
        assert_eq!(s.usage.cache_read_tokens, 41_728);
        assert_eq!(s.usage.input_tokens, 45_436 - 41_728);
        assert_eq!(s.usage.unpriced_messages, 3);
        assert_eq!(s.usage.cost_micros, 0);
    }

    #[test]
    fn the_timeline_reads_like_claudes() {
        let (_home, path) = home_with(THREAD, CAPTURED);
        let items = CodexTranscriptReader::new().recent(path.to_str().unwrap(), 50);
        let kinds: Vec<_> = items.iter().map(|i| (i.kind, i.text.chars().take(24).collect::<String>())).collect();
        assert_eq!(
            kinds,
            [
                (TimelineKind::Prompt, "Run exactly this shell c".into()),
                (TimelineKind::Reply, "I’ll run the command as ".into()),
                (TimelineKind::Tool, "Bash · curl -sI https://".into()),
                (TimelineKind::Tool, "Bash · curl -sI https://".into()),
                (TimelineKind::Reply, "The command returned no ".into()),
            ]
        );
        assert_eq!(items[1].model.as_deref(), Some("gpt-6-astra"));
        assert!(items[0].at.is_some());
    }

    fn item(value: Value) -> String {
        json!({ "timestamp": "2026-09-28T10:00:00.000Z", "type": "event_msg",
                "payload": { "type": "item_completed", "item": value } })
        .to_string()
            + "\n"
    }

    #[test]
    fn subagents_edits_and_their_costs_come_from_their_own_rollouts() {
        let child = "01a0e45c-1d1e-7551-8615-e37d3c999132";
        let usage = |id: &str, input: u64| {
            json!({ "timestamp": "2026-09-28T10:00:00.000Z", "type": "token_usage_record",
                    "payload": { "response_id": id, "usage": { "input_tokens": input, "cached_input_tokens": 0, "output_tokens": 10 } } })
            .to_string()
                + "\n"
        };
        let parent = item(
            json!({ "type": "SubAgentActivity", "kind": "started", "agent_thread_id": child, "agent_path": "/root/trace_quote_flow" }),
        ) + &item(json!({ "type": "FileChange", "changes": { "/code/app/a.rs": { "type": "update" } } }))
            + &usage("r1", 100);
        let (_home, path) = home_with(THREAD, &parent);
        let day = path.parent().unwrap();
        let child_lines =
            item(json!({ "type": "UserMessage", "content": [{ "type": "text", "text": "Trace the quote flow" }] }))
                + &item(json!({ "type": "FileChange", "changes": { "/code/app/new.rs": { "type": "add" } } }))
                + &item(json!({ "type": "AgentMessage", "content": [{ "type": "text", "text": "Found it." }] }))
                + &usage("r2", 50)
                + &usage("r2", 50);
        fs::write(day.join(format!("rollout-2026-09-28T12-50-00-{child}.jsonl")), child_lines).unwrap();

        let reader = CodexTranscriptReader::new();
        let s = reader.read(path.to_str().unwrap(), &[child.to_string()]).unwrap();
        assert_eq!(s.usage.input_tokens, 150, "the child's response counted once");
        assert_eq!(s.subagents.len(), 1);
        assert_eq!(s.subagents[0].description.as_deref(), Some("trace quote flow"));
        assert_eq!(s.subagents[0].last_tool.as_deref(), Some("Edit · new.rs"));

        let sub = reader.subagent(path.to_str().unwrap(), child, 10).unwrap();
        assert_eq!(sub.first_prompt.as_deref(), Some("Trace the quote flow"));
        assert_eq!(sub.last_reply.as_deref(), Some("Found it."));

        let touched = reader.touched_files(path.to_str().unwrap());
        let summary: Vec<_> = touched.iter().map(|t| (t.path.as_str(), t.written)).collect();
        assert_eq!(summary, [("/code/app/a.rs", false), ("/code/app/new.rs", true)]);
        assert!(reader.subagent(path.to_str().unwrap(), "../../etc/passwd", 10).is_none());
    }

    #[test]
    fn thread_ids_come_from_the_file_name() {
        let p = Path::new(
            "/h/.codex/sessions/2026/09/28/rollout-2026-09-28T12-49-43-01a0e7a2-87d7-7aa3-8a8a-d5c66bd78dda.jsonl",
        );
        assert_eq!(thread_id(p), Some(THREAD));
        assert_eq!(codex_home(p), Some(PathBuf::from("/h/.codex")));
        assert_eq!(thread_id(Path::new("/x/notes.jsonl")), None);
    }

    #[test]
    fn missing_rollout_reads_as_none() {
        assert!(CodexTranscriptReader::new().read("/nonexistent/rollout.jsonl", &[]).is_none());
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// `AWR_CODEX_ROLLOUT=<rollout.jsonl> cargo test -p awr-infrastructure codex_live -- --ignored --nocapture`
    #[test]
    #[ignore = "reads a real rollout from $AWR_CODEX_ROLLOUT"]
    fn codex_live_summarizes_a_real_rollout() {
        let Ok(path) = std::env::var("AWR_CODEX_ROLLOUT") else { return };
        let reader = CodexTranscriptReader::new();
        let started = std::time::Instant::now();
        let s = reader.read(&path, &[]).expect("readable rollout");
        println!("read in {:?}", started.elapsed());
        println!("title: {} chars", s.title.map(|t| t.chars().count()).unwrap_or(0));
        println!("first prompt: {} chars", s.first_prompt.map(|t| t.chars().count()).unwrap_or(0));
        println!("last reply: {} chars", s.last_reply.map(|t| t.chars().count()).unwrap_or(0));
        println!("model {:?} effort {:?}", s.model, s.effort);
        println!("context {:?} / {:?}", s.context_tokens, s.context_window);
        println!("usage {:?}", s.usage);
        println!("timeline items: {}", reader.recent(&path, 50).len());
        println!("touched files: {}", reader.touched_files(&path).len());
    }
}
