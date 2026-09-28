#!/bin/sh
# Compila warroom-hook en release y lo deja donde Tauri espera los binarios incluidos:
# src-tauri/binaries/warroom-hook-<target-triple>.
set -eu
cd "$(dirname "$0")/.."
triple=$(rustc -vV | sed -n 's/^host: //p')
cargo build --release -p warroom-hook
mkdir -p src-tauri/binaries
cp target/release/warroom-hook "src-tauri/binaries/warroom-hook-$triple"
echo "puente listo: src-tauri/binaries/warroom-hook-$triple"
