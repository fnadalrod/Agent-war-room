//! Reading JSONL transcripts that an agent is still writing: the head, the tail, and incremental
//! reads of only the new complete lines. Shared by every agent's transcript reader.

use chrono::{Local, NaiveDate, TimeZone};
use serde_json::Value;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Where an incremental read of one file is.
#[derive(Default, Clone)]
pub struct Follow {
    offset: u64,
}

impl Follow {
    /// Feeds `absorb` every complete line written since the last call. The first call reads the whole
    /// file, or only its last `initial_tail_bytes` if it is larger. If the file shrank (rewritten), the
    /// state is reset and it starts over. A half-written last line waits for the next call.
    pub fn advance<S: Default>(
        &mut self,
        path: &Path,
        initial_tail_bytes: u64,
        state: &mut S,
        mut absorb: impl FnMut(&mut S, &Value),
    ) -> std::io::Result<()> {
        let mut file = File::open(path)?;
        let len = file.metadata()?.len();
        if len < self.offset {
            self.offset = 0;
            *state = S::default();
        }
        let mut skip_partial_first_line = false;
        if self.offset == 0 && len > initial_tail_bytes {
            self.offset = len - initial_tail_bytes;
            skip_partial_first_line = true;
        }
        if self.offset == len {
            return Ok(());
        }

        file.seek(SeekFrom::Start(self.offset))?;
        let mut buf = Vec::with_capacity((len - self.offset) as usize);
        file.take(len - self.offset).read_to_end(&mut buf)?;

        let Some(last_newline) = buf.iter().rposition(|&b| b == b'\n') else {
            return Ok(());
        };
        let mut lines = buf[..=last_newline].split(|&b| b == b'\n');
        if skip_partial_first_line {
            lines.next();
        }
        for line in lines.filter(|l| !l.is_empty()) {
            if let Ok(entry) = serde_json::from_slice::<Value>(line) {
                absorb(state, &entry);
            }
        }
        self.offset += last_newline as u64 + 1;
        Ok(())
    }
}

/// Complete JSON lines within the first `bytes` of the file.
pub fn head_lines(path: &Path, bytes: u64) -> std::io::Result<Vec<Value>> {
    let mut buf = Vec::new();
    File::open(path)?.take(bytes).read_to_end(&mut buf)?;
    let complete = match buf.iter().rposition(|&b| b == b'\n') {
        Some(i) => &buf[..i],
        None => &buf[..],
    };
    Ok(complete.split(|&b| b == b'\n').filter_map(|l| serde_json::from_slice(l).ok()).collect())
}

/// Complete JSON lines within the last `bytes` of the file.
pub fn tail_lines(path: &Path, bytes: u64) -> std::io::Result<Vec<Value>> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut buf)?;
    let mut lines = buf.split(|&b| b == b'\n');
    if start > 0 {
        lines.next();
    }
    Ok(lines.filter_map(|l| serde_json::from_slice(l).ok()).collect())
}

/// `2026-09-27T22:44:39.232Z` → milliseconds since the epoch (UTC `Z` only, which is what the agents
/// write; any number of fraction digits).
pub fn parse_iso_ms(s: &str) -> Option<i64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>());
    let (y, m, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let (hms, frac) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = hms.split(':').map(|p| p.parse::<i64>());
    let (h, min, sec) = (t.next()?.ok()?, t.next()?.ok()?, t.next()?.ok()?);
    let ms: i64 = format!("{frac:0<3}")[..3].parse().ok()?;
    // Days since 1970-01-01 (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + h) * 60 + min) * 60_000 + sec * 1000 + ms)
}

/// The local calendar day of a moment, for "today" totals.
pub fn local_day(ms: i64) -> Option<NaiveDate> {
    Local.timestamp_millis_opt(ms).single().map(|t| t.date_naive())
}

/// Truncates by chars, keeping the formatting.
pub fn cap(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_owned()
    } else {
        format!("{}…", text.chars().take(max - 1).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parses_agent_timestamps() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso_ms("2000-03-01T12:30:05.5Z"), Some(951_913_805_500));
        assert_eq!(parse_iso_ms("2026-09-28T10:49:43.645123Z"), parse_iso_ms("2026-09-28T10:49:43.645Z"));
        assert_eq!(parse_iso_ms("tomorrow"), None);
    }

    #[test]
    fn follows_only_complete_new_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        let mut file = File::create(&path).unwrap();
        write!(file, "{{\"n\":1}}\n{{\"n\":").unwrap();
        let (mut follow, mut seen) = (Follow::default(), Vec::<i64>::new());
        let push = |seen: &mut Vec<i64>, v: &Value| seen.push(v["n"].as_i64().unwrap());
        follow.advance(&path, u64::MAX, &mut seen, push).unwrap();
        writeln!(file, "2}}").unwrap();
        follow.advance(&path, u64::MAX, &mut seen, push).unwrap();
        assert_eq!(seen, [1, 2]);
    }
}
