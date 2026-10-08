// Builds warroom-hook in release mode and puts it where Tauri expects bundled binaries:
// src-tauri/binaries/warroom-hook-<target-triple>[.exe]. Node instead of a shell script so it runs on
// Linux, macOS and Windows alike.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const triple = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (\S+)$/m)[1];
const exe = process.platform === "win32" ? ".exe" : "";

execFileSync("cargo", ["build", "--release", "-p", "warroom-hook"], { cwd: root, stdio: "inherit" });
mkdirSync(join(root, "src-tauri/binaries"), { recursive: true });
const target = join(root, `src-tauri/binaries/warroom-hook-${triple}${exe}`);
copyFileSync(join(root, `target/release/warroom-hook${exe}`), target);
console.log(`bridge ready: ${target}`);
