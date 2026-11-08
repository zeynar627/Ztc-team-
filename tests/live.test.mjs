/**
 * Live deployment check — verifies a hosted copy boots with no missing assets.
 *   URL=https://user.github.io/repo/ node tests/live.test.mjs
 * Optional: SHOT=/path/to.png to capture a screenshot.
 */
import { chromium } from "playwright";

const URL_ = process.env.URL;
if (!URL_) {
  console.error("Set URL=https://your-site/");
  process.exit(2);
}

const errors = [];
const failed = [];
const bad = [];
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (r) => {
  const u = r.url();
  if (!/js\.puter\.com/.test(u)) failed.push(`${u} — ${r.failure()?.errorText}`);
});
page.on("response", (r) => {
  const u = r.url();
  if (u.startsWith(URL_) && r.status() >= 400) bad.push(`${r.status()} ${u}`);
});

let ok = true;
try {
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#view-studio .studio", { timeout: 30000 });
  const title = await page.title();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const modules = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.includes("/src/")).length);
  const canvas = await page.evaluate(() => {
    const c = document.getElementById("previewCanvas");
    return c ? `${c.width}x${c.height}` : "missing";
  });
  console.log(`  title: ${title}`);
  console.log(`  body background: ${bg}`);
  console.log(`  modules loaded: ${modules}`);
  console.log(`  preview canvas: ${canvas}`);
  console.log(`  studio mounted: ${await page.locator("#view-studio .studio").count() === 1}`);
  if (!/ZTC AI Studio/.test(title)) { ok = false; console.log("  ✗ unexpected title"); }
  if (modules < 10) { ok = false; console.log("  ✗ modules did not load"); }
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.click(".nav-item[data-view='storyboard']");
  await page.waitForSelector("#view-storyboard", { state: "visible", timeout: 10000 });
  console.log("  navigation: ok");
} catch (e) {
  ok = false;
  console.log(`  ✗ ${e.message}`);
} finally {
  await browser.close();
}

if (failed.length) { ok = false; console.log(`  ✗ failed requests: ${failed.slice(0, 3).join(" | ")}`); }
if (bad.length) { ok = false; console.log(`  ✗ HTTP errors: ${bad.slice(0, 3).join(" | ")}`); }
if (errors.length) { ok = false; console.log(`  ✗ page errors: ${errors.slice(0, 3).join(" | ")}`); }

console.log(ok ? "\nLIVE PASS" : "\nLIVE FAIL");
process.exit(ok ? 0 : 1);
