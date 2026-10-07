// Screenshots of the demo UI (no Tauri needed) so a human or an agent can *look* at changes.
//
//   npm run shot -- <out-dir> [width] [lang]     (lang: en, es…; default en)
//
// Builds nothing: run `npm run build` first if the source changed (npm run shot does it for you).
// Writes classic.png (full page), detail.png, reader.png, changes.png, diff.png, subagent.png, filtered.png,
// agents.png, shortcuts.png, question.png, pixel.png, pixel-later.png, pixel-menu.png, lobby.png and
// auto-approve.png to <out-dir>.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const out = resolve(process.argv[2] ?? "shots");
const width = Number(process.argv[3] ?? 1500);
const lang = process.argv[4] ?? "en";
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
  const shot = async (name, fullPage = false) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage });
    console.log(`${out}/${name}.png`);
  };

  await page.goto(`http://localhost:${port}/?lang=${lang}`);
  await shot("classic", true);
  await page.getByText("Sync conflicts strategy").first().click();
  await shot("question");
  await page.keyboard.press("Escape");
  // Subagent first: the detail panel would cover the chips. Esc goes back to its session's
  // detail (which has subagents), a second Esc closes it.
  await page.locator(".agent-chip").first().click();
  await shot("subagent");
  await page.keyboard.press("Escape");
  await shot("detail");
  await page.locator(".load-changes").click();
  await page.locator(".commit").first().waitFor();
  await page.locator(".detail-body").evaluate((el) => (el.scrollTop = 0));
  await page.locator(".detail-body section", { has: page.locator(".changes") }).scrollIntoViewIfNeeded();
  await shot("changes");
  await page.locator(".commit").first().click();
  await shot("diff");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // A finished session's answer at reading size; Esc closes only the reader, then the panel.
  await page.getByText("Document the test bench").first().click();
  await page.locator(".detail .read-answer").click();
  await shot("reader");
  await page.keyboard.press("Escape");
  await page.locator(".detail").waitFor({ timeout: 2000 });
  await page.keyboard.press("Escape");
  // Filters start folded.
  const toggle = page.locator(".filter-toggle");
  if (await toggle.count()) await toggle.click();
  const chip = page.locator(".filter-chip.source").first();
  if (await chip.count()) {
    await chip.click();
    await shot("filtered");
    await chip.click();
  }
  await page.locator(".agents-menu > button").click();
  await shot("agents");
  await page.locator(".agents-menu > button").click();
  await page.keyboard.press("?");
  await shot("shortcuts");
  await page.keyboard.press("Escape");
  await page.locator(".segmented button").nth(1).click();
  await shot("pixel", true);
  // A few seconds later, to see agents on the move.
  await page.waitForTimeout(2500);
  await shot("pixel-later", true);
  // Right click on a desk: its quick menu.
  const stage = page.locator(".pixel-stage canvas");
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width * 0.28, box.y + box.height * 0.3, { button: "right" });
  await shot("pixel-menu");
  await page.keyboard.press("Escape");
  // Through the door: the lobby, where idle agents rest.
  await page.locator(".pixel-rooms button").nth(1).click();
  await page.waitForTimeout(1500);
  await shot("lobby", true);
  await page.locator(".pixel-rooms button").nth(0).click();
  await page.locator(".segmented button").nth(0).click();
  await page.locator(".drinking-bird").click();
  await shot("auto-approve", true);
  await browser.close();
} finally {
  stop();
}
if (errors.length) {
  console.error("page errors:\n" + errors.join("\n"));
  process.exit(1);
}
