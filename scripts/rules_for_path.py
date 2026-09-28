#!/usr/bin/env python3
"""Which rule in `.cursor/rules/` covers a file: Cursor's `globs:` semantics, for every tool.

Why it exists
-------------
Cursor attaches each `.mdc` when you touch a file matching its `globs:`. Claude Code ignores that
frontmatter. This script reads the globs from the single source (each rule's frontmatter) and answers
"this file falls under hooks-ingest.mdc", so every tool decides the same way from the same data and
there is no second list to rot.

Two modes
---------
    python3 scripts/rules_for_path.py crates/infrastructure/src/ingress.rs
        -> prints the rules that apply (humans and any tool).

    python3 scripts/rules_for_path.py --hook
        -> Claude Code PostToolUse hook (Read|Edit|Write|MultiEdit): reads the hook JSON on stdin and
           returns `additionalContext` with the rules not yet announced in THIS session. Each rule is
           announced once per session (state in the temp dir): repeating it on every read is noise,
           and noise gets ignored. For big rules it adds the section index with line ranges so they
           can be read in parts. Never fails (always exit 0): a hook that breaks its caller is worse
           than no hook.
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / ".cursor" / "rules"
FILE_TOOLS = {"Read", "Edit", "Write", "MultiEdit", "NotebookEdit"}
STATE_DIR = Path(tempfile.gettempdir()) / "awr-rules-hook"
SECTIONS_FROM_BYTES = 4_000  # below this a rule is read whole; above, announce its section index


def frontmatter(rule: Path) -> dict[str, str]:
    parts = rule.read_text(encoding="utf-8", errors="replace").split("---")
    if len(parts) < 3:
        return {}
    out: dict[str, str] = {}
    for line in parts[1].splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            out[key.strip()] = value.strip()
    return out


def rule_globs(rule: Path) -> list[str]:
    return [g.strip() for g in frontmatter(rule).get("globs", "").split(",") if g.strip()]


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    """`crates/domain/**` -> anything below; `*` does not cross `/`; `**/` any depth."""
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


def rules_for(rel_path: str) -> list[Path]:
    return [
        rule
        for rule in sorted(RULES.glob("*.mdc"))
        if any(glob_to_regex(g).match(rel_path) for g in rule_globs(rule))
    ]


def section_index(rule: Path) -> str:
    lines = rule.read_text(encoding="utf-8", errors="replace").splitlines()
    heads = [(n + 1, l[3:].strip()) for n, l in enumerate(lines) if l.startswith("## ")]
    spans = []
    for k, (start, title) in enumerate(heads):
        end = heads[k + 1][0] - 1 if k + 1 < len(heads) else len(lines)
        spans.append(f"{title} ({start}-{end})")
    return "; ".join(spans)


def describe(rule: Path) -> str:
    rel = rule.relative_to(ROOT)
    text = f"- `{rel}`: {frontmatter(rule).get('description', '')}"
    if rule.stat().st_size >= SECTIONS_FROM_BYTES:
        text += f" Sections (lines): {section_index(rule)}"
    return text


def hook() -> None:
    payload = json.load(sys.stdin)
    if payload.get("tool_name") not in FILE_TOOLS:
        return
    path = (payload.get("tool_input") or {}).get("file_path") or (payload.get("tool_input") or {}).get("notebook_path")
    if not path:
        return
    try:
        rel = str(Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return  # outside the repo
    matches = rules_for(rel)
    if not matches:
        return
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    session = re.sub(r"[^A-Za-z0-9_-]", "_", str(payload.get("session_id", "unknown")))
    state = STATE_DIR / f"{session}.json"
    announced = set(json.loads(state.read_text())) if state.exists() else set()
    fresh = [r for r in matches if r.name not in announced]
    if not fresh:
        return
    state.write_text(json.dumps(sorted(announced | {r.name for r in fresh})))
    context = (
        f"`{rel}` is covered by these rules (read the router; open leaves only when their trigger "
        "matches; read big rules by section):\n" + "\n".join(describe(r) for r in fresh)
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": context}}))


def main() -> None:
    if sys.argv[1:] == ["--hook"]:
        try:
            hook()
        except Exception:  # noqa: BLE001 — a hook must never break the tool that runs it
            pass
        return
    for arg in sys.argv[1:]:
        rel = str(Path(arg).resolve().relative_to(ROOT)) if Path(arg).is_absolute() else arg
        found = rules_for(rel)
        print(f"{rel}: " + (", ".join(r.name for r in found) if found else "(no rule)"))


if __name__ == "__main__":
    main()
