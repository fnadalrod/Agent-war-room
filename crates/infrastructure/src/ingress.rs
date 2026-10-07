//! Inbound adapter: Unix socket where `warroom-hook` drops one envelope per connection.

use awr_application::IncomingSignal;
use awr_application::ports::{HookResponder, HookResponse};
use awr_domain::{ProcessInfo, TerminalHost, Timestamp};
use awr_wire::{HookEnvelope, HookReply, PROTOCOL_VERSION};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

const MAX_ENVELOPE_BYTES: u64 = 8 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(2);
const REPLY_WRITE_TIMEOUT: Duration = Duration::from_secs(1);

pub type SignalHandler = Arc<dyn Fn(IncomingSignal) + Send + Sync>;

/// Starts listening on the socket. Fails if another app instance already holds it.
pub async fn bind(path: &Path) -> io::Result<UnixListener> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    if path.exists() {
        if UnixStream::connect(path).await.is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "another instance is already listening on the socket",
            ));
        }
        std::fs::remove_file(path)?;
    }
    UnixListener::bind(path)
}

/// Accepts connections forever. The handler runs outside the async runtime (it does blocking IO).
pub async fn serve(listener: UnixListener, handler: SignalHandler) {
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let handler = handler.clone();
        tokio::spawn(async move {
            match receive(stream).await {
                Ok(Some(signal)) => {
                    let _ = tokio::task::spawn_blocking(move || handler(signal)).await;
                }
                Ok(None) => {}
                Err(e) => eprintln!("[ingress] envelope dropped: {e}"),
            }
        });
    }
}

pub fn default_socket_path() -> PathBuf {
    awr_wire::socket_path()
}

/// Reads one line (or up to EOF, as old bridges did) and, if the bridge expects a reply, keeps
/// the connection open to answer it.
async fn receive(stream: UnixStream) -> io::Result<Option<IncomingSignal>> {
    let mut reader = BufReader::new(stream.take(MAX_ENVELOPE_BYTES));
    let mut line = String::new();
    tokio::time::timeout(READ_TIMEOUT, reader.read_line(&mut line))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "slow read"))??;
    let envelope: HookEnvelope =
        serde_json::from_str(line.trim_end()).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let reply: Option<Arc<dyn HookResponder>> = if envelope.expects_reply {
        Some(Arc::new(SocketResponder::watch(reader.into_inner().into_inner())?))
    } else {
        None
    };
    Ok(to_signal(envelope, reply))
}

fn to_signal(envelope: HookEnvelope, reply: Option<Arc<dyn HookResponder>>) -> Option<IncomingSignal> {
    if envelope.v != PROTOCOL_VERSION {
        eprintln!("[ingress] unsupported protocol version {}", envelope.v);
        return None;
    }
    Some(IncomingSignal {
        provider: envelope.provider,
        received_at: Some(Timestamp(envelope.received_at_ms)),
        host: TerminalHost {
            agent_pid: envelope.agent_pid,
            agent_command: envelope.agent_command,
            ancestry: envelope.ancestry.into_iter().map(|p| ProcessInfo { pid: p.pid, name: p.name }).collect(),
            tmux_pane: envelope.env.tmux_pane,
            // `$TMUX` is `socket,server_pid,session`.
            tmux_socket: envelope.env.tmux.and_then(|t| t.split(',').next().map(str::to_owned)),
            term_program: envelope.env.term_program,
            warp_focus_url: envelope.env.warp_focus_url,
            pty_id: envelope.env.pty_id,
        },
        payload: envelope.payload,
        reply,
    })
}

/// Open connection to a `warroom-hook` waiting for a decision. If the user answers in the terminal,
/// Claude kills the hook and EOF arrives: a task watches a clone of the socket to notice.
struct SocketResponder {
    stream: Mutex<Option<std::os::unix::net::UnixStream>>,
    closed: Arc<AtomicBool>,
}

impl SocketResponder {
    fn watch(stream: UnixStream) -> io::Result<Self> {
        let stream = stream.into_std()?;
        let mut watcher = UnixStream::from_std(stream.try_clone()?)?;
        let closed = Arc::new(AtomicBool::new(false));
        let flag = closed.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 64];
            // The bridge sends nothing else: we only get past this on EOF or error.
            while let Ok(n) = watcher.read(&mut buf).await {
                if n == 0 {
                    break;
                }
            }
            flag.store(true, Ordering::SeqCst);
        });
        Ok(Self { stream: Mutex::new(Some(stream)), closed })
    }
}

impl HookResponder for SocketResponder {
    fn is_open(&self) -> bool {
        !self.closed.load(Ordering::SeqCst) && self.stream.lock().unwrap().is_some()
    }

    fn respond(&self, response: HookResponse) -> bool {
        let Some(mut stream) = self.stream.lock().unwrap().take() else { return false };
        if self.closed.load(Ordering::SeqCst) {
            return false;
        }
        let reply = match response {
            HookResponse::Allow => HookReply::Allow,
            HookResponse::Deny { message } => HookReply::Deny { message },
            HookResponse::Answer { answers } => HookReply::Answer { answers },
        };
        let Ok(mut line) = serde_json::to_vec(&reply) else { return false };
        line.push(b'\n');
        // The socket is non-blocking (shared with tokio); a short line easily fits in the buffer,
        // but retry just in case.
        let deadline = std::time::Instant::now() + REPLY_WRITE_TIMEOUT;
        let mut written = 0;
        while written < line.len() {
            match stream.write(&line[written..]) {
                Ok(n) => written += n,
                Err(e) if e.kind() == io::ErrorKind::WouldBlock && std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(_) => return false,
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use awr_wire::{EnvHints, WireProcess};
    use tokio::io::AsyncWriteExt;

    fn envelope(expects_reply: bool) -> HookEnvelope {
        HookEnvelope {
            v: PROTOCOL_VERSION,
            provider: "claude".into(),
            received_at_ms: 42,
            agent_pid: Some(7),
            ancestry: vec![WireProcess { pid: 7, name: "claude".into() }],
            agent_command: Some("claude --resume abc".into()),
            env: EnvHints {
                tmux_pane: Some("%3".into()),
                tmux: Some("/tmp/tmux-1000/default,99,0".into()),
                ..Default::default()
            },
            payload: serde_json::json!({ "hook_event_name": "Stop" }),
            expects_reply,
        }
    }

    async fn server() -> (tempfile::TempDir, PathBuf, tokio::sync::mpsc::UnboundedReceiver<IncomingSignal>) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sock/ingress.sock");
        let listener = bind(&path).await.unwrap();
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(serve(listener, Arc::new(move |s| tx.send(s).unwrap_or(()))));
        (dir, path, rx)
    }

    async fn next(rx: &mut tokio::sync::mpsc::UnboundedReceiver<IncomingSignal>) -> IncomingSignal {
        tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn delivers_envelopes_as_signals_even_from_old_bridges_without_newline() {
        let (_dir, path, mut rx) = server().await;

        let mut client = UnixStream::connect(&path).await.unwrap();
        client.write_all(&serde_json::to_vec(&envelope(false)).unwrap()).await.unwrap();
        client.shutdown().await.unwrap();

        let signal = next(&mut rx).await;
        assert_eq!(signal.received_at, Some(Timestamp(42)));
        assert_eq!(signal.host.agent_pid, Some(7));
        assert_eq!(signal.host.tmux_pane.as_deref(), Some("%3"));
        assert_eq!(signal.host.tmux_socket.as_deref(), Some("/tmp/tmux-1000/default"));
        assert!(signal.reply.is_none());

        assert_eq!(bind(&path).await.unwrap_err().kind(), io::ErrorKind::AddrInUse);
    }

    #[tokio::test]
    async fn a_waiting_bridge_receives_the_decision() {
        let (_dir, path, mut rx) = server().await;

        let mut client = UnixStream::connect(&path).await.unwrap();
        let mut line = serde_json::to_vec(&envelope(true)).unwrap();
        line.push(b'\n');
        client.write_all(&line).await.unwrap();

        let reply = next(&mut rx).await.reply.expect("responder");
        assert!(reply.is_open());
        let responder = reply.clone();
        tokio::task::spawn_blocking(move || assert!(responder.respond(HookResponse::Allow))).await.unwrap();

        let mut answer = String::new();
        BufReader::new(client).read_line(&mut answer).await.unwrap();
        assert_eq!(serde_json::from_str::<HookReply>(answer.trim()).unwrap(), HookReply::Allow);
        assert!(!reply.respond(HookResponse::Allow), "only one reply");
    }

    #[tokio::test]
    async fn a_bridge_killed_by_the_agent_is_detected_as_closed() {
        let (_dir, path, mut rx) = server().await;

        let mut client = UnixStream::connect(&path).await.unwrap();
        let mut line = serde_json::to_vec(&envelope(true)).unwrap();
        line.push(b'\n');
        client.write_all(&line).await.unwrap();
        let reply = next(&mut rx).await.reply.unwrap();

        drop(client);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!reply.is_open());
        assert!(!reply.respond(HookResponse::Deny { message: None }));
    }
}
