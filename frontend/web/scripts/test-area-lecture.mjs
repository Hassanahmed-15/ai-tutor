/**
 * DOES "GET A LECTURE FROM THIS AREA" TEACH THE AREA, OR THE WHOLE PAGE?
 *
 * Drives the real upload screen: drags a box over part of a page, presses "Get a lecture from this
 * area", and records what each mode would teach — without generating a lecture.
 *
 *   node scripts/test-area-lecture.mjs <pdf> <email> <password-file> [out-dir]
 *        [--page 2] [--box 0.08,0.30,0.92,0.46] [--mode strict|reference]
 *
 * strict    — saves the parse response (area-parse.json) and stops at the source-mode screen. The plan
 *             strict would build is then computed offline by scripts/area-plan.mjs (no generation cost).
 * reference — continues into planning and saves the outline topics (area-outline.txt). Planning
 *             calls only — cents. Stops before Build.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const valueFlags = new Set(["--page", "--box", "--mode"]);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const positional = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
const [pdf, email, pwFile, outDir = path.resolve("area-lecture-out")] = positional;
const pageNumber = Number(flag("--page", "2"));
const [x1, y1, x2, y2] = flag("--box", "0.08,0.30,0.92,0.46").split(",").map(Number);
const mode = flag("--mode", "strict");
fs.mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ headless: !args.includes("--headed") });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

let parse = null;
page.on("response", async (res) => {
  if (!/\/api\/parse-(pdf|pptx)/.test(res.url()) || res.request().method() !== "POST") return;
  try { parse = await res.json(); } catch { /* not JSON */ }
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.locator('input[type="file"]').first().setInputFiles(pdf);

// The page previews render one image per page; drag the box on the chosen one.
const images = page.locator("img[data-page-area-image]");
await images.nth(pageNumber - 1).waitFor({ timeout: 120_000 });
const target = images.nth(pageNumber - 1);
await target.scrollIntoViewIfNeeded();
const box = await target.boundingBox();
if (!box) throw new Error("page preview has no box");
await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
await page.mouse.down();
await page.mouse.move(box.x + box.width * ((x1 + x2) / 2), box.y + box.height * ((y1 + y2) / 2), { steps: 6 });
await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 6 });
await page.mouse.up();
await page.screenshot({ path: path.join(outDir, "area-drawn.png") });
log(`drew a box on page ${pageNumber}: ${[x1, y1, x2, y2].join(",")}`);

await page.locator("button[data-use-region]").first().click({ timeout: 20_000 });
log('pressed "Get a lecture from this area"; waiting for the parse');
await page.getByRole("button", { name: /use it as a reference/i }).first().waitFor({ timeout: 240_000 });
for (let i = 0; i < 20 && !parse; i++) await page.waitForTimeout(500);
if (!parse) throw new Error("no parse response captured");
fs.writeFileSync(path.join(outDir, "area-parse.json"), JSON.stringify(parse));
const blocks = parse.sourceDocument?.contentBlocks ?? [];
const planBeats = parse.sourceDocument?.lessonPlan?.beats ?? [];
log(`parsed: ${blocks.length} blocks on pages ${[...new Set(blocks.map((b) => b.pageNumber))].join(",")}; ` +
  `selected-area blocks: ${blocks.filter((b) => /\(selected area\)/i.test(b.heading ?? "")).length}; ` +
  `document lessonPlan sections: ${planBeats.length}; transcript chars: ${(parse.ocrTranscript ?? "").length}`);
log(`document lessonPlan titles: ${planBeats.map((b) => `"${b.title}"`).join(", ")}`);

if (mode === "reference") {
  await page.getByRole("button", { name: /use it as a reference/i }).first().click();
  log("chose REFERENCE; answering planning questions until an outline is ready");
  const buildButton = page.getByRole("button", { name: /Build lesson/i }).first();
  const titleInputs = page.locator('input[aria-label^="Topic "][aria-label$=" title"]');
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(1000);
    if (await buildButton.isVisible().catch(() => false) && await titleInputs.count() && !(await page.getByText("Planning…").isVisible().catch(() => false))) break;
    const option = page.locator("button:has(span:text-is('A'))").first();
    if (await option.isVisible().catch(() => false) && await option.isEnabled().catch(() => false)) {
      await option.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  await page.waitForTimeout(2000);
  const titles = [];
  for (let i = 0; i < await titleInputs.count(); i++) titles.push(await titleInputs.nth(i).inputValue());
  fs.writeFileSync(path.join(outDir, "area-outline.txt"), titles.join("\n"));
  await page.screenshot({ path: path.join(outDir, "area-outline.png"), fullPage: true });
  log(`reference outline (${titles.length}): ${titles.map((t) => `"${t}"`).join(", ")}`);
}
await browser.close();
console.log(`saved to ${outDir}`);
