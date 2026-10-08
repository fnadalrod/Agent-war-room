//! Inbound adapter: where `warroom-hook` drops one envelope per connection. A Unix socket on Linux
//! and macOS, a named pipe on Windows (`awr_wire::pipe_name`); everything past accepting a
//! connection is the same code.

use awr_application::IncomingSignal;
use awr_application::ports::{HookResponder, HookResponse};
use awr_domain::{ProcessInfo, TerminalHost, Timestamp};
use awr_wire::{HookEnvelope, HookReply, PROTOCOL_VERSION};
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

const MAX_ENVELOPE_BYTES: u64 = 8 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(2);
const REPLY_WRITE_TIMEOUT: Duration = Duration::from_secs(1);

pub type SignalHandler = Arc<dyn Fn(IncomingSignal) + Send + Sync>;

pub use endpoint::{Listener, bind};

#[cfg(unix)]
mod endpoint {
    use std::io;
    use std::path::Path;
    use tokio::net::{UnixListener, UnixStream};

    pub struct Listener(UnixListener);

    /// Starts listening on the socket. Fails if another app instance already holds it.
    pub async fn bind(path: &Path) -> io::Result<Listener> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        if path.exists() {
            if UnixStream::connect(path).await.is_ok() {
                return Err(super::in_use());
            }
            std::fs::remove_file(path)?;
        }
        UnixListener::bind(path).map(Listener)
    }

    impl Listener {
        pub async fn accept(&mut self) -> io::Result<UnixStream> {
            self.0.accept().await.map(|(stream, _)| stream)
        }
    }
}

/// One pipe instance waits for a client at a time; as soon as one connects, the next is created, so
/// a hook arriving meanwhile finds it (or retries briefly on `ERROR_PIPE_BUSY`, see the bridge).
/// Remote clients are rejected (tokio's default) and the default DACL only lets the owner write.
#[cfg(windows)]
mod endpoint {
    use std::io;
    use std::path::Path;
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

    pub struct Listener {
        name: String,
        next: NamedPipeServer,
    }

    /// Creates the pipe. Fails if another app instance already holds it.
    pub async fn bind(path: &Path) -> io::Result<Listener> {
        let name = awr_wire::pipe_name(path);
        let next = ServerOptions::new().first_pipe_instance(true).create(&name).map_err(|e| {
            if e.kind() == io::ErrorKind::PermissionDenied { super::in_use() } else { e }
        })?;
        Ok(Listener { name, next })
    }

    impl Listener {
        /// The waiting instance is replaced whatever happens: one whose client died before connecting
        /// (`ERROR_NO_DATA`) would otherwise be retried forever, and every bridge would find the
        /// pipe busy.
        pub async fn accept(&mut self) -> io::Result<NamedPipeServer> {
            let connected = self.next.connect().await;
            let next = ServerOptions::new().create(&self.name)?;
            let current = std::mem::replace(&mut self.next, next);
            connected.map(|()| current)
        }
    }
}

fn in_use() -> io::Error {
    io::Error::new(io::ErrorKind::AddrInUse, "another instance is already listening on the socket")
}

/// Accepts connections forever. The handler runs outside the async runtime (it does blocking IO).
pub async fn serve(mut listener: Listener, handler: SignalHandler) {
    loop {
        let stream = match listener.accept().await {
            Ok(stream) => stream,
            Err(e) => {
                eprintln!("[ingress] accept failed: {e}");
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
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
async fn receive<S>(stream: S) -> io::Result<Option<IncomingSignal>>
where
    S: AsyncRead + AsyncWrite + Send + Unpin + 'static,
{
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    tokio::time::timeout(READ_TIMEOUT, (&mut reader).take(MAX_ENVELOPE_BYTES).read_line(&mut line))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "slow read"))??;
    let envelope: HookEnvelope =
        serde_json::from_str(line.trim_end()).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let reply: Option<Arc<dyn HookResponder>> =
        if envelope.expects_reply { Some(Arc::new(StreamResponder::watch(reader.into_inner()))) } else { None };
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

/// A reply line for the connection's task, and where it tells whether it got written.
type ReplyRequest = (Vec<u8>, std::sync::mpsc::Sender<bool>);

/// Open connection to a `warroom-hook` waiting for a decision. If the user answers in the terminal,
/// Claude kills the hook and EOF arrives. A task owns the connection: it watches for that EOF and
/// writes the reply when `respond` hands it over.
struct StreamResponder {
    reply: Mutex<Option<oneshot::Sender<ReplyRequest>>>,
    closed: Arc<AtomicBool>,
}

impl StreamResponder {
    fn watch<S>(stream: S) -> Self
    where
        S: AsyncRead + AsyncWrite + Send + Unpin + 'static,
    {
        let (tx, mut rx) = oneshot::channel::<ReplyRequest>();
        let closed = Arc::new(AtomicBool::new(false));
        let flag = closed.clone();
        tokio::spawn(async move {
            let (mut read, mut write) = tokio::io::split(stream);
            let mut buf = [0u8; 64];
            loop {
                tokio::select! {
                    // The bridge sends nothing else: a read only ends on EOF or error.
                    n = read.read(&mut buf) => {
                        if !matches!(n, Ok(n) if n > 0) {
                            flag.store(true, Ordering::SeqCst);
                            return;
                        }
                    }
                    reply = &mut rx, if !rx.is_terminated() => {
                        let Ok((line, done)) = reply else { continue };
                        let written = tokio::time::timeout(REPLY_WRITE_TIMEOUT, async {
                            write.write_all(&line).await?;
                            write.flush().await
                        })
                        .await;
                        let _ = done.send(matches!(written, Ok(Ok(()))));
                        return;
                    }
                }
            }
        });
        Self { reply: Mutex::new(Some(tx)), closed }
    }
}

impl HookResponder for StreamResponder {
    fn is_open(&self) -> bool {
        !self.closed.load(Ordering::SeqCst) && self.reply.lock().unwrap().is_some()
    }

    /// Blocks until the line is written (at most `REPLY_WRITE_TIMEOUT`): call it off the runtime.
    fn respond(&self, response: HookResponse) -> bool {
        let Some(tx) = self.reply.lock().unwrap().take() else { return false };
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
        let (done, written) = std::sync::mpsc::channel();
        if tx.send((line, done)).is_err() {
            return false;
        }
        written.recv_timeout(REPLY_WRITE_TIMEOUT * 2).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use awr_wire::{EnvHints, WireProcess};
    use std::path::Path;

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

    #[cfg(unix)]
    async fn connect(path: &Path) -> tokio::net::UnixStream {
        tokio::net::UnixStream::connect(path).await.unwrap()
    }

    #[cfg(windows)]
    async fn connect(path: &Path) -> tokio::net::windows::named_pipe::NamedPipeClient {
        tokio::net::windows::named_pipe::ClientOptions::new().open(awr_wire::pipe_name(path)).unwrap()
    }

    async fn next(rx: &mut tokio::sync::mpsc::UnboundedReceiver<IncomingSignal>) -> IncomingSignal {
        tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn delivers_envelopes_as_signals_even_from_old_bridges_without_newline() {
        let (_dir, path, mut rx) = server().await;

        let mut client = connect(&path).await;
        client.write_all(&serde_json::to_vec(&envelope(false)).unwrap()).await.unwrap();
        // Closing is the EOF (a named pipe's `shutdown` only flushes).
        drop(client);

        let signal = next(&mut rx).await;
        assert_eq!(signal.received_at, Some(Timestamp(42)));
        assert_eq!(signal.host.agent_pid, Some(7));
        assert_eq!(signal.host.tmux_pane.as_deref(), Some("%3"));
        assert_eq!(signal.host.tmux_socket.as_deref(), Some("/tmp/tmux-1000/default"));
        assert!(signal.reply.is_none());

        assert_eq!(bind(&path).await.err().map(|e| e.kind()), Some(io::ErrorKind::AddrInUse));
    }

    #[tokio::test]
    async fn a_waiting_bridge_receives_the_decision() {
        let (_dir, path, mut rx) = server().await;

        let mut client = connect(&path).await;
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

        let mut client = connect(&path).await;
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
