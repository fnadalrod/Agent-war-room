#!/usr/bin/env bash
# Type-checks and lints the Rust workspace for macOS and Windows from Linux (no linking, no tests).
#
#   scripts/cross_check.sh              both targets
#   scripts/cross_check.sh windows      x86_64-pc-windows-gnu
#   scripts/cross_check.sh macos        aarch64-apple-darwin
#
# C dependencies (bundled SQLite) need a cross C compiler: zig is used as one. Get it with
# `pip install ziglang` (or any `zig` on PATH; `ZIG=/path/to/zig` overrides). Rust targets:
# `rustup target add x86_64-pc-windows-gnu aarch64-apple-darwin`.
# The real build of each platform runs in CI (.github/workflows/ci.yml); this is the fast local loop.
set -uo pipefail
cd "$(dirname "$0")/.."

zig=${ZIG:-$(command -v zig || true)}
if [ -z "$zig" ]; then
  zig=$(python3 -c 'import ziglang, os; print(os.path.join(os.path.dirname(ziglang.__file__), "zig"))' 2>/dev/null || true)
fi
if [ -z "$zig" ] || [ ! -x "$zig" ]; then
  echo "zig not found: pip install ziglang, or set ZIG=/path/to/zig" >&2
  exit 2
fi

wrappers=$(mktemp -d)
trap 'rm -rf "$wrappers"' EXIT

# zig cc wants its own target names and rejects the Rust triple cc-rs passes. Objective-C sources
# (macOS notifications) need Apple's SDK, which zig lacks: an empty C file stands in for them, which
# is enough to type-check (nothing is linked).
wrapper() {
  local name=$1 zig_target=$2
  echo > "$wrappers/empty.c"
  cat > "$wrappers/$name-cc" <<WRAP
#!/usr/bin/env bash
args=()
for a in "\$@"; do
  case "\$a" in
    --target=*|-target|-fobjc-arc|-fmodules) ;;
    *.m) args+=("$wrappers/empty.c") ;;
    *) args+=("\$a") ;;
  esac
done
exec "$zig" cc -target $zig_target "\${args[@]}"
WRAP
  printf '#!/usr/bin/env bash\nexec "%s" ar "$@"\n' "$zig" > "$wrappers/$name-ar"
  # Windows resources (icon, manifest) only matter when linking: a stand-in windres emits an empty
  # object so Tauri's build script is satisfied.
  cat > "$wrappers/$name-rc" <<WRAP
#!/usr/bin/env bash
case " \$* " in *" -V "*) echo "GNU windres (stand-in)"; exit 0 ;; esac
out=
while [ \$# -gt 0 ]; do [ "\$1" = --output ] && out=\$2; shift; done
echo > "\$out.c" && exec "$wrappers/$name-cc" -c "\$out.c" -o "\$out"
WRAP
  chmod +x "$wrappers/$name-cc" "$wrappers/$name-ar" "$wrappers/$name-rc"
}

failed=0
check() {
  local name=$1 triple=$2 zig_target=$3
  wrapper "$name" "$zig_target"
  local var=${triple//-/_}
  local t0=$(date +%s) out
  if out=$(env "CC_$var=$wrappers/$name-cc" "AR_$var=$wrappers/$name-ar" "RC_$var=$wrappers/$name-rc" \
      CARGO_TARGET_DIR=target/cross \
      cargo clippy -q --workspace --all-targets --target "$triple" -- -D warnings 2>&1); then
    printf 'ok    %-34s %ss\n' "clippy $name ($triple)" "$(($(date +%s) - t0))"
  else
    printf 'FAIL  %-34s %ss\n' "clippy $name ($triple)" "$(($(date +%s) - t0))"
    echo "$out" | grep -E -A12 '^(error|warning)(\[|:)|panicked' | head -120 | sed 's/^/      /'
    failed=1
  fi
}

case "${1:-all}" in
  windows) check windows x86_64-pc-windows-gnu x86_64-windows-gnu ;;
  macos) check macos aarch64-apple-darwin aarch64-macos ;;
  all)
    check windows x86_64-pc-windows-gnu x86_64-windows-gnu
    check macos aarch64-apple-darwin aarch64-macos
    ;;
  *) echo "usage: scripts/cross_check.sh [all|windows|macos]" >&2; exit 2 ;;
esac
exit $failed
