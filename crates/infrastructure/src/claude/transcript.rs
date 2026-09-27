//! Lectura incremental de los transcripts JSONL de Claude Code.
//!
//! `<proyecto>/<sesión>.jsonl` es la conversación principal; los subagentes viven en
//! `<proyecto>/<sesión>/subagents/agent-<id>.jsonl` con un `agent-<id>.meta.json` al lado.

use awr_application::ports::{SubagentDetail, TranscriptReader, TranscriptSummary};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// La primera lectura de un transcript largo empieza por aquí desde el final: el título y el último
/// prompt se repiten a menudo, así que basta con la cola.
const INITIAL_TAIL_BYTES: u64 = 512 * 1024;
const REPLY_MAX_CHARS: usize = 600;
const ARG_MAX_CHARS: usize = 60;

#[derive(Default)]
pub struct ClaudeTranscriptReader {
    files: Mutex<HashMap<PathBuf, Tail>>,
    descriptions: Mutex<HashMap<PathBuf, Option<String>>>,
}

#[derive(Default, Clone)]
struct Tail {
    offset: u64,
    facts: Facts,
}

#[derive(Default, Clone)]
struct Facts {
    ai_title: Option<String>,
    custom_title: Option<String>,
    last_prompt: Option<String>,
    last_reply: Option<String>,
    last_action: Option<String>,
    model: Option<String>,
    context_tokens: Option<u64>,
}

impl ClaudeTranscriptReader {
    pub fn new() -> Self {
        Self::default()
    }

    fn facts(&self, path: &Path) -> Option<Facts> {
        let mut files = self.files.lock().unwrap();
        let tail = files.entry(path.to_path_buf()).or_default();
        advance(path, tail).ok()?;
        Some(tail.facts.clone())
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
        // Solo se cachea lo encontrado: el meta puede aparecer después del SubagentStart.
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
            .map(|id| SubagentDetail {
                id: id.clone(),
                description: self.description(&subagent_dir.join(format!("agent-{id}.meta.json"))),
                last_tool: self
                    .facts(&subagent_dir.join(format!("agent-{id}.jsonl")))
                    .and_then(|f| f.last_action),
            })
            .collect();

        Some(TranscriptSummary {
            title: facts.custom_title.or(facts.ai_title),
            last_prompt: facts.last_prompt,
            last_reply: facts.last_reply,
            last_action: facts.last_action,
            model: facts.model,
            context_tokens: facts.context_tokens,
            subagents,
        })
    }
}

/// Lee las líneas completas nuevas desde `tail.offset` y las incorpora.
fn advance(path: &Path, tail: &mut Tail) -> std::io::Result<()> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len < tail.offset {
        // Truncado o reescrito: empezar de cero.
        *tail = Tail::default();
    }
    let mut skip_partial_first_line = false;
    if tail.offset == 0 && len > INITIAL_TAIL_BYTES {
        tail.offset = len - INITIAL_TAIL_BYTES;
        skip_partial_first_line = true;
    }
    if tail.offset == len {
        return Ok(());
    }

    file.seek(SeekFrom::Start(tail.offset))?;
    let mut buf = Vec::with_capacity((len - tail.offset) as usize);
    file.take(len - tail.offset).read_to_end(&mut buf)?;

    // Solo líneas terminadas: la última puede estar a medio escribir.
    let Some(last_newline) = buf.iter().rposition(|&b| b == b'\n') else {
        return Ok(());
    };
    let complete = &buf[..=last_newline];
    let mut lines = complete.split(|&b| b == b'\n');
    if skip_partial_first_line {
        lines.next();
    }
    for line in lines.filter(|l| !l.is_empty()) {
        if let Ok(entry) = serde_json::from_slice::<Value>(line) {
            absorb(&mut tail.facts, &entry);
        }
    }
    tail.offset += last_newline as u64 + 1;
    Ok(())
}

fn absorb(facts: &mut Facts, entry: &Value) {
    let text = |key: &str| entry.get(key).and_then(Value::as_str).map(str::to_owned);
    match entry.get("type").and_then(Value::as_str) {
        Some("ai-title") => facts.ai_title = text("aiTitle").or(facts.ai_title.take()),
        Some("custom-title") => facts.custom_title = text("customTitle").or(facts.custom_title.take()),
        Some("last-prompt") => facts.last_prompt = text("lastPrompt").or(facts.last_prompt.take()),
        Some("user") => {
            // Respaldo si no hay `last-prompt`: el último mensaje escrito por una persona.
            if let Some(prompt) = entry.pointer("/message/content").and_then(Value::as_str)
                && !prompt.starts_with('<')
            {
                facts.last_prompt = Some(prompt.to_owned());
            }
        }
        Some("assistant") => absorb_assistant(facts, entry),
        _ => {}
    }
}

fn absorb_assistant(facts: &mut Facts, entry: &Value) {
    let Some(message) = entry.get("message") else { return };
    if let Some(model) = message.get("model").and_then(Value::as_str)
        && !model.starts_with('<')
    {
        facts.model = Some(model.to_owned());
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
                    facts.last_reply = Some(clip(t, REPLY_MAX_CHARS));
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

/// "Bash · cargo test", "Read · view.rs", "Agent · Revisar el login"…
fn tool_label(name: &str, input: Option<&Value>) -> String {
    const KEYS: &[&str] = &["description", "file_path", "notebook_path", "path", "pattern", "command", "url", "query", "skill", "prompt"];
    let Some(input) = input else { return name.to_owned() };
    let arg = KEYS.iter().find_map(|k| Some((*k, input.get(*k)?.as_str()?)));
    match arg {
        Some((key, value)) if key.ends_with("path") => {
            let file = Path::new(value).file_name().map(|f| f.to_string_lossy().into_owned());
            format!("{name} · {}", file.unwrap_or_else(|| value.to_owned()))
        }
        Some((_, value)) => format!("{name} · {}", clip(value, ARG_MAX_CHARS)),
        None => name.to_owned(),
    }
}

fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        flat
    } else {
        format!("{}…", flat.chars().take(max - 1).collect::<String>())
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
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "Arreglar login" })));
        append(&path, &line(json!({ "type": "user", "message": { "role": "user", "content": "arregla el login" } })));
        append(&path, &assistant(json!([{ "type": "text", "text": "Voy a mirar.\n\nPrimero" }, { "type": "tool_use", "name": "Read", "input": { "file_path": "/src/auth/login.rs" } }])));

        let reader = ClaudeTranscriptReader::new();
        let s = reader.read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("Arreglar login"));
        assert_eq!(s.last_prompt.as_deref(), Some("arregla el login"));
        assert_eq!(s.last_reply.as_deref(), Some("Voy a mirar. Primero"));
        assert_eq!(s.last_action.as_deref(), Some("Read · login.rs"));
        assert_eq!(s.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(s.context_tokens, Some(1502));
    }

    #[test]
    fn reads_incrementally_and_ignores_half_written_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(&path, &assistant(json!([{ "type": "tool_use", "name": "Bash", "input": { "command": "cargo test" } }])));
        let reader = ClaudeTranscriptReader::new();
        assert_eq!(reader.read(path.to_str().unwrap(), &[]).unwrap().last_action.as_deref(), Some("Bash · cargo test"));

        append(&path, "{\"type\":\"custom-title\",\"customTitle\":\"Mi");
        let s = reader.read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title, None, "línea a medias: todavía no");

        append(&path, " sesión\"}\n");
        let s = reader.read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("Mi sesión"));
        assert_eq!(s.last_action.as_deref(), Some("Bash · cargo test"), "conserva lo leído antes");
    }

    #[test]
    fn custom_title_wins_over_ai_title() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(&path, &line(json!({ "type": "custom-title", "customTitle": "Mío" })));
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "De la IA" })));
        let s = ClaudeTranscriptReader::new().read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("Mío"));
    }

    #[test]
    fn subagents_get_description_and_current_tool() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "x" })));
        let subs = dir.path().join("s/subagents");
        std::fs::create_dir_all(&subs).unwrap();
        std::fs::write(subs.join("agent-a1.meta.json"), r#"{"agentType":"Explore","description":"Buscar usos de login"}"#).unwrap();
        append(&subs.join("agent-a1.jsonl"), &assistant(json!([{ "type": "tool_use", "name": "Grep", "input": { "pattern": "fn login" } }])));

        let s = ClaudeTranscriptReader::new().read(path.to_str().unwrap(), &["a1".into(), "a2".into()]).unwrap();
        assert_eq!(s.subagents[0].description.as_deref(), Some("Buscar usos de login"));
        assert_eq!(s.subagents[0].last_tool.as_deref(), Some("Grep · fn login"));
        assert_eq!(s.subagents[1], SubagentDetail { id: "a2".into(), ..Default::default() });
    }

    #[test]
    fn long_transcripts_start_from_the_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let filler = line(json!({ "type": "user", "message": { "content": "x".repeat(1000) } }));
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "Antiguo" })));
        append(&path, &filler.repeat(700));
        append(&path, &line(json!({ "type": "ai-title", "aiTitle": "Reciente" })));
        let s = ClaudeTranscriptReader::new().read(path.to_str().unwrap(), &[]).unwrap();
        assert_eq!(s.title.as_deref(), Some("Reciente"));
    }

    #[test]
    fn missing_transcript_reads_as_none() {
        assert!(ClaudeTranscriptReader::new().read("/no/existe.jsonl", &[]).is_none());
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// Manual: `AWR_TRANSCRIPT=/ruta/sesion.jsonl AWR_SUBAGENTS=id1,id2 cargo test -p awr-infrastructure
    /// transcript_live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn transcript_live_summarizes_a_real_session() {
        let path = std::env::var("AWR_TRANSCRIPT").expect("AWR_TRANSCRIPT");
        let subagents: Vec<String> = std::env::var("AWR_SUBAGENTS")
            .map(|s| s.split(',').map(str::to_owned).collect())
            .unwrap_or_default();
        let started = std::time::Instant::now();
        let reader = ClaudeTranscriptReader::new();
        let summary = reader.read(&path, &subagents).expect("transcript legible");
        let first = started.elapsed();
        let started = std::time::Instant::now();
        reader.read(&path, &subagents);
        println!("{summary:#?}\nprimera lectura {first:?}, incremental {:?}", started.elapsed());
    }
}
