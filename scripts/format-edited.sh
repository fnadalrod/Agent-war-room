#!/usr/bin/env bash
# Claude Code PostToolUse hook: rustfmt the Rust file that was just edited, so diffs stay clean and
# agents never spend a turn on formatting. Silent and always exits 0: it must never block an edit.
path=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
case "$path" in
  *.rs) rustfmt --edition 2024 --quiet "$path" >/dev/null 2>&1 ;;
esac
exit 0
