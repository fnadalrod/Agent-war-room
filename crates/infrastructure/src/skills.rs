//! Where a skill comes from: the repo, the user, a plugin, or built into the agent. Claude Code and
//! Codex lay skills out the same way (`<dir>/skills/<name>/SKILL.md`); they differ in which
//! directories they search.

use awr_application::ports::SkillCatalog;
use awr_domain::SkillSource;
use std::path::{Path, PathBuf};

pub struct FsSkillCatalog {
    /// Folders searched inside the repo, from `cwd` up to the worktree root: `.claude`, `.codex`…
    project: &'static [&'static str],
    /// The user's own: `~/.claude`, `~/.codex`, `~/.agents`…
    personal: Vec<PathBuf>,
}

impl FsSkillCatalog {
    pub fn new(project: &'static [&'static str], personal: Vec<PathBuf>) -> Self {
        Self { project, personal }
    }

    /// Claude Code: `.claude/` in the repo and `~/.claude`.
    pub fn claude(home: &Path) -> Self {
        Self::new(&[".claude"], vec![home.join(".claude")])
    }

    /// Cursor: `.cursor/` in the repo and `~/.cursor`.
    pub fn cursor(home: &Path) -> Self {
        Self::new(&[".cursor"], vec![home.join(".cursor")])
    }

    /// Antigravity: `.agents/` (or `.agent/`) in the repo and its global root, `~/.gemini/config`.
    pub fn antigravity(home: &Path) -> Self {
        Self::new(&[".agents", ".agent"], vec![home.join(".gemini/config")])
    }

    /// Codex: `.codex/` and `.agents/` in the repo, `$CODEX_HOME` (`~/.codex`) and `~/.agents`.
    pub fn codex(home: &Path, codex_home: PathBuf) -> Self {
        Self::new(&[".codex", ".agents"], vec![codex_home, home.join(".agents")])
    }
}

impl SkillCatalog for FsSkillCatalog {
    fn classify(&self, name: &str, cwd: &str, worktree: &str) -> SkillSource {
        if name.contains(':') {
            return SkillSource::Plugin;
        }
        // The name ends up in a path: no separators or `..`.
        if name.is_empty() || name.contains('/') || name.contains("..") {
            return SkillSource::Builtin;
        }
        let in_repo = project_dirs(Path::new(cwd), Path::new(worktree))
            .iter()
            .any(|dir| self.project.iter().any(|folder| defines(&dir.join(folder), name)));
        if in_repo {
            return SkillSource::Project;
        }
        if self.personal.iter().any(|dir| defines(dir, name)) {
            return SkillSource::Personal;
        }
        SkillSource::Builtin
    }
}

/// From `cwd` up to the worktree root (the agents search the same way).
fn project_dirs(cwd: &Path, worktree: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> =
        cwd.ancestors().take_while(|d| d.starts_with(worktree)).map(Path::to_path_buf).collect();
    if dirs.is_empty() && !worktree.as_os_str().is_empty() {
        dirs.push(worktree.to_path_buf());
    }
    dirs
}

/// `<dir>/skills/<name>/SKILL.md` or `<dir>/commands/<name>.md`.
fn defines(dir: &Path, name: &str) -> bool {
    dir.join("skills").join(name).join("SKILL.md").is_file()
        || dir.join("commands").join(format!("{name}.md")).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(dir: &Path, name: &str) {
        std::fs::create_dir_all(dir.join("skills").join(name)).unwrap();
        std::fs::write(dir.join("skills").join(name).join("SKILL.md"), "---\nname: x\n---").unwrap();
    }

    #[test]
    fn tells_apart_project_personal_plugin_and_builtin_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        let home = tmp.path().join("home/.claude");
        let user_home = tmp.path().join("home");
        skill(&repo.join(".claude"), "close-task");
        skill(&home, "teacher-content");
        std::fs::create_dir_all(home.join("commands")).unwrap();
        std::fs::write(home.join("commands/deploy.md"), "x").unwrap();
        std::fs::create_dir_all(repo.join("src/app")).unwrap();

        let catalog = FsSkillCatalog::claude(&user_home);
        let cwd = repo.join("src/app");
        let (cwd, repo) = (cwd.to_str().unwrap(), repo.to_str().unwrap());
        assert_eq!(catalog.classify("close-task", cwd, repo), SkillSource::Project, "from a subfolder");
        assert_eq!(catalog.classify("teacher-content", cwd, repo), SkillSource::Personal);
        assert_eq!(catalog.classify("deploy", cwd, repo), SkillSource::Personal);
        assert_eq!(catalog.classify("anthropic-skills:docx", cwd, repo), SkillSource::Plugin);
        assert_eq!(catalog.classify("claude-api", cwd, repo), SkillSource::Builtin);
        assert_eq!(catalog.classify("../../x", cwd, repo), SkillSource::Builtin);
    }
}

#[cfg(test)]
mod codex_tests {
    use super::*;

    #[test]
    fn codex_looks_in_codex_and_agents_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let (repo, home) = (tmp.path().join("repo"), tmp.path().join("home"));
        for (dir, name) in
            [(repo.join(".agents"), "verify"), (home.join(".codex"), "mine"), (home.join(".agents"), "shared")]
        {
            std::fs::create_dir_all(dir.join("skills").join(name)).unwrap();
            std::fs::write(dir.join("skills").join(name).join("SKILL.md"), "x").unwrap();
        }
        let catalog = FsSkillCatalog::codex(&home, home.join(".codex"));
        let repo = repo.to_str().unwrap();
        assert_eq!(catalog.classify("verify", repo, repo), SkillSource::Project);
        assert_eq!(catalog.classify("mine", repo, repo), SkillSource::Personal);
        assert_eq!(catalog.classify("shared", repo, repo), SkillSource::Personal);
        assert_eq!(catalog.classify("imagegen", repo, repo), SkillSource::Builtin);
    }
}
