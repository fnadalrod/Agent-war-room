//! The app's own terminals: processes in a PTY whose output is forwarded to the UI and that can be
//! typed into. They survive closing the window (the app stays in the tray).

use crate::locale;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Output kept per terminal to repaint it when opened.
const SCROLLBACK_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyEvent {
    Output { id: String, data: Vec<u8> },
    Exited { id: String },
}

pub type PtySink = Arc<dyn Fn(PtyEvent) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtySpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub label: String,
    pub env: Vec<(String, String)>,
    /// Inherited variables that must not reach the process.
    pub env_remove: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PtyInfo {
    pub id: String,
    pub label: String,
    pub cwd: String,
    pub alive: bool,
}

struct PtySession {
    info: Mutex<PtyInfo>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    scrollback: Mutex<Vec<u8>>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
    sink: PtySink,
    next: AtomicU64,
}

impl PtyManager {
    pub fn new(sink: PtySink) -> Arc<Self> {
        Arc::new(Self { sessions: Mutex::default(), sink, next: AtomicU64::new(1) })
    }

    /// Spawns the process with `AWR_PTY_ID` in its environment, so its hooks tell which terminal they live in.
    pub fn spawn(self: &Arc<Self>, spec: PtySpec) -> Result<String, String> {
        let id = format!("pty-{}-{}", std::process::id(), self.next.fetch_add(1, Ordering::SeqCst));
        let pair = native_pty_system()
            .openpty(PtySize { rows: 32, cols: 120, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        cmd.cwd(&spec.cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("AWR_PTY_ID", &id);
        for k in &spec.env_remove {
            cmd.env_remove(k);
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let session = Arc::new(PtySession {
            info: Mutex::new(PtyInfo { id: id.clone(), label: spec.label, cwd: spec.cwd, alive: true }),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            scrollback: Mutex::default(),
        });
        self.sessions.lock().unwrap().insert(id.clone(), session.clone());

        let sink = self.sink.clone();
        let pump_id = id.clone();
        std::thread::Builder::new()
            .name(format!("pty-{id}"))
            .spawn(move || pump(pump_id, reader, session, sink))
            .map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let session = self.get(id)?;
        let mut writer = session.writer.lock().unwrap();
        writer.write_all(data).and_then(|_| writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.get(id)?;
        let size = PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 };
        session.master.lock().unwrap().resize(size).map_err(|e| e.to_string())
    }

    pub fn snapshot(&self, id: &str) -> Result<Vec<u8>, String> {
        Ok(self.get(id)?.scrollback.lock().unwrap().clone())
    }

    pub fn list(&self) -> Vec<PtyInfo> {
        let mut all: Vec<PtyInfo> =
            self.sessions.lock().unwrap().values().map(|s| s.info.lock().unwrap().clone()).collect();
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all
    }

    /// Kills the process if still alive and forgets the terminal.
    pub fn close(&self, id: &str) -> Result<(), String> {
        let session = self.sessions.lock().unwrap().remove(id).ok_or_else(|| locale::unknown_terminal(id))?;
        if session.info.lock().unwrap().alive {
            let _ = session.child.lock().unwrap().kill();
        }
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Arc<PtySession>, String> {
        self.sessions.lock().unwrap().get(id).cloned().ok_or_else(|| locale::unknown_terminal(id))
    }
}

fn pump(id: String, mut reader: Box<dyn Read + Send>, session: Arc<PtySession>, sink: PtySink) {
    let mut buf = [0u8; 16 * 1024];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let chunk = buf[..n].to_vec();
                {
                    let mut scrollback = session.scrollback.lock().unwrap();
                    scrollback.extend_from_slice(&chunk);
                    if scrollback.len() > SCROLLBACK_BYTES {
                        let excess = scrollback.len() - SCROLLBACK_BYTES;
                        scrollback.drain(..excess);
                    }
                }
                sink(PtyEvent::Output { id: id.clone(), data: chunk });
            }
        }
    }
    let _ = session.child.lock().unwrap().wait();
    session.info.lock().unwrap().alive = false;
    sink(PtyEvent::Exited { id });
}

/// Drives `/bin/sh`: Unix only.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn manager() -> (Arc<PtyManager>, Arc<Mutex<Vec<PtyEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink_events = events.clone();
        (PtyManager::new(Arc::new(move |e| sink_events.lock().unwrap().push(e))), events)
    }

    fn wait_until(mut check: impl FnMut() -> bool) {
        let start = Instant::now();
        while !check() {
            assert!(start.elapsed() < Duration::from_secs(5), "timeout");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn runs_a_process_you_can_type_into_and_keeps_its_output() {
        let (pty, events) = manager();
        let id = pty
            .spawn(PtySpec {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), "echo id=$AWR_PTY_ID; read x; echo got:$x".into()],
                cwd: "/tmp".into(),
                label: "test".into(),
                env: vec![],
                env_remove: vec![],
            })
            .unwrap();

        let screen = || String::from_utf8_lossy(&pty.snapshot(&id).unwrap_or_default()).into_owned();
        wait_until(|| screen().contains(&format!("id={id}")));
        pty.resize(&id, 100, 30).unwrap();
        pty.write(&id, b"hello\r").unwrap();
        wait_until(|| screen().contains("got:hello"));
        wait_until(|| events.lock().unwrap().contains(&PtyEvent::Exited { id: id.clone() }));

        assert!(!pty.list()[0].alive);
        pty.close(&id).unwrap();
        assert!(pty.list().is_empty());
    }
}
