/**
 * THE YOUTUBE BUTTON: TOOLTIP, LONG-VIDEO WARNING, AND HAND-OVER.
 *
 * Drives the real front page:
 *   1. the "Summarize a YouTube lecture" button is there, apart from the prompt and the file drop,
 *      and hovering it shows "Get a summary of a YouTube lecture";
 *   2. a link to a video longer than 30 minutes is checked and WARNED about, and nothing starts
 *      until "Continue anyway";
 *   3. a link under 30 minutes goes straight to the video being read;
 *   4. a link pasted into the main prompt box opens the same launcher and gets the same check.
 * It stops each run before any lecture is generated (the lecture request is intercepted).
 *
 *   node scripts/test-youtube-launcher.mjs <email> <password-file> [out-dir]
 *
 * COST: two free length checks per video; the short video's reading is served from the cache once
 * it has been read before. No lecture is generated.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [email, pwFile, outDir = path.resolve("youtube-launcher-out")] = process.argv.slice(2);
if (!email || !pwFile) {
  console.error("usage: node scripts/test-youtube-launcher.mjs <email> <password-file> [out-dir]");
  process.exit(2);
}
const LONG = "https://www.youtube.com/watch?v=ZK3O402wf1c"; // 39:49
const SHORT = "https://youtu.be/aircAruvnKk"; // 19:14
fs.mkdirSync(outDir, { recursive: true });
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const problems = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

async function frontPage() {
  const page = await ctx.newPage();
  await page.route("**/api/progressive-lectures", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Stopped by the test before generation." }) })
      : route.continue());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#brief").waitFor({ timeout: 60_000 });
  return page;
}
const launcher = (page) => page.getByRole("button", { name: /Summarize a YouTube lecture/ });
const readingStarted = async (page) => {
  for (let i = 0; i < 30; i++) {
    if (await page.getByText(/Opening the video|Watching the video|Finding the topics|Taking notes/).first().isVisible().catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

// 1. The button and its tooltip.
let page = await frontPage();
await launcher(page).waitFor({ timeout: 30_000 });
await launcher(page).hover();
const tip = page.getByRole("tooltip");
const tipText = (await tip.innerText().catch(() => "")).trim();
log(`tooltip: "${tipText}"`);
if (tipText !== "Get a summary of a YouTube lecture") problems.push(`the tooltip reads "${tipText}"`);
await page.screenshot({ path: path.join(outDir, "1-button-tooltip.png") });

// 2. A long video is warned about, and waits for the student.
await launcher(page).click();
await page.locator("#youtube-url").fill(LONG);
await page.getByRole("button", { name: /^Summarize$/ }).click();
const warning = page.getByText(/Videos over 30 minutes take longer/);
await warning.waitFor({ timeout: 30_000 }).catch(() => problems.push("no warning for a 40-minute video"));
log(`long video: ${(await page.getByRole("alert").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`);
await page.screenshot({ path: path.join(outDir, "2-long-warning.png") });
if (page.url() !== `${BASE}/` && page.url() !== BASE) problems.push("the page moved on before the student confirmed");
if (await readingStarted(page).then((v) => v)) problems.push("reading started before Continue anyway was pressed");
await page.getByRole("button", { name: /Continue anyway/ }).click();
if (!(await readingStarted(page))) problems.push("Continue anyway did not start reading the long video");
else log("long video: reading started after Continue anyway");
await page.close();

// 3. A short video goes straight through.
page = await frontPage();
await launcher(page).click();
await page.locator("#youtube-url").fill(SHORT);
await page.getByRole("button", { name: /^Summarize$/ }).click();
if (!(await readingStarted(page))) problems.push("a 19-minute video did not go straight to reading");
else log("short video: straight to reading, no warning");
await page.screenshot({ path: path.join(outDir, "3-short-reading.png") });
await page.close();

// 4. A link in the main prompt box gets the same check.
page = await frontPage();
await page.locator("#brief").fill(LONG);
await page.keyboard.press("Enter");
await page.getByText(/Videos over 30 minutes take longer/).waitFor({ timeout: 30_000 })
  .then(() => log("prompt-box link: same warning"))
  .catch(() => problems.push("a long link typed in the prompt box was not warned about"));
await page.screenshot({ path: path.join(outDir, "4-prompt-box-warning.png") });

await browser.close();
if (problems.length) {
  log(`FAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
log(`OK — screenshots in ${outDir}`);
