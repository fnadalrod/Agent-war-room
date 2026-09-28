use awr_application::ports::{CommitInfo, GitHistory, PortError, PortResult, RepoResolver};
use awr_domain::{RepoId, Workspace};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The branch may change during a session, but there is no need to ask git on every hook.
const CACHE_TTL: Duration = Duration::from_secs(30);

/// Resolves a folder's room (repo) and desk (worktree) with `git rev-parse`.
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
    // No HEAD: a repo without commits is still a repo.
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

/// Current branch (also without commits); on a detached HEAD, `@<short sha>`.
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

/// `/code/Harbor3Repo/.git` → `Harbor3Repo`, also from any of its worktrees.
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

/// Largest diff sent to the UI.
const SHOW_MAX_BYTES: usize = 400 * 1024;
/// Most commits listed for one session.
const LOG_MAX: &str = "200";

/// Git history through the `git` CLI.
pub struct GitCli;

impl GitHistory for GitCli {
    fn commits(&self, worktree: &str, since: i64, until: Option<i64>) -> PortResult<Vec<CommitInfo>> {
        let since_arg = format!("--since=@{}", since.div_euclid(1000));
        let until_arg = until.map(|u| format!("--until=@{}", u.div_euclid(1000) + 1));
        // Record separator \x1e before each commit, unit separator \x1f between fields.
        let mut args = vec!["log", "HEAD", "-n", LOG_MAX, "--shortstat", "--format=%x1e%H%x1f%an%x1f%at%x1f%s"];
        args.push(&since_arg);
        if let Some(until) = &until_arg {
            args.push(until);
        }
        let out = git(worktree, &args).unwrap_or_default();
        Ok(out.split('\x1e').filter_map(parse_commit).collect())
    }

    fn show(&self, worktree: &str, hash: &str) -> PortResult<String> {
        let mut out = git(worktree, &["show", "--stat", "--patch", "--format=fuller", "--no-color", hash])
            .ok_or_else(|| PortError::Failed(format!("git show {hash} failed")))?;
        if out.len() > SHOW_MAX_BYTES {
            let cut = (0..=SHOW_MAX_BYTES).rev().find(|i| out.is_char_boundary(*i)).unwrap_or(0);
            out.truncate(cut);
            out.push_str("\n…");
        }
        Ok(out)
    }
}

/// `<hash>\x1f<author>\x1f<unix secs>\x1f<subject>` + an optional `--shortstat` line.
fn parse_commit(record: &str) -> Option<CommitInfo> {
    let mut lines = record.trim().lines();
    let mut fields = lines.next()?.split('\x1f');
    let (hash, author, at, subject) = (fields.next()?, fields.next()?, fields.next()?, fields.next()?);
    let stat = lines.find(|l| l.contains("changed")).unwrap_or_default();
    let number_before = |word: &str| {
        stat.split(',')
            .find(|part| part.contains(word))
            .and_then(|part| part.split_whitespace().next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(0)
    };
    Some(CommitInfo {
        hash: hash.to_owned(),
        subject: subject.to_owned(),
        author: author.to_owned(),
        at: at.parse::<i64>().ok()? * 1000,
        files_changed: number_before("changed"),
        insertions: number_before("insertion"),
        deletions: number_before("deletion"),
    })
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
        let main = tmp.path().join("Project");
        std::fs::create_dir(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"]);
        let wt = tmp.path().join("Project-wt-f1");
        git(&main, &["worktree", "add", "-q", "-b", "f1", wt.to_str().unwrap()]);

        let resolver = GitRepoResolver::new();
        let a = resolver.resolve(main.to_str().unwrap());
        let b = resolver.resolve(wt.to_str().unwrap());

        assert_eq!(a.repo, b.repo);
        assert_eq!(a.repo_name, "Project");
        assert_eq!(b.repo_name, "Project");
        assert_eq!(a.branch.as_deref(), Some("main"));
        assert_eq!(b.branch.as_deref(), Some("f1"));
        assert!(!a.is_linked_worktree);
        assert!(b.is_linked_worktree);
    }

    #[test]
    fn a_repo_without_commits_is_still_a_repo_and_detached_head_shows_the_sha() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Fresh");
        std::fs::create_dir(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);

        let ws = GitRepoResolver::new().resolve(dir.to_str().unwrap());
        assert_eq!(ws.repo_name, "Fresh");
        assert!(ws.repo.0.ends_with("Fresh/.git"));
        assert_eq!(ws.branch.as_deref(), Some("main"));

        git(&dir, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"]);
        git(&dir, &["checkout", "-q", "--detach"]);
        let ws = GitRepoResolver::new().resolve(dir.to_str().unwrap());
        assert!(ws.branch.unwrap().starts_with('@'));
    }

    #[test]
    fn lists_commits_in_a_time_window_with_their_stats_and_shows_one() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        git(repo, &["init", "-q", "-b", "main"]);
        let commit = |file: &str, body: &str, msg: &str, date: &str| {
            std::fs::write(repo.join(file), body).unwrap();
            git(repo, &["add", "."]);
            let ok = Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(["-c", "user.name=Ana", "-c", "user.email=a@a", "commit", "-q", "-m", msg])
                .env("GIT_AUTHOR_DATE", date)
                .env("GIT_COMMITTER_DATE", date)
                .status()
                .unwrap()
                .success();
            assert!(ok);
        };
        commit("a.txt", "one\n", "before the session", "2026-01-01T10:00:00Z");
        commit("b.txt", "two\nthree\n", "fix login", "2026-01-01T12:00:00Z");

        let noon_minus_1h = 1_767_265_200_000; // 2026-01-01T11:00:00Z
        let wt = repo.to_str().unwrap();
        let commits = GitCli.commits(wt, noon_minus_1h, None).unwrap();
        assert_eq!(commits.len(), 1);
        let c = &commits[0];
        assert_eq!((c.subject.as_str(), c.author.as_str()), ("fix login", "Ana"));
        assert_eq!((c.files_changed, c.insertions, c.deletions), (1, 2, 0));
        assert_eq!(c.at, 1_767_268_800_000);
        assert!(GitCli.commits(wt, noon_minus_1h, Some(noon_minus_1h + 1)).unwrap().is_empty());

        let shown = GitCli.show(wt, &c.hash).unwrap();
        assert!(shown.contains("+three") && shown.contains("fix login"));
        assert!(GitCli.show(wt, "0000000").is_err());
    }

    #[test]
    fn folders_outside_git_are_their_own_room() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = GitRepoResolver::new().resolve(tmp.path().to_str().unwrap());
        assert_eq!(ws.repo.0, tmp.path().to_str().unwrap());
        assert_eq!(ws.branch, None);
    }
}
