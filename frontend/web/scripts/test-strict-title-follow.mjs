/**
 * STRICT LECTURE FROM A QUESTION: is it titled by its subject, and does the PDF panel follow the
 * source again after the student scrolls it by hand? A REAL lecture (one short one).
 *
 *   node scripts/test-strict-title-follow.mjs <pdf> <email> <password-file> <question> [out-dir]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [pdf, email, pwFile, question, outDir = path.resolve("strict-title-follow-out")] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.locator('input[type="file"]').first().setInputFiles(pdf);
await askInPicker(page, question);
await page.getByRole("button", { name: /strict source/i }).first().click({ timeout: 240_000 });

// 1. The build screen's title.
const heading = page.getByText(/Preparing your lesson/i).locator("xpath=following-sibling::h1").first();
await heading.waitFor({ timeout: 60_000 }).catch(() => {});
const title = (await heading.innerText().catch(() => "")).trim();
await page.screenshot({ path: path.join(outDir, "build-screen.png") });
log(`build screen title: "${title}"`);
if (!title) problems.push("no build-screen title found");
if (/^(?:why|how|what|when|which)\b/i.test(title)) problems.push(`title "${title}" is the question cut short, not its subject`);

// 2. Start the lecture, scroll the PDF panel by hand, and see whether the next part takes it back.
const play = page.getByRole("button", { name: /^(Play|Start)/i }).first();
for (let i = 0; i < 300 && !(await play.isVisible().catch(() => false)); i++) await page.waitForTimeout(1500);
await play.click({ timeout: 60_000 });
await page.waitForTimeout(5000);
const follow = page.locator('button[title^="Following Aria"], button[title^="Resume following Aria"]').first();
const panel = page.locator('section[aria-label="Source document"] .overflow-auto').first();
await panel.hover();
await page.mouse.wheel(0, 1500);
await page.waitForTimeout(800);
const pausedAfterWheel = (await follow.getAttribute("aria-pressed")) === "false";
log(`after a hand scroll, following paused: ${pausedAfterWheel}`);
const next = page.getByRole("button", { name: /next concept/i }).first();
let moved = false;
for (let i = 0; i < 120 && !moved; i++) {
  if (await next.isEnabled().catch(() => false)) { await next.click(); moved = true; }
  else await page.waitForTimeout(2000);
}
await page.waitForTimeout(2500);
const resumed = (await follow.getAttribute("aria-pressed")) === "true";
await page.screenshot({ path: path.join(outDir, "next-part.png") });
log(moved ? `on the next part, following again: ${resumed}` : "the lecture had only one part, so there was no next part to check");
if (moved && !resumed) problems.push("the panel did not follow the source again on the next part");
await browser.close();

if (problems.length) { console.error(`\nPROBLEMS:\n  - ${problems.join("\n  - ")}`); process.exit(1); }
console.log("\nTitled by its subject; the panel follows the source again on the next part.");

/** The uploader is separate from the prompt box: a question about the document is asked in the page picker. */
async function askInPicker(page, question) {
  const box = page.locator("#page-prompt");
  await box.waitFor({ timeout: 180_000 });
  await box.fill(question);
  const ask = page.locator("button[data-ask-question]");
  if (await ask.isEnabled().catch(() => false)) await ask.click();
  else await box.press("Enter");
}
