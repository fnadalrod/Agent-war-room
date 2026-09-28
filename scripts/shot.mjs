// Screenshots of the demo UI (no Tauri needed) so a human or an agent can *look* at changes.
//
//   npm run shot -- <out-dir> [width]
//
// Builds nothing: run `npm run build` first if the source changed (npm run shot does it for you).
// Writes classic.png, detail.png, subagent.png, filtered.png and pixel.png to <out-dir>.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const out = resolve(process.argv[2] ?? "shots");
const width = Number(process.argv[3] ?? 1500);
const port = 4179;
mkdirSync(out, { recursive: true });

const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("vite preview did not start");
}

const errors = [];
try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 950 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = async (name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`${out}/${name}.png`);
  };

  await page.goto(`http://localhost:${port}/`);
  await shot("classic");
  // Subagent first: the detail panel would cover the chips. Esc goes back to its session's
  // detail (which has subagents), a second Esc closes it.
  await page.locator(".agent-chip").first().click();
  await shot("subagent");
  await page.keyboard.press("Escape");
  await shot("detail");
  await page.keyboard.press("Escape");
  const chip = page.locator(".filter-chip.source").first();
  if (await chip.count()) {
    await chip.click();
    await shot("filtered");
    await chip.click();
  }
  await page.locator(".segmented button").nth(1).click();
  await shot("pixel");
  await page.locator(".segmented button").nth(0).click();
  await browser.close();
} finally {
  stop();
}
if (errors.length) {
  console.error("page errors:\n" + errors.join("\n"));
  process.exit(1);
}
