//! Adaptador de entrada: socket Unix donde `warroom-hook` deja un envelope por conexión.

use awr_application::IncomingSignal;
use awr_domain::{ProcessInfo, TerminalHost, Timestamp};
use awr_wire::{HookEnvelope, PROTOCOL_VERSION};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::net::{UnixListener, UnixStream};

const MAX_ENVELOPE_BYTES: u64 = 8 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(2);

pub type SignalHandler = Arc<dyn Fn(IncomingSignal) + Send + Sync>;

/// Deja el socket escuchando. Falla si otra instancia de la app ya lo tiene.
pub async fn bind(path: &Path) -> io::Result<UnixListener> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    if path.exists() {
        if UnixStream::connect(path).await.is_ok() {
            return Err(io::Error::new(io::ErrorKind::AddrInUse, "otra instancia ya escucha en el socket"));
        }
        std::fs::remove_file(path)?;
    }
    UnixListener::bind(path)
}

/// Acepta conexiones para siempre. El handler se ejecuta fuera del runtime async (hace IO bloqueante).
pub async fn serve(listener: UnixListener, handler: SignalHandler) {
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let handler = handler.clone();
        tokio::spawn(async move {
            match read_envelope(stream).await {
                Ok(envelope) => {
                    if let Some(signal) = to_signal(envelope) {
                        let _ = tokio::task::spawn_blocking(move || handler(signal)).await;
                    }
                }
                Err(e) => eprintln!("[ingress] envelope descartado: {e}"),
            }
        });
    }
}

pub fn default_socket_path() -> PathBuf {
    awr_wire::socket_path()
}

async fn read_envelope(stream: UnixStream) -> io::Result<HookEnvelope> {
    let mut buf = Vec::new();
    tokio::time::timeout(READ_TIMEOUT, stream.take(MAX_ENVELOPE_BYTES).read_to_end(&mut buf))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "lectura lenta"))??;
    serde_json::from_slice(&buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn to_signal(envelope: HookEnvelope) -> Option<IncomingSignal> {
    if envelope.v != PROTOCOL_VERSION {
        eprintln!("[ingress] versión de protocolo {} no soportada", envelope.v);
        return None;
    }
    Some(IncomingSignal {
        provider: envelope.provider,
        received_at: Some(Timestamp(envelope.received_at_ms)),
        host: TerminalHost {
            agent_pid: envelope.agent_pid,
            ancestry: envelope
                .ancestry
                .into_iter()
                .map(|p| ProcessInfo { pid: p.pid, name: p.name })
                .collect(),
            tmux_pane: envelope.env.tmux_pane,
            // `$TMUX` es `socket,pid_servidor,sesión`.
            tmux_socket: envelope.env.tmux.and_then(|t| t.split(',').next().map(str::to_owned)),
            term_program: envelope.env.term_program,
            warp_focus_url: envelope.env.warp_focus_url,
            pty_id: envelope.env.pty_id,
        },
        payload: envelope.payload,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use awr_wire::{EnvHints, WireProcess};
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn delivers_envelopes_as_signals() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sock/ingress.sock");
        let listener = bind(&path).await.unwrap();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(serve(listener, Arc::new(move |s| tx.send(s).unwrap())));

        let envelope = HookEnvelope {
            v: PROTOCOL_VERSION,
            provider: "claude".into(),
            received_at_ms: 42,
            agent_pid: Some(7),
            ancestry: vec![WireProcess { pid: 7, name: "claude".into() }],
            env: EnvHints { tmux_pane: Some("%3".into()), ..Default::default() },
            payload: serde_json::json!({ "hook_event_name": "Stop" }),
        };
        let mut client = UnixStream::connect(&path).await.unwrap();
        client.write_all(&serde_json::to_vec(&envelope).unwrap()).await.unwrap();
        client.shutdown().await.unwrap();

        let signal = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap().unwrap();
        assert_eq!(signal.received_at, Some(Timestamp(42)));
        assert_eq!(signal.host.agent_pid, Some(7));
        assert_eq!(signal.host.tmux_pane.as_deref(), Some("%3"));
        assert_eq!(signal.payload["hook_event_name"], "Stop");

        assert_eq!(bind(&path).await.unwrap_err().kind(), io::ErrorKind::AddrInUse);
    }
}
