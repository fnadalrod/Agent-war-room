use std::process::Command;

/// Lleva el pane al frente de su ventana y a un cliente adjunto. Devuelve el PID de ese cliente
/// (la terminal a enfocar después), o `None` si nadie está mirando ese servidor de tmux.
pub fn select(socket: Option<&str>, pane: &str) -> Result<Option<u32>, String> {
    let tmux = |args: &[&str]| run(socket, args);
    tmux(&["select-window", "-t", pane])?;
    tmux(&["select-pane", "-t", pane])?;
    let session = tmux(&["display-message", "-p", "-t", pane, "#{session_name}"])?;

    let clients = tmux(&["list-clients", "-F", "#{client_pid} #{client_tty} #{client_activity} #{session_name}"])?;
    let mut clients: Vec<Client> = clients.lines().filter_map(Client::parse).collect();
    clients.sort_by_key(|c| std::cmp::Reverse(c.activity));

    if let Some(client) = clients.iter().find(|c| c.session == session) {
        return Ok(Some(client.pid));
    }
    // Nadie mira esa sesión: el cliente usado más recientemente se cambia a ella.
    match clients.first() {
        Some(client) => {
            tmux(&["switch-client", "-c", &client.tty, "-t", pane])?;
            Ok(Some(client.pid))
        }
        None => Ok(None),
    }
}

struct Client {
    pid: u32,
    tty: String,
    activity: u64,
    session: String,
}

impl Client {
    fn parse(line: &str) -> Option<Self> {
        let mut parts = line.splitn(4, ' ');
        Some(Self {
            pid: parts.next()?.parse().ok()?,
            tty: parts.next()?.to_owned(),
            activity: parts.next()?.parse().unwrap_or(0),
            session: parts.next()?.to_owned(),
        })
    }
}

fn run(socket: Option<&str>, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("tmux");
    if let Some(socket) = socket {
        cmd.args(["-S", socket]);
    }
    let out = cmd.args(args).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_owned())
}

/// Escribe texto en un pane como si se tecleara, y opcionalmente pulsa Enter.
pub fn send_text(socket: Option<&str>, pane: &str, text: &str, submit: bool) -> Result<(), String> {
    run(socket, &["send-keys", "-t", pane, "-l", text])?;
    if submit {
        run(socket, &["send-keys", "-t", pane, "Enter"])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_client_lines_with_spaces_in_the_session_name() {
        let c = Client::parse("1234 /dev/pts/3 1790000000 mi sesión").unwrap();
        assert_eq!((c.pid, c.tty.as_str(), c.activity, c.session.as_str()), (1234, "/dev/pts/3", 1790000000, "mi sesión"));
    }

    /// Servidor tmux aislado (socket propio) para no tocar el del usuario.
    #[test]
    fn selects_a_pane_on_a_private_server_and_reports_no_client() {
        if Command::new("tmux").arg("-V").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("t.sock");
        let socket = socket.to_str().unwrap();
        run(Some(socket), &["new-session", "-d", "-s", "prueba", "-x", "80", "-y", "20"]).unwrap();
        let pane = run(Some(socket), &["display-message", "-p", "-t", "prueba", "#{pane_id}"]).unwrap();

        assert_eq!(select(Some(socket), &pane), Ok(None));
        send_text(Some(socket), &pane, "echo hola-war-room", true).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let screen = run(Some(socket), &["capture-pane", "-p", "-t", &pane]).unwrap();
        assert!(screen.contains("hola-war-room"));

        let _ = run(Some(socket), &["kill-server"]);
    }
}
