#!/usr/bin/env bash
# Fast, scoped, quiet verification for humans and agents.
#
#   scripts/check.sh            what changed vs HEAD (staged, unstaged and untracked)
#   scripts/check.sh all        everything, including the production front build
#   scripts/check.sh rust       all Rust crates
#   scripts/check.sh front      the React front
#   scripts/check.sh docs       agent docs (links, reachability, globs, sizes)
#
# Prints one line per step; on failure, only the relevant lines (errors, panics, failed tests).
# Exit code is non-zero if any step fails.
set -uo pipefail
cd "$(dirname "$0")/.."

mode=${1:-changed}
failed=0
start=$(date +%s)

# Keep only what explains a failure; fall back to the tail if nothing matched.
relevant() {
  local out
  out=$(grep -E -A14 '^(error|warning)(\[|:)|panicked|FAILED|failures:|Error:|FAIL |× |AssertionError|Expected|Received' | head -90)
  if [ -n "$out" ]; then echo "$out"; else tail -40; fi
}

step() {
  local name=$1
  shift
  local t0 out
  t0=$(date +%s)
  if out=$("$@" 2>&1); then
    printf 'ok    %-34s %ss\n' "$name" "$(($(date +%s) - t0))"
  else
    printf 'FAIL  %-34s %ss\n' "$name" "$(($(date +%s) - t0))"
    echo "$out" | relevant | sed 's/^/      /'
    failed=1
  fi
}

rust_crates=()
front=0
front_build=0
docs=0
add_crate() { [[ " ${rust_crates[*]-} " == *" $1 "* ]] || rust_crates+=("$1"); }
all_rust() { for c in awr-domain awr-wire awr-application awr-infrastructure warroom-hook agent-war-room; do add_crate "$c"; done; }

case "$mode" in
  all) all_rust; front=1; front_build=1; docs=1 ;;
  docs) docs=1 ;;
  rust) all_rust ;;
  front) front=1 ;;
  changed)
    files=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)
    if [ -z "$files" ]; then echo "nothing changed vs HEAD"; exit 0; fi
    while IFS= read -r f; do
      case "$f" in
        crates/domain/*|crates/wire/*|Cargo.toml|Cargo.lock|.cargo/*) all_rust; front=1 ;;
        # view.rs feeds the generated TS types: the front must typecheck against them.
        crates/application/*) add_crate awr-application; add_crate awr-infrastructure; add_crate agent-war-room; front=1 ;;
        crates/infrastructure/*) add_crate awr-infrastructure; add_crate agent-war-room ;;
        crates/hook-bridge/*) add_crate warroom-hook ;;
        src-tauri/*) add_crate agent-war-room ;;
        AGENTS.md|*/AGENTS.md|CLAUDE.md|*/CLAUDE.md|.cursor/*|.agents/*|.claude/*|scripts/*.py) docs=1 ;;
        src/*|package.json|package-lock.json|tsconfig.json|vite.config.ts|index.html) front=1 ;;
      esac
    done <<< "$files"
    ;;
  *) echo "usage: scripts/check.sh [changed|all|rust|front|docs]" >&2; exit 2 ;;
esac

if [ ${#rust_crates[@]} -gt 0 ]; then
  pkgs=()
  for c in "${rust_crates[@]}"; do pkgs+=(-p "$c"); done
  step "clippy ${rust_crates[*]}" cargo clippy -q "${pkgs[@]}" --all-targets -- -D warnings
  test_pkgs=()
  for c in "${rust_crates[@]}"; do [ "$c" = agent-war-room ] || test_pkgs+=(-p "$c"); done
  # Also regenerates src/domain/generated when awr-application is included.
  [ ${#test_pkgs[@]} -gt 0 ] && step "cargo test" cargo test -q "${test_pkgs[@]}"
fi

if [ "$front" = 1 ]; then
  step "tsc" npx tsc
  step "vitest" npx vitest run --reporter=dot
fi
[ "$front_build" = 1 ] && step "vite build" npm run build --silent
[ "$docs" = 1 ] && step "agent docs" python3 scripts/check_docs.py

if [ ${#rust_crates[@]} -eq 0 ] && [ "$front" = 0 ] && [ "$docs" = 0 ]; then
  echo "only docs/config changed: nothing to check"
fi
echo "---- $([ $failed = 0 ] && echo PASS || echo FAIL) in $(($(date +%s) - start))s"
exit $failed
