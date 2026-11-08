/**
 * Browser smoke test — optional, needs Playwright.
 *   npm i -D playwright && npx playwright install chromium
 *   node tests/browser.test.mjs
 *
 * All external network calls are blocked, which forces every AI step onto its
 * documented local fallback. That is the harshest realistic test: if the app
 * renders a plan, art and a video here, it works offline.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(ROOT, "tests", "screenshots");

const errors = [];
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name} ${detail}`); }
};

const server = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch { /* retry */ }
    await wait(250);
  }
  throw new Error("server did not start");
}

let browser;
try {
  await waitForServer();
  await mkdir(SHOTS, { recursive: true });
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });

  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (/net::ERR|Failed to load resource|ERR_FAILED|CSP|Content Security Policy/i.test(t)) return; // expected: external calls blocked
    errors.push(`console: ${t}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    return route.abort();
  });

  console.log("→ loading app");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#view-studio .studio", { timeout: 15000 });
  check("studio mounts", true);
  check("brand present", (await page.locator(".brand b").textContent())?.includes("ZTC"));

  console.log("→ writing a brief and producing offline");
  await page.fill("#briefText", "A 60 second launch film for a matte black ceramic coffee mug with a magnetic lid, aimed at design-conscious commuters. Show the lid mechanism and the weight in hand.");
  await page.selectOption("#view-studio select[aria-label='Visual style']", "cinematic3d").catch(() => {});
  await page.click("button:has-text('Auto-produce')");

  let produced = null;
  for (let i = 0; i < 120; i++) {
    const stats = await page.evaluate(() => [...document.querySelectorAll("#view-studio .stat .v")].map((n) => n.textContent.trim()));
    const scenes = Number(stats[0] || 0);
    const images = Number((stats[2] || "0/0").split("/")[0]);
    if (scenes > 0 && images >= scenes) { produced = { scenes, images }; break; }
    await wait(1000);
  }
  check("plan + art generated without network", !!produced, produced ? "" : "timed out");
  if (produced) console.log(`    scenes=${produced.scenes} images=${produced.images}`);

  const canvasDrawn = await page.evaluate(() => {
    const c = document.getElementById("previewCanvas");
    if (!c) return false;
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, Math.min(40, c.width), Math.min(40, c.height)).data;
    let nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) nonBlack++;
    return nonBlack > 10;
  });
  check("preview canvas renders pixels", canvasDrawn);

  const stageRows = await page.locator("#view-studio .stage-row").count();
  check("pipeline shows stages", stageRows >= 5, `rows=${stageRows}`);
  const logRows = await page.locator("#view-studio .runlog .lg").count();
  check("provider log populated", logRows >= 2, `rows=${logRows}`);

  console.log("→ storyboard");
  await page.click(".nav-item[data-view='storyboard']");
  await page.waitForSelector("#view-storyboard .scene-card", { timeout: 10000 });
  const cards = await page.locator("#view-storyboard .scene-card").count();
  check("storyboard cards", cards >= 4, `cards=${cards}`);

  await page.locator("#view-storyboard .scene-card").first().click();
  await page.waitForSelector(".modal h2:has-text('Scene inspector')", { timeout: 8000 });
  check("scene inspector opens", true);
  await page.locator(".modal button[aria-label='Close dialog']").click();

  console.log("→ timeline");
  await page.click(".nav-item[data-view='timeline']");
  await page.waitForSelector("#view-timeline .tl-clip", { timeout: 8000 });
  const clips = await page.locator("#view-timeline .tl-clip").count();
  check("timeline clips", clips >= cards, `clips=${clips}`);
  const playheadBefore = await page.locator("#view-timeline .tl-playhead").evaluate((n) => n.style.left);
  await page.locator("#view-timeline .tl-ruler").click({ position: { x: 260, y: 12 } });
  const playheadAfter = await page.locator("#view-timeline .tl-playhead").evaluate((n) => n.style.left);
  check("scrubbing moves the playhead", playheadBefore !== playheadAfter, `${playheadBefore} → ${playheadAfter}`);

  console.log("→ assets");
  await page.click(".nav-item[data-view='assets']");
  await page.waitForSelector("#view-assets .asset", { timeout: 10000 });
  let assets = 0;
  for (let i = 0; i < 20; i++) {
    assets = await page.locator("#view-assets .asset").count();
    if (assets >= cards) break;
    await wait(500);
  }
  check("asset library lists media", assets >= cards, `assets=${assets} cards=${cards}`);

  console.log("→ chat");
  await page.click(".nav-item[data-view='chat']");
  await page.waitForSelector("#chatInput", { timeout: 8000 });
  check("chat mounts", true);

  console.log("→ export dialog");
  await page.click("#btnExport");
  await page.waitForSelector(".modal h2:has-text('Export')", { timeout: 8000 });
  const exportOpts = await page.locator(".modal .export-opt").count();
  check("export options listed", exportOpts >= 6, `options=${exportOpts}`);
  check("video render offered", await page.locator(".modal button:has-text('Render video')").isVisible());
  await page.locator(".modal button[aria-label='Close dialog']").click();

  console.log("→ settings, providers, versions, help, palette");
  await page.click("#btnSettings");
  await page.waitForSelector(".modal h2:has-text('Settings')");
  await page.click(".modal .seg button:has-text('Voice & music')");
  check("settings tabs switch", await page.locator(".modal input[type=color]").count() > 0);
  await page.locator(".modal button[aria-label='Close dialog']").click();

  await page.keyboard.press("Control+k");
  await page.waitForSelector("#palette:not([hidden])");
  await page.fill("#paletteInput", "export");
  const palCount = await page.locator("#paletteList .pal-item").count();
  check("command palette filters", palCount >= 1, `items=${palCount}`);
  await page.keyboard.press("Escape");

  await page.click("#btnHelp");
  await page.waitForSelector(".modal h2:has-text('Shortcuts')");
  await page.locator(".modal button[aria-label='Close dialog']").click();

  console.log("→ theme + persistence");
  await page.click("#btnTheme");
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check("light theme applies", theme === "light", theme);
  await page.screenshot({ path: path.join(SHOTS, "studio-light.png"), fullPage: false });
  await page.click("#btnTheme");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".view:not([hidden])", { timeout: 15000 });
  const restoredView = await page.evaluate(() => document.querySelector(".view:not([hidden])")?.id);
  check("last view restored", restoredView === "view-chat", restoredView || "none");
  await page.click(".nav-item[data-view='studio']");
  await page.waitForSelector("#view-studio .studio", { timeout: 15000 });
  const persisted = await page.locator("#view-studio .stat .v").first().textContent();
  check("project survives reload", Number(persisted) > 0, `scenes=${persisted}`);
  await page.screenshot({ path: path.join(SHOTS, "studio-dark.png"), fullPage: false });

  await page.click(".nav-item[data-view='storyboard']");
  await page.waitForSelector(".scene-card", { timeout: 8000 });
  await page.screenshot({ path: path.join(SHOTS, "storyboard.png"), fullPage: false });
  await page.click(".nav-item[data-view='timeline']");
  await page.waitForSelector(".tl-clip", { timeout: 8000 });
  await page.screenshot({ path: path.join(SHOTS, "timeline.png"), fullPage: false });

  console.log("→ actual video + audio render (real time, 6s)");
  const rendered = await page.evaluate(async () => {
    const store = await import("/src/store.js");
    const vs = await import("/src/views-studio.js");
    const exp = await import("/src/export.js");
    const p = store.activeProject();
    p.plan.scenes = p.plan.scenes.slice(0, 2).map((s, i) => ({ ...s, duration: 3, voiceId: null, voiceDur: 0, transition: i === 0 ? "fade" : "none" }));
    p.settings.quality = "draft";
    p.settings.fps = 24;
    p.settings.musicMood = "minimal";
    store.saveNow();
    const r = vs.studioRenderer();
    const a = vs.studioAudio();
    const res = await exp.recordVideo({ renderer: r, audio: a, project: p, onProgress: () => {}, onNotice: () => {} });
    const wav = await a.renderMixWav(p).catch(() => null);
    const srt = exp.toSRT(p);
    return { bytes: res.bytes, ext: res.ext, mime: res.mime, secs: res.seconds, wav: wav?.size || 0, srt: srt.length };
  });
  check("video file produced", rendered.bytes > 20000, `${Math.round(rendered.bytes / 1024)} KB`);
  check("container detected", ["mp4", "webm"].includes(rendered.ext), `${rendered.ext} · ${rendered.mime}`);
  check("audio mixdown produced", rendered.wav > 10000, `${Math.round(rendered.wav / 1024)} KB`);
  check("subtitles generated", rendered.srt > 40, `${rendered.srt} chars`);
  console.log(`    video: ${Math.round(rendered.bytes / 1024)} KB ${rendered.ext} · wav: ${Math.round(rendered.wav / 1024)} KB · ${rendered.secs}s`);

  check("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  failures.push(`harness: ${e.message}`);
  console.error(e);
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(`\n${failures.length ? "FAIL" : "PASS"} — ${failures.length} failure(s)`);
if (failures.length) { failures.forEach((f) => console.log(`  · ${f}`)); process.exit(1); }
