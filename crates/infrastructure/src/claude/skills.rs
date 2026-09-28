//! Where a skill comes from: the repo, the user, a plugin, or built into Claude Code.

use awr_application::ports::SkillCatalog;
use awr_domain::SkillSource;
use std::path::{Path, PathBuf};

pub struct FsSkillCatalog {
    /// `~/.claude`.
    personal: PathBuf,
}

impl FsSkillCatalog {
    pub fn new(personal: PathBuf) -> Self {
        Self { personal }
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
        if project_dirs(Path::new(cwd), Path::new(worktree)).iter().any(|dir| defines(&dir.join(".claude"), name)) {
            return SkillSource::Project;
        }
        if defines(&self.personal, name) {
            return SkillSource::Personal;
        }
        SkillSource::Builtin
    }
}

/// From `cwd` up to the worktree root (Claude searches the same way).
fn project_dirs(cwd: &Path, worktree: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> =
        cwd.ancestors().take_while(|d| d.starts_with(worktree)).map(Path::to_path_buf).collect();
    if dirs.is_empty() && !worktree.as_os_str().is_empty() {
        dirs.push(worktree.to_path_buf());
    }
    dirs
}

/// `.claude/skills/<name>/` or `.claude/commands/<name>.md` inside `claude_dir`.
fn defines(claude_dir: &Path, name: &str) -> bool {
    claude_dir.join("skills").join(name).join("SKILL.md").is_file()
        || claude_dir.join("commands").join(format!("{name}.md")).is_file()
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
        skill(&repo.join(".claude"), "close-task");
        skill(&home, "teacher-content");
        std::fs::create_dir_all(home.join("commands")).unwrap();
        std::fs::write(home.join("commands/deploy.md"), "x").unwrap();
        std::fs::create_dir_all(repo.join("src/app")).unwrap();

        let catalog = FsSkillCatalog::new(home);
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
