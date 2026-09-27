//! Activación de ventanas en KDE Plasma (X11 y Wayland) con un script de KWin cargado por DBus.
//! En Wayland es la única vía: solo el compositor puede dar el foco a otra aplicación.

use std::path::PathBuf;
use std::process::Command;

const SCRIPT_NAME: &str = "agent-war-room-focus";

pub struct Kwin {
    script_path: PathBuf,
}

impl Kwin {
    pub fn detect() -> Option<Self> {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        if !desktop.to_uppercase().contains("KDE") {
            return None;
        }
        busctl(&["status", "org.kde.KWin"]).ok()?;
        Some(Self { script_path: awr_wire::runtime_dir().join("kwin-focus.js") })
    }

    /// Activa la ventana normal cuyo PID aparezca antes en `pids`; entre varias del mismo proceso
    /// (IDE con varios proyectos, varias ventanas de Warp) gana la que tenga una pista en el título.
    pub fn activate(&self, pids: &[u32], hints: &[String]) -> Result<(), String> {
        if pids.is_empty() {
            return Err("sin procesos candidatos".into());
        }
        if let Some(dir) = self.script_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&self.script_path, script(pids, hints)).map_err(|e| e.to_string())?;

        let path = self.script_path.to_string_lossy();
        let _ = busctl(&["call", "org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", "s", SCRIPT_NAME]);
        let loaded = busctl(&["call", "org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "loadScript", "ss", &path, SCRIPT_NAME])?;
        // Respuesta: `i <id>`.
        let id: i64 = loaded
            .split_whitespace()
            .nth(1)
            .and_then(|n| n.parse().ok())
            .filter(|id| *id >= 0)
            .ok_or_else(|| format!("KWin no cargó el script: {loaded}"))?;
        busctl(&["call", "org.kde.KWin", &format!("/Scripting/Script{id}"), "org.kde.kwin.Script", "run"])?;
        Ok(())
    }
}

fn script(pids: &[u32], hints: &[String]) -> String {
    let hints: Vec<String> = hints.iter().map(|h| h.to_lowercase()).filter(|h| !h.is_empty()).collect();
    format!(
        r#"(function () {{
    const pids = {pids};
    const hints = {hints};
    const wordChar = /[a-z0-9_-]/;
    function wholeWord(text, word) {{
        for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {{
            const before = i > 0 ? text[i - 1] : "";
            const after = text[i + word.length] || "";
            if (!wordChar.test(before) && !wordChar.test(after)) return true;
        }}
        return false;
    }}
    const windows = workspace.windowList ? workspace.windowList() : workspace.clientList();
    let best = null, bestScore = -1;
    for (const w of windows) {{
        if (!w.normalWindow) continue;
        const rank = pids.indexOf(w.pid);
        if (rank < 0) continue;
        const caption = String(w.caption || "").toLowerCase();
        // "Tintero" no debe ganar en "Tintero3Repo": la palabra completa pesa diez veces más.
        let bonus = 0;
        for (let i = 0; i < hints.length; i++) {{
            const weight = (hints.length - i) * 1000;
            if (wholeWord(caption, hints[i])) bonus = Math.max(bonus, weight * 10);
            else if (caption.indexOf(hints[i]) >= 0) bonus = Math.max(bonus, weight);
        }}
        const score = 100 - rank + bonus;
        if (score > bestScore) {{ best = w; bestScore = score; }}
    }}
    if (!best) return;
    if (best.minimized) best.minimized = false;
    if (best.desktops && best.desktops.length && best.desktops.indexOf(workspace.currentDesktop) < 0) {{
        workspace.currentDesktop = best.desktops[0];
    }}
    if ("activeWindow" in workspace) workspace.activeWindow = best; else workspace.activeClient = best;
}})();
"#,
        pids = serde_json::to_string(pids).unwrap_or_else(|_| "[]".into()),
        hints = serde_json::to_string(&hints).unwrap_or_else(|_| "[]".into()),
    )
}

fn busctl(args: &[&str]) -> Result<String, String> {
    let out = Command::new("busctl").arg("--user").args(args).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_embeds_pids_and_lowercased_hints_as_json() {
        let s = script(&[10, 20], &["Tintero3Repo-wt-f1".into(), "".into(), "It's \"quoted\"".into()]);
        assert!(s.contains("const pids = [10,20];"));
        assert!(s.contains(r#"const hints = ["tintero3repo-wt-f1","it's \"quoted\""];"#));
    }

    /// Ejecuta el script real contra un `workspace` simulado con títulos de un IDE con varios
    /// proyectos abiertos en un mismo proceso. Requiere Node; si no está, se omite.
    #[test]
    fn picks_the_window_whose_caption_names_the_worktree() {
        const HARNESS: &str = r#"
            const captions = ["TinteroBackend – Makefile", "Tintero3Repo – Commit: x.ts", "Tintero2Repo – .env", "Tintero – Commit: y.ts"];
            let active = null;
            globalThis.workspace = { windowList: () => captions.map(caption => ({ pid: 5638, caption, normalWindow: true, desktops: [] })) };
            Object.defineProperty(workspace, "activeWindow", { set(w) { active = w; }, get() { return active; }, enumerable: true });
            eval(require("fs").readFileSync(0, "utf8"));
            process.stdout.write(active ? active.caption : "");
        "#;
        let pick = |hints: &[&str]| -> Option<String> {
            use std::io::Write;
            let hints: Vec<String> = hints.iter().map(|h| h.to_string()).collect();
            let mut child = std::process::Command::new("node")
                .args(["-e", HARNESS])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .ok()?;
            child.stdin.take()?.write_all(script(&[5638], &hints).as_bytes()).ok()?;
            String::from_utf8(child.wait_with_output().ok()?.stdout).ok()
        };
        let Some(tintero) = pick(&["Tintero", "Tintero"]) else { return };
        assert_eq!(tintero, "Tintero – Commit: y.ts");
        assert_eq!(pick(&["Tintero3Repo-wt-f1", "Tintero3Repo"]).unwrap(), "Tintero3Repo – Commit: x.ts");
        assert_eq!(pick(&["Un título", "Tintero2Repo"]).unwrap(), "Tintero2Repo – .env");
    }
}

#[cfg(test)]
mod live {
    /// Manual: `cargo test -p awr-infrastructure kwin_live -- --ignored`. Activa la ventana que
    /// contiene a este proceso (la terminal o IDE desde el que se lanza).
    #[test]
    #[ignore]
    fn kwin_live_activates_the_window_of_this_process_tree() {
        let kwin = super::Kwin::detect().expect("KDE Plasma con KWin");
        let pids = crate::desktop::proc::ancestry(std::process::id());
        kwin.activate(&pids, &["AgentWarRoom".into()]).unwrap();
    }
}

