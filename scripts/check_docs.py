#!/usr/bin/env python3
"""Mechanical checks of the agent docs, so the judgement part (skill `anti-rot`) starts from clean.

Checks:
  1. paths    — backticked paths and file names in agent docs exist (repo path or known basename).
  2. reach    — every router (`.cursor/rules/*.mdc`) is listed in the root AGENTS.md.
  3. leaves   — every leaf (`.cursor/rules/*.md`) is named by at least one router (its trigger).
  4. globs    — every router glob matches at least one tracked file.
  5. skills   — each skill dir has SKILL.md with `name` = dir and a `description`, and is in the index.
  6. agents   — each subagent has `name` = file name and a `description`, and is in the index.
  7. links    — `.claude/skills` and `.claude/agents` are symlinks into `.agents/`.
  8. nested   — nested CLAUDE.md files import `@AGENTS.md` and it exists next to them.
  9. size     — AGENTS.md ≤ 10 KB (paid every session), rules ≤ 16 KB, skills ≤ 8 KB.

Exit 1 with a list of problems, 0 when clean.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / ".cursor" / "rules"
SKILLS = ROOT / ".agents" / "skills"
AGENTS = ROOT / ".agents" / "agents"
problems: list[str] = []


def fail(check: str, message: str) -> None:
    problems.append(f"[{check}] {message}")


def tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [line for line in out.splitlines() if line]


FILES = tracked()
BASENAMES = {Path(f).name for f in FILES}


def agent_docs() -> list[Path]:
    docs = [ROOT / "AGENTS.md", ROOT / ".agents" / "README.md"]
    docs += [ROOT / f for f in FILES if f.endswith("AGENTS.md") and f != "AGENTS.md"]
    docs += sorted(RULES.glob("*.md*")) + sorted(SKILLS.glob("*/SKILL.md")) + sorted(AGENTS.glob("*.md"))
    docs += [SKILLS / "README.md"]
    return [d for d in docs if d.exists()]


def frontmatter(path: Path) -> dict[str, str]:
    parts = path.read_text(encoding="utf-8").split("---")
    if len(parts) < 3:
        return {}
    return {k.strip(): v.strip() for k, _, v in (l.partition(":") for l in parts[1].splitlines()) if _}


PATHLIKE = re.compile(r"`([^`\s]+\.(?:mdc|md|rs|ts|tsx|sh|py|mjs|json|toml|css|html))`")


def check_paths() -> None:
    for doc in agent_docs():
        for mention in PATHLIKE.findall(doc.read_text(encoding="utf-8")):
            if any(c in mention for c in "<>*{}$~") or mention.startswith("http"):
                continue
            path = mention.split("::")[0].lstrip("@./")  # `@AGENTS.md` is a Claude Code import
            candidates = [ROOT / path, doc.parent / path, RULES / path]
            if any(c.exists() for c in candidates) or Path(path).name in BASENAMES:
                continue
            fail("paths", f"{doc.relative_to(ROOT)} cites `{mention}`, which does not exist")


def check_reach() -> None:
    index = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    for router in sorted(RULES.glob("*.mdc")):
        if router.name not in index:
            fail("reach", f"{router.name} is not listed in AGENTS.md")


def check_leaves() -> None:
    routers = " ".join(r.read_text(encoding="utf-8") for r in RULES.glob("*.mdc"))
    for leaf in sorted(RULES.glob("*.md")):
        if leaf.name not in routers:
            fail("leaves", f"{leaf.name} is not named by any router (no trigger → never read)")


def glob_regex(pattern: str) -> re.Pattern[str]:
    regex, i = "^", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            regex, i = regex + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            regex, i = regex + ".*", i + 2
        elif pattern[i] == "*":
            regex, i = regex + "[^/]*", i + 1
        else:
            regex, i = regex + re.escape(pattern[i]), i + 1
    return re.compile(regex + "$")


def check_globs() -> None:
    for router in sorted(RULES.glob("*.mdc")):
        for g in (x.strip() for x in frontmatter(router).get("globs", "").split(",")):
            if g and not any(glob_regex(g).match(f) for f in FILES):
                fail("globs", f"{router.name}: glob `{g}` matches no file")


def check_skills() -> None:
    index = (SKILLS / "README.md").read_text(encoding="utf-8")
    for skill in sorted(p for p in SKILLS.iterdir() if p.is_dir()):
        doc = skill / "SKILL.md"
        if not doc.exists():
            fail("skills", f"{skill.name}/ has no SKILL.md")
            continue
        fm = frontmatter(doc)
        if fm.get("name") != skill.name or not fm.get("description"):
            fail("skills", f"{skill.name}/SKILL.md needs name: {skill.name} and a description")
        if f"`{skill.name}`" not in index:
            fail("skills", f"{skill.name} is missing from .agents/skills/README.md")


def check_agents() -> None:
    index = (AGENTS / "README.md").read_text(encoding="utf-8")
    for agent in sorted(p for p in AGENTS.glob("*.md") if p.name != "README.md"):
        fm = frontmatter(agent)
        if fm.get("name") != agent.stem or not fm.get("description"):
            fail("agents", f"{agent.name} needs name: {agent.stem} and a description")
        if f"`{agent.stem}`" not in index:
            fail("agents", f"{agent.stem} is missing from .agents/agents/README.md")


def check_links() -> None:
    for name in ("skills", "agents"):
        link = ROOT / ".claude" / name
        if not link.is_symlink() or link.resolve() != (ROOT / ".agents" / name).resolve():
            fail("links", f".claude/{name} must be a symlink to .agents/{name}")


def check_nested() -> None:
    for f in FILES:
        if f.endswith("CLAUDE.md") and f != "CLAUDE.md":
            path = ROOT / f
            if "@AGENTS.md" not in path.read_text(encoding="utf-8"):
                fail("nested", f"{f} should import @AGENTS.md")
            if not (path.parent / "AGENTS.md").exists():
                fail("nested", f"{f} imports @AGENTS.md but there is none next to it")


def check_sizes() -> None:
    limits = [(ROOT / "AGENTS.md", 10_000)] + [(r, 16_000) for r in RULES.glob("*.md*")]
    limits += [(s, 8_000) for s in SKILLS.glob("*/SKILL.md")]
    for path, limit in limits:
        size = path.stat().st_size
        if size > limit:
            fail("size", f"{path.relative_to(ROOT)} is {size} bytes (limit {limit}): split it (doc-seeding.md)")


def main() -> int:
    for check in (check_paths, check_reach, check_leaves, check_globs, check_skills, check_agents,
                  check_links, check_nested, check_sizes):
        check()
    if problems:
        print("\n".join(problems))
        print(f"{len(problems)} problem(s)")
        return 1
    print("docs ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
