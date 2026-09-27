use awr_application::ports::RepoResolver;
use awr_domain::{RepoId, Workspace};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// La rama puede cambiar durante la sesión; no hace falta preguntarle a git en cada hook.
const CACHE_TTL: Duration = Duration::from_secs(30);

/// Resuelve la sala (repo) y el puesto (worktree) de una carpeta con `git rev-parse`.
#[derive(Default)]
pub struct GitRepoResolver {
    cache: Mutex<HashMap<String, (Instant, Workspace)>>,
}

impl GitRepoResolver {
    pub fn new() -> Self {
        Self::default()
    }
}

impl RepoResolver for GitRepoResolver {
    fn resolve(&self, cwd: &str) -> Workspace {
        if let Some((at, ws)) = self.cache.lock().unwrap().get(cwd)
            && at.elapsed() < CACHE_TTL
        {
            return ws.clone();
        }
        let ws = rev_parse(cwd).unwrap_or_else(|| outside_git(cwd));
        self.cache.lock().unwrap().insert(cwd.to_owned(), (Instant::now(), ws.clone()));
        ws
    }
}

fn rev_parse(cwd: &str) -> Option<Workspace> {
    // Sin HEAD: un repo sin commits sigue siendo un repo.
    let text = git(cwd, &["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir", "--show-toplevel"])?;
    let mut lines = text.lines();
    let common_dir = lines.next()?.to_owned();
    let git_dir = lines.next()?;
    let toplevel = lines.next()?.to_owned();

    Some(Workspace {
        repo_name: repo_name(&common_dir, &toplevel),
        is_linked_worktree: git_dir != common_dir,
        repo: RepoId(common_dir),
        worktree_path: toplevel,
        branch: branch(cwd),
    })
}

/// Rama actual (también sin commits); en detached HEAD, `@<sha corto>`.
fn branch(cwd: &str) -> Option<String> {
    git(cwd, &["symbolic-ref", "-q", "--short", "HEAD"])
        .or_else(|| git(cwd, &["rev-parse", "--short", "HEAD"]).map(|sha| format!("@{sha}")))
}

fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(cwd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8(out.stdout).ok()?;
    Some(text.trim_end().to_owned()).filter(|t| !t.is_empty())
}

/// `/code/Tintero3Repo/.git` → `Tintero3Repo`, también desde cualquiera de sus worktrees.
fn repo_name(common_dir: &str, toplevel: &str) -> String {
    let common = Path::new(common_dir);
    let named = if common.file_name().is_some_and(|n| n == ".git") { common.parent() } else { Some(common) };
    named
        .and_then(Path::file_name)
        .or_else(|| Path::new(toplevel).file_name())
        .map(|n| n.to_string_lossy().trim_end_matches(".git").to_owned())
        .unwrap_or_else(|| toplevel.to_owned())
}

fn outside_git(cwd: &str) -> Workspace {
    Workspace {
        repo: RepoId(cwd.to_owned()),
        repo_name: Path::new(cwd)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| cwd.to_owned()),
        worktree_path: cwd.to_owned(),
        branch: None,
        is_linked_worktree: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap().status.success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn worktrees_share_the_room_of_their_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("Proyecto");
        std::fs::create_dir(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"]);
        let wt = tmp.path().join("Proyecto-wt-f1");
        git(&main, &["worktree", "add", "-q", "-b", "f1", wt.to_str().unwrap()]);

        let resolver = GitRepoResolver::new();
        let a = resolver.resolve(main.to_str().unwrap());
        let b = resolver.resolve(wt.to_str().unwrap());

        assert_eq!(a.repo, b.repo);
        assert_eq!(a.repo_name, "Proyecto");
        assert_eq!(b.repo_name, "Proyecto");
        assert_eq!(a.branch.as_deref(), Some("main"));
        assert_eq!(b.branch.as_deref(), Some("f1"));
        assert!(!a.is_linked_worktree);
        assert!(b.is_linked_worktree);
    }

    #[test]
    fn a_repo_without_commits_is_still_a_repo_and_detached_head_shows_the_sha() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Nuevo");
        std::fs::create_dir(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);

        let ws = GitRepoResolver::new().resolve(dir.to_str().unwrap());
        assert_eq!(ws.repo_name, "Nuevo");
        assert!(ws.repo.0.ends_with("Nuevo/.git"));
        assert_eq!(ws.branch.as_deref(), Some("main"));

        git(&dir, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"]);
        git(&dir, &["checkout", "-q", "--detach"]);
        let ws = GitRepoResolver::new().resolve(dir.to_str().unwrap());
        assert!(ws.branch.unwrap().starts_with('@'));
    }

    #[test]
    fn folders_outside_git_are_their_own_room() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = GitRepoResolver::new().resolve(tmp.path().to_str().unwrap());
        assert_eq!(ws.repo.0, tmp.path().to_str().unwrap());
        assert_eq!(ws.branch, None);
    }
}
